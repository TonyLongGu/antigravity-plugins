// ==============================================================================
// 檔案名稱：tests/agent-host-enablement.test.js
// 功能說明：MCP 開關與來源合併的回歸測試（零相依，直接以 node 執行）
//   驗證重點：
//     1. Copilot CLI 條目的停用狀態以 agent host 的 customizationEnablement 為準
//     2. enablement 鍵的命名空間（mcpServers#<名稱> vs <pluginSource>#mcp=<名稱>）
//     3. 主要來源（狀態列）的判定順序
//     4. VS Code 來源與 CLI 來源並列時的同名衝突處理
//   執行：node tests/agent-host-enablement.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：所有夾具都在系統暫存目錄，測試結束自動清除，不觸碰真實設定檔
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');

// ── 夾具根目錄（虛擬的 VS Code 使用者資料）──────────────────────────────────
const ROOT = path.join(os.tmpdir(), 'mcp-manager-test');
const USER_DIR = path.join(ROOT, 'Code', 'User');
const GLOBAL_STORAGE = path.join(USER_DIR, 'globalStorage', 'antigravity.mcp-manager');
const COPILOT_HOME = path.join(ROOT, '.copilot');
const WORKSPACE_URI = 'file:///d%3A/PJ/Ai/ai';

const CLI_SERVERS = {
  '3dsmax-mcp': { type: 'stdio', command: 'uv', args: ['run', '3dsmax-mcp'] },
  github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  higgsfield: { type: 'http', url: 'https://mcp.higgsfield.ai/mcp' },
  photopea: { type: 'stdio', command: 'npx', args: ['-y', 'photopea-mcp-server'] },
  pollo: { type: 'http', url: 'https://mcp.pollo.ai/mcp' },
  unityMCP: { type: 'http', url: 'http://127.0.0.1:8080/mcp' },
};
const CLI_NAMES = Object.keys(CLI_SERVERS);

const copilotConfigPath = path.join(COPILOT_HOME, 'mcp-config.json');
const agentHostStoragePath = path.join(USER_DIR, 'globalStorage', 'agent-host-storage.json');
const userMcpPath = path.join(USER_DIR, 'mcp.json');

function writeCli(servers) {
  fs.writeFileSync(copilotConfigPath, JSON.stringify({ mcpServers: servers }), 'utf-8');
}

function writeEnablement(global, extra = {}) {
  fs.writeFileSync(agentHostStoragePath, JSON.stringify({
    customizationEnablement: { global, ...extra },
    customizationEnablementLru: Object.keys(global || {}).map((k) => ({ scope: 'global', key: k })),
  }), 'utf-8');
}

function enablementFor(enabledNames) {
  const map = {};
  for (const name of CLI_NAMES) map[`mcpServers#${name}`] = enabledNames.includes(name);
  return map;
}

// ── 以 stub 取代 vscode 模組（讓宿主判定為 VS Code）──────────────────────────
const vscodeStub = {
  env: { appName: 'Visual Studio Code' },
  workspace: {
    workspaceFolders: [{ index: 0, name: 'ai', uri: { fsPath: 'D:/PJ/Ai/ai', toString: () => WORKSPACE_URI } }],
    getConfiguration: () => ({ get: () => undefined, inspect: () => null, update: async () => {} }),
  },
  extensions: { getExtension: () => null },
  ConfigurationTarget: { Global: 1 },
};
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.apply(this, arguments);
};

const McpConfigService = require(path.join(EXT_ROOT, 'services', 'mcpConfigService.js'));
const CopilotCliService = require(path.join(EXT_ROOT, 'services', 'copilotCliMcpService.js'));
const AgentHostService = require(path.join(EXT_ROOT, 'services', 'agentHostMcpService.js'));

// ── 測試框架 ────────────────────────────────────────────────────────────────
const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', `${label} :: ${e.message}`]);
  }
};

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(GLOBAL_STORAGE, { recursive: true });
  fs.mkdirSync(COPILOT_HOME, { recursive: true });
  process.env.COPILOT_HOME = COPILOT_HOME;
  writeCli(CLI_SERVERS);
  McpConfigService.init({ globalStorageUri: { fsPath: GLOBAL_STORAGE } });

  // ═══ A. enablement 鍵的命名空間 ═══════════════════════════════════════════
  check('A1 根來源鍵 mcpServers#<名稱> 納入判定', () => {
    const r = AgentHostService.parseEnablementKey('mcpServers#github');
    assert.strictEqual(r.kind, 'mcpServer', '應視為 MCP 伺服器');
    assert.strictEqual(r.name, 'github', '名稱應正確取出');
  });
  check('A2 plugin 來源鍵不納入判定（避免跨來源誤停用）', () => {
    const r = AgentHostService.parseEnablementKey(
      'vscode-synced-customization:/agent-host-copilotcli--1829831212#mcp=pylance mcp server'
    );
    assert.strictEqual(r.kind, 'ignored', 'plugin 範圍的鍵不應參與 CLI 條目判定');
    assert.strictEqual(r.reason, 'pluginScoped', '應標記為 pluginScoped');
  });
  check('A3 未知來源但含 #mcp= 的鍵仍納入（保留彈性）', () => {
    const r = AgentHostService.parseEnablementKey('some-future-source#mcp=custom-server');
    assert.strictEqual(r.name, 'custom-server', '應取出名稱');
  });
  check('A4 雜訊鍵與 plugin 本身被忽略', () => {
    for (const key of ['', 'mcpServers#', 'weird-key', null, undefined, 'vscode-synced-customization:/only-plugin']) {
      assert.strictEqual(AgentHostService.parseEnablementKey(key).kind, 'ignored', `鍵 ${String(key)} 應被忽略`);
    }
  });
  check('A5 ignoredKeys 回報被忽略的鍵與原因', () => {
    const list = AgentHostService.ignoredKeys({
      'mcpServers#ok': true,
      'vscode-synced-customization:/x#mcp=pylance mcp server': true,
      'weird-key': false,
    });
    assert.strictEqual(list.length, 2, `實際 ${JSON.stringify(list)}`);
    assert.ok(list.some((i) => i.reason === 'pluginScoped'), '應含 pluginScoped');
    assert.ok(list.some((i) => i.reason === 'unrecognized'), '應含 unrecognized');
  });

  // ═══ B. 停用狀態以 agent host 為準 ═════════════════════════════════════════
  writeEnablement({
    ...enablementFor(['3dsmax-mcp', 'github', 'photopea', 'unityMCP']),
    'vscode-synced-customization:/agent-host-copilotcli--1829831212#mcp=pylance mcp server': true,
  });
  const b = await McpConfigService.getGlobalData('both');
  check('B1 統計與設定一致（4 啟用 / 2 停用）', () => {
    assert.deepStrictEqual(b.copilotCliStats, { total: 6, enabled: 4, disabled: 2 },
      `實際 ${JSON.stringify(b.copilotCliStats)}`);
    assert.strictEqual(b.stats.enabled, 4, `狀態列啟用數應為 4，實際 ${b.stats.enabled}`);
  });
  check('B2 逐列狀態與停用來源正確', () => {
    const expected = { '3dsmax-mcp': true, github: true, photopea: true, unityMCP: true, higgsfield: false, pollo: false };
    for (const [name, enabled] of Object.entries(expected)) {
      const row = b.config.mcpServers[name];
      assert.ok(row, `${name} 應在清單中`);
      assert.strictEqual(row.disabled, !enabled, `${name} 停用狀態錯誤`);
      assert.strictEqual(row.disabledBy, enabled ? '' : 'agentHost', `${name} 停用來源應為 agentHost`);
    }
  });
  check('B3 pylance 的 plugin 鍵不會誤傷任何 CLI 條目', () => {
    for (const name of CLI_NAMES) {
      assert.notStrictEqual(b.config.mcpServers[name].disabledBy, 'config', `${name} 不應被判為設定檔停用`);
    }
    assert.strictEqual(b.config.mcpServers.pollo.disabled, true, 'pollo 仍應依 agent host 停用');
  });
  const direct = await CopilotCliService.getServers(
    AgentHostService.resolveStates(await AgentHostService.readState())
  );
  check('B4 服務層統計 == 面板統計（單一真相）', () => {
    assert.deepStrictEqual(direct.stats, b.copilotCliStats,
      `服務層 ${JSON.stringify(direct.stats)} vs 面板 ${JSON.stringify(b.copilotCliStats)}`);
  });
  check('B5 未注入開關狀態時只反映設定檔自身宣告（不猜測）', async () => {
    const plain = await CopilotCliService.getServers();
    assert.deepStrictEqual(plain.stats, { total: 6, enabled: 6, disabled: 0 }, `實際 ${JSON.stringify(plain.stats)}`);
  });
  check('B6 接受 Set 形式的停用清單', async () => {
    const viaSet = await CopilotCliService.getServers(new Set(['pollo']));
    assert.strictEqual(viaSet.servers.pollo.disabled, true, 'Set 形式未被解讀');
    assert.strictEqual(viaSet.servers.github.disabled, false, '未列入者不應停用');
  });

  // ═══ C. 主要來源（狀態列）判定順序 ═════════════════════════════════════════
  writeEnablement(enablementFor([]));
  const c1 = await McpConfigService.getGlobalData('both');
  check('C1 CLI 全停用且 VS Code 無伺服器 → 顯示 0/6（有資訊量）', () => {
    assert.strictEqual(c1.primaryIsCopilotCli, true, 'CLI 有設定檔時仍以 CLI 為主');
    assert.strictEqual(c1.stats.total, 6, `狀態列總數應為 6，實際 ${c1.stats.total}`);
    assert.strictEqual(c1.stats.enabled, 0, '啟用數應為 0');
  });
  fs.writeFileSync(userMcpPath, JSON.stringify({
    servers: { 'vscode-only': { type: 'http', url: 'http://127.0.0.1:9999/mcp' } }, inputs: [],
  }), 'utf-8');
  const c2 = await McpConfigService.getGlobalData('both');
  check('C2 CLI 全停用但 VS Code 有可用伺服器 → 主要來源改為 VS Code', () => {
    assert.strictEqual(c2.primaryIsCopilotCli, false, '不應讓 0/6 蓋掉可用來源');
    assert.strictEqual(c2.stats.total, 1, `狀態列應顯示 1，實際 ${c2.stats.total}`);
    assert.strictEqual(c2.primarySourceName, 'VS Code', `實際 ${c2.primarySourceName}`);
  });
  fs.rmSync(userMcpPath, { force: true });
  writeEnablement(enablementFor(['github']));
  const c3 = await McpConfigService.getGlobalData('both');
  check('C3 只要有一個 CLI 伺服器啟用 → 主要來源為 Copilot CLI', () => {
    assert.strictEqual(c3.primaryIsCopilotCli, true, 'primaryIsCopilotCli 應為 true');
    assert.strictEqual(c3.stats.enabled, 1, `啟用數應為 1，實際 ${c3.stats.enabled}`);
    assert.strictEqual(c3.primarySourceShort, 'Copilot', `短標應為 Copilot，實際 ${c3.primarySourceShort}`);
  });

  // ═══ D. 負對照 ═════════════════════════════════════════════════════════════
  fs.rmSync(agentHostStoragePath, { force: true });
  const d1 = await McpConfigService.getGlobalData('both');
  check('D1 無開關檔 → 回落原本行為（全啟用）', () => {
    assert.deepStrictEqual(d1.copilotCliStats, { total: 6, enabled: 6, disabled: 0 },
      `實際 ${JSON.stringify(d1.copilotCliStats)}`);
    assert.strictEqual(d1.agentHostEnablementAvailable, false, '應回報開關檔不存在');
  });
  fs.writeFileSync(agentHostStoragePath, '{ "customizationEnablement": { "global": ', 'utf-8');
  const rawState = await AgentHostService.readState();
  const d2 = await McpConfigService.getGlobalData('both');
  check('D2 開關檔損毀 → parseError 且不誤判為全部停用', () => {
    assert.strictEqual(rawState.parseError, true, '應回報 parseError');
    assert.strictEqual(rawState.global.size, 0, '不應產生狀態');
    assert.strictEqual(d2.copilotCliStats.enabled, 6, `壞檔不應改變判定，實際 ${JSON.stringify(d2.copilotCliStats)}`);
  });

  // ═══ E. 工作區覆寫與設定檔自身宣告 ═════════════════════════════════════════
  writeEnablement({ 'mcpServers#pollo': false }, {
    workingDirectories: { [WORKSPACE_URI]: { 'mcpServers#pollo': true } },
  });
  const e1 = await McpConfigService.getGlobalData('both');
  check('E1 工作區覆寫優先於全域', () => {
    assert.strictEqual(e1.config.mcpServers.pollo.disabled, false, '工作區設為啟用時應覆寫全域停用');
  });
  fs.rmSync(agentHostStoragePath, { force: true });
  writeCli({ ...CLI_SERVERS, unityMCP: { ...CLI_SERVERS.unityMCP, disabled: true } });
  const e2 = await McpConfigService.getGlobalData('both');
  check('E2 設定檔自身宣告 disabled → 標記 config 來源', () => {
    assert.strictEqual(e2.config.mcpServers.unityMCP.disabled, true, '應停用');
    assert.strictEqual(e2.config.mcpServers.unityMCP.disabledBy, 'config',
      `實際 ${e2.config.mcpServers.unityMCP.disabledBy}`);
    assert.strictEqual(e2.copilotCliStats.disabled, 1, `實際 ${JSON.stringify(e2.copilotCliStats)}`);
  });

  // ═══ F. 與 VS Code 來源並列（回歸）═════════════════════════════════════════
  writeCli(CLI_SERVERS);
  fs.writeFileSync(userMcpPath, JSON.stringify({
    servers: {
      github: { type: 'stdio', command: 'npx', args: ['-y', 'x'] },
      'vscode-only': { type: 'http', url: 'http://127.0.0.1:9999/mcp' },
    },
    inputs: [],
  }), 'utf-8');
  const f = await McpConfigService.getGlobalData('both');
  check('F1 兩來源並列、同名者 VS Code 優先、CLI 條目帶前綴', () => {
    const keys = Object.keys(f.config.mcpServers).sort();
    assert.deepStrictEqual(keys,
      ['3dsmax-mcp', 'copilot-cli:github', 'github', 'higgsfield', 'photopea', 'pollo', 'unityMCP', 'vscode-only'],
      `實際 ${keys.join(', ')}`);
    assert.strictEqual(f.config.mcpServers.github.sourceType, undefined, 'VS Code 版本應保留原名鍵');
    assert.strictEqual(f.config.mcpServers['copilot-cli:github'].sourceType, 'copilotCli', 'CLI 版本應帶前綴');
    assert.strictEqual(f.config.mcpServers['copilot-cli:github'].rawName, 'github', '顯示名稱應為原名');
  });
  check('F2 簽章涵蓋 agent host 開關檔（輪詢才會即時更新）', () => {
    fs.writeFileSync(agentHostStoragePath, JSON.stringify({ customizationEnablement: { global: {} } }), 'utf-8');
    const s1 = McpConfigService.enablementSignature();
    fs.writeFileSync(agentHostStoragePath, JSON.stringify({
      customizationEnablement: { global: { 'mcpServers#pollo': false } },
    }), 'utf-8');
    const s2 = McpConfigService.enablementSignature();
    assert.notStrictEqual(s1, s2, '開關檔變動時簽章必須改變');
    assert.ok(typeof s1 === 'string' && s1.includes(':'), '簽章應含 mtime:size 片段');
  });

  // ── 收尾 ─────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const [status, label] of results) {
    console.log(`${status}  ${label}`);
  }
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);

  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
});
