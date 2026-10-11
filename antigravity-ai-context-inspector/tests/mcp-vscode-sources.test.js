// ==============================================================================
// 檔案名稱：tests/mcp-vscode-sources.test.js
// 功能說明：VS Code 的 MCP 來源合併回歸測試（零相依，直接以 node 執行）
//   驗證重點：
//     1. 三個來源併列：<User>/mcp.json、{workspace}/.vscode/mcp.json、Copilot CLI
//     2. 跨來源同名時以 VS Code 自身來源優先
//     3. Copilot CLI 條目的 scope / transport / 白名單 tools 不計數
//     4. 不標注啟停狀態：即使 VS Code 的兩層開關都標為停用，條目也不得帶 disabled
//     5. 沒有 Copilot CLI 設定檔時不影響其他來源
//   執行：node tests/mcp-vscode-sources.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：APPDATA 與 COPILOT_HOME 都指向系統暫存目錄下的夾具，不觸碰真實設定檔
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'ai-context-inspector-test');
const APPDATA = path.join(ROOT, 'AppData');
const USER_DIR = path.join(APPDATA, 'Code', 'User');
const GLOBAL_STORAGE = path.join(USER_DIR, 'globalStorage');
const COPILOT_HOME = path.join(ROOT, '.copilot');
const WORKSPACE = path.join(ROOT, 'ws');

// 必須在 require 服務前改寫環境變數（服務以 APPDATA / COPILOT_HOME 推導路徑）
process.env.APPDATA = APPDATA;
process.env.COPILOT_HOME = COPILOT_HOME;

const McpDetectorService = require(path.join(EXT_ROOT, 'services', 'mcpDetectorService.js'));

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', label + ' :: ' + e.message]);
  }
};

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
}

function names(list) {
  return list.map(s => s.name).sort();
}

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });

  // ── 夾具 ────────────────────────────────────────────────────────────────────
  writeJson(path.join(USER_DIR, 'mcp.json'), {
    servers: {
      'vscode-only': { type: 'http', url: 'http://127.0.0.1:9999/mcp' },
      shared: { type: 'stdio', command: 'npx', args: ['-y', 'shared'] },
    },
    inputs: [],
  });
  writeJson(path.join(WORKSPACE, '.vscode', 'mcp.json'), {
    servers: { 'ws-server': { type: 'stdio', command: 'uv', args: ['run', 'x'] } },
  });
  writeJson(path.join(COPILOT_HOME, 'mcp-config.json'), {
    mcpServers: {
      photocraft: { type: 'stdio', command: 'D:/x/photocraft-cli.exe', args: ['mcp'], tools: ['*'] },
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
      unityMCP: { type: 'http', url: 'http://127.0.0.1:8080/mcp' },
      'spine-mcp': { type: 'stdio', command: 'node', args: ['index.js'] },
      shared: { type: 'stdio', command: 'node', args: ['cli.js'] },
    },
  });
  writeJson(path.join(GLOBAL_STORAGE, 'agent-host-storage.json'), {
    customizationEnablement: { global: { 'mcpServers#github': false } },
  });
  // 以下兩份「兩層皆標為停用」的狀態檔只是負對照：本功能不標注啟停狀態，結果不得出現任何停用資訊
  fs.writeFileSync(path.join(GLOBAL_STORAGE, 'state.vscdb'), JSON.stringify({
    'mcp.enablement': [
      ['copilot.null.unityMCP', false],
      ['copilot.ssh-remote+devbox.spine-mcp', false],
      ['claude-desktop.null.photocraft', false],
      ['mcp.config.usrlocal.github', false],
    ],
  }), 'utf-8');

  const servers = await McpDetectorService.scanVsCodeMcpServers([WORKSPACE]);

  check('A1 三個來源併列（VS Code 使用者 + 工作區 + Copilot CLI）', () => {
    assert.deepStrictEqual(names(servers),
      ['github', 'photocraft', 'shared', 'spine-mcp', 'unityMCP', 'vscode-only', 'ws-server'],
      '實際 ' + names(servers).join(', '));
  });
  check('A2 跨來源同名時以 VS Code 自身來源優先', () => {
    const shared = servers.find(s => s.name === 'shared');
    assert.strictEqual(shared.path, path.join(USER_DIR, 'mcp.json'), '實際 ' + shared.path);
    assert.strictEqual(servers.filter(s => s.name === 'shared').length, 1, '同名不應重複列出');
  });
  check('A3 CLI 條目標示來源與啟動方式，白名單 tools 不計數', () => {
    const photocraft = servers.find(s => s.name === 'photocraft');
    assert.strictEqual(photocraft.scope, 'Copilot CLI');
    assert.strictEqual(photocraft.path, path.join(COPILOT_HOME, 'mcp-config.json'));
    assert.strictEqual(photocraft.transport, 'stdio');
    assert.strictEqual(photocraft.toolCount, 0, 'tools ["*"] 是白名單，不應計為 1 個工具');
    const github = servers.find(s => s.name === 'github');
    assert.strictEqual(github.transport, 'http');
    assert.strictEqual(github.url, 'https://api.githubcopilot.com/mcp/');
  });
  check('A4 即使兩層都標為停用，也不標注啟停狀態（負對照）', () => {
    assert.ok(servers.every(s => s.disabled === undefined),
      '實際 ' + JSON.stringify(servers.map(s => s.name + ':' + String(s.disabled))));
  });

  fs.rmSync(path.join(COPILOT_HOME, 'mcp-config.json'), { force: true });
  const servers2 = await McpDetectorService.scanVsCodeMcpServers([WORKSPACE]);
  check('A5 沒有 Copilot CLI 設定檔時僅剩 VS Code 來源（不中斷）', () => {
    assert.deepStrictEqual(names(servers2), ['shared', 'vscode-only', 'ws-server'], '實際 ' + names(servers2).join(', '));
  });

  const failed = results.filter(r => r[0] === 'FAIL');
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
