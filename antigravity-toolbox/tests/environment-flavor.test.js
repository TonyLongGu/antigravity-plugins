// ==============================================================================
// 檔案名稱：tests/environment-flavor.test.js
// 功能說明：控制中心「資料來源類別切換」(antigravity.uiFlavor) 的回歸測試（零相依）
//   驗證重點：
//     1. auto 模式維持原行為：VS Code + Copilot → copilot、手動開啟
//        showAntigravityModulesInVsCode 且有 Antigravity → antigravity
//     2. 手動指定類別後，即使身處 VS Code 也能顯示該類別的卡片與路徑
//        （showHostModules = true，不受 show*ModulesInVsCode 開關限制）
//     3. 路徑表 (getGlobalPaths) 與對話紀錄掃描 (collectBrainSessionDirs) 都跟隨指定類別
//     4. 非法設定值一律退回 auto（避免設定檔被手改成亂值時整組壞掉）
//     5. cline 類別：路徑走 ~/.cline（MCP 在 data/settings、對話在 data/sessions），
//        舊版 globalStorage/**/tasks 可作為對話目錄的退回來源；auto 永遠不會選到 cline
//     6. 切換鈕只顯示類別名稱，不再有對話筆數徽章（flavorCounts 自 1.6.0 移除）
//   執行：node tests/environment-flavor.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：所有夾具都在系統暫存目錄，測試結束自動清除，不觸碰真實使用者資料
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-flavor-test');
const HOME = path.join(ROOT, 'home');
const APPDATA = path.join(ROOT, 'appdata');

const VSCODE_EXTENSIONS = path.join(HOME, '.vscode', 'extensions');
const CURSOR_HOME = path.join(HOME, '.cursor');
const GEMINI_CONFIG = path.join(HOME, '.gemini', 'config');
const ANTIGRAVITY_BRAIN = path.join(HOME, '.gemini', 'antigravity-ide', 'brain');
const CURSOR_TRANSCRIPTS = path.join(CURSOR_HOME, 'projects', 'd-PJ-Ai-ai', 'agent-transcripts');
const USER_SETTINGS_DIR = path.join(APPDATA, 'Code', 'User');
const COPILOT_CHAT_DIR = path.join(USER_SETTINGS_DIR, 'workspaceStorage', 'hash-ws-1', 'chatSessions');
const CLINE_HOME = path.join(HOME, '.cline');
const CLINE_DATA = path.join(CLINE_HOME, 'data');
const CLINE_SESSIONS = path.join(CLINE_DATA, 'sessions');
const CLINE_MCP = path.join(CLINE_DATA, 'settings', 'cline_mcp_settings.json');
// Cline 相容用的額外規則路徑（官方文件：~/Documents/Cline/Rules）
const CLINE_DOCS_RULES = path.join(HOME, 'Documents', 'Cline', 'Rules');
// 本工具的全域 Skills 集散地（Cline 也會讀取）
const AGENTS_SKILLS = path.join(HOME, '.agents', 'skills');

// ── 設定檔夾具（可變動，模擬 antigravity.* 設定）────────────────────────────
const configStore = {
  'antigravity.uiFlavor': 'auto',
  'antigravity.showAntigravityModulesInVsCode': false,
  'antigravity.showCopilotModulesInVsCode': true,
  'antigravity.locale': 'zh-TW',
};

function setConfig(key, value) {
  configStore[`antigravity.${key}`] = value;
}

// ── 以 stub 取代 vscode 模組（宿主固定為 VS Code + Copilot）─────────────────
const vscodeStub = {
  env: { appName: 'Visual Studio Code' },
  workspace: {
    workspaceFile: null,
    workspaceFolders: [{ index: 0, name: 'ai', uri: { fsPath: 'D:/PJ/Ai/ai' } }],
    getConfiguration: (section) => ({
      get: (key, defaultValue) => {
        const full = section ? `${section}.${key}` : key;
        return Object.prototype.hasOwnProperty.call(configStore, full) ? configStore[full] : defaultValue;
      },
      update: async (key, value) => {
        setConfig(key, value);
      },
      inspect: () => null,
    }),
  },
  extensions: {
    getExtension: (id) => (id === 'github.copilot-chat' ? { id } : undefined),
  },
  ConfigurationTarget: { Global: 1 },
  Uri: { joinPath: () => ({ fsPath: '' }) },
  window: {
    showInformationMessage: () => undefined,
    showErrorMessage: () => undefined,
    showWarningMessage: async () => undefined,
  },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.apply(this, arguments);
};

// 必須在呼叫服務前改寫家目錄（detectHostIde / getGlobalPaths 皆於呼叫時讀取）
process.env.USERPROFILE = HOME;
process.env.APPDATA = APPDATA;

const systemService = require(path.join(EXT_ROOT, 'services', 'systemService.js'));

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

function createFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  for (const dir of [
    VSCODE_EXTENSIONS,
    CURSOR_HOME,
    GEMINI_CONFIG,
    USER_SETTINGS_DIR,
    path.join(ANTIGRAVITY_BRAIN, 'session-1'),
    path.join(ANTIGRAVITY_BRAIN, 'session-2'),
    path.join(CURSOR_TRANSCRIPTS, 'transcript-1'),
    COPILOT_CHAT_DIR,
    path.join(CLINE_SESSIONS, 'cline-session-1'),
    path.join(CLINE_SESSIONS, 'cline-session-2'),
    path.dirname(CLINE_MCP),
    CLINE_DOCS_RULES,
    AGENTS_SKILLS,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Copilot 對話為單檔 jsonl（非資料夾），另放一個非 jsonl 檔驗證「只數 jsonl」
  fs.writeFileSync(path.join(COPILOT_CHAT_DIR, 'chat-a.jsonl'), '{"v":1}');
  fs.writeFileSync(path.join(COPILOT_CHAT_DIR, 'chat-b.jsonl'), '{"v":1}');
  fs.writeFileSync(path.join(COPILOT_CHAT_DIR, 'notes.txt'), 'ignore me');

  // Cline 的 MCP 設定與 session 內的檔案（檔案不應被當成一筆對話）
  fs.writeFileSync(CLINE_MCP, '{"mcpServers":{}}');
  fs.writeFileSync(path.join(CLINE_SESSIONS, 'index.json'), '{"v":1}');
}

function main() {
  createFixtures();

  // ═══ A. auto 模式：維持既有宿主判定 ═══════════════════════════════════════
  setConfig('uiFlavor', 'auto');
  setConfig('showAntigravityModulesInVsCode', false);
  setConfig('showCopilotModulesInVsCode', true);
  systemService.resetCopilotEnvironmentCache();

  check('A1 auto + VS Code + Copilot → copilot', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.uiFlavor, 'copilot', `實際 ${env.uiFlavor}`);
    assert.strictEqual(env.autoFlavor, 'copilot', `實際 autoFlavor ${env.autoFlavor}`);
    assert.strictEqual(env.flavorOverride, 'auto', '覆寫值應為 auto');
    assert.strictEqual(env.showHostModules, true, 'Copilot 可用時應顯示卡片');
  });

  check('A2 copilot 類別路徑指向 VS Code User 目錄', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.paths.mcpConfig, path.join(USER_SETTINGS_DIR, 'mcp.json'));
    assert.strictEqual(env.paths.rules, path.join(USER_SETTINGS_DIR, 'prompts'));
  });

  check('A3 auto + 手動開啟 showAntigravityModulesInVsCode → antigravity', () => {
    setConfig('showAntigravityModulesInVsCode', true);
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.uiFlavor, 'antigravity', `實際 ${env.uiFlavor}`);
    assert.strictEqual(env.paths.globalConfig, GEMINI_CONFIG);
  });

  check('A4 auto + 兩個卡片開關皆關閉 → 隱藏卡片', () => {
    setConfig('showAntigravityModulesInVsCode', false);
    setConfig('showCopilotModulesInVsCode', false);
    const env = systemService.getEnvironmentInfo();
    // 未指定類別時的預設值為 antigravity（與改動前一致），但卡片必須隱藏
    assert.strictEqual(env.uiFlavor, 'antigravity', `實際 ${env.uiFlavor}`);
    assert.strictEqual(env.showHostModules, false, '兩個開關都關閉時不應顯示卡片');
  });

  // ═══ B. 手動切換：不受宿主與開關限制 ═══════════════════════════════════════
  setConfig('uiFlavor', 'cursor');
  check('B1 手動切換 cursor → 即使卡片開關全關仍顯示', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.uiFlavor, 'cursor', `實際 ${env.uiFlavor}`);
    assert.strictEqual(env.flavorOverride, 'cursor');
    assert.strictEqual(env.showHostModules, true, '手動指定後應強制顯示卡片');
    assert.strictEqual(systemService.resolveFlavor(), 'cursor');
  });

  check('B2 cursor 類別路徑切換為 ~/.cursor 系列', () => {
    const paths = systemService.getGlobalPaths();
    assert.strictEqual(paths.globalConfig, CURSOR_HOME);
    assert.strictEqual(paths.mcpConfig, path.join(CURSOR_HOME, 'mcp.json'));
    assert.strictEqual(paths.brain, path.join(CURSOR_HOME, 'projects', 'd-PJ-Ai-ai', 'agent-transcripts'));
  });

  check('B3 cursor 類別的對話紀錄掃描命中 agent-transcripts', () => {
    const sessions = systemService.collectBrainSessionDirs();
    assert.strictEqual(sessions.length, 1, `實際 ${JSON.stringify(sessions)}`);
    assert.ok(sessions[0].endsWith('transcript-1'), `實際 ${sessions[0]}`);
  });

  setConfig('uiFlavor', 'antigravity');
  check('B4 手動切換 antigravity → 路徑回到 ~/.gemini', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.uiFlavor, 'antigravity');
    assert.strictEqual(env.paths.globalConfig, GEMINI_CONFIG);
    assert.strictEqual(systemService.getGlobalPaths().brain, ANTIGRAVITY_BRAIN);
  });

  check('B5 antigravity 類別只列出資料夾型對話紀錄', () => {
    const sessions = systemService.collectBrainSessionDirs();
    assert.strictEqual(sessions.length, 2, `實際 ${JSON.stringify(sessions)}`);
  });

  setConfig('uiFlavor', 'copilot');
  check('B6 copilot 類別不提供資料夾型對話紀錄（交由 copilotChatService）', () => {
    assert.deepStrictEqual(systemService.collectBrainSessionDirs(), []);
  });

  // ═══ C. 設定值防呆 ═══════════════════════════════════════════════════════
  setConfig('uiFlavor', 'not-a-flavor');
  check('C1 非法設定值退回 auto', () => {
    assert.strictEqual(systemService.getFlavorOverride(), 'auto');
  });

  setConfig('uiFlavor', 'auto');
  check('C2 flavors 可用性回報（本機四類別皆有資料）', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.flavors.antigravity, true, '應偵測到 ~/.gemini/config');
    assert.strictEqual(env.flavors.cursor, true, '應偵測到 ~/.cursor');
    assert.strictEqual(env.flavors.copilot, true, '應由 Copilot 擴充套件判定為 true');
    assert.strictEqual(env.flavors.cline, true, '應偵測到 ~/.cline');
  });

  check('C3 auto 永遠不會判定成 cline（Cline 是外掛，不是宿主）', () => {
    const env = systemService.getEnvironmentInfo();
    assert.notStrictEqual(env.autoFlavor, 'cline', `實際 autoFlavor ${env.autoFlavor}`);
  });

  check('C4 Copilot 偵測快取可重置（切換類別後重新判定）', () => {
    systemService.resetCopilotEnvironmentCache();
    assert.strictEqual(systemService.isCopilotEnvironment(), true, '重置後仍應判定為 Copilot 環境');
  });

  // ═══ D. cline 類別（外掛型資料來源） ═══════════════════════════════════════
  setConfig('uiFlavor', 'cline');
  check('D1 手動切換 cline → 路徑指向 ~/.cline 系列', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.uiFlavor, 'cline', `實際 ${env.uiFlavor}`);
    assert.strictEqual(env.showHostModules, true, '手動指定後應強制顯示卡片');
    assert.strictEqual(env.paths.globalConfig, CLINE_HOME);
    assert.strictEqual(env.paths.appData, CLINE_DATA);
    assert.strictEqual(env.paths.mcpConfig, CLINE_MCP);
    assert.strictEqual(env.paths.brain, CLINE_SESSIONS);
  });

  check('D2 cline 的 rules 取實際存在的那一個（~/.cline/rules 不存在 → ~/Documents/Cline/Rules）', () => {
    const paths = systemService.getGlobalPaths('cline');
    assert.strictEqual(paths.rules, CLINE_DOCS_RULES, `實際 ${paths.rules}`);
    // ~/.cline/skills 不存在 → 退回 ~/.agents/skills（Cline 也會讀取）
    assert.strictEqual(paths.skills, AGENTS_SKILLS, `實際 ${paths.skills}`);
  });

  check('D3 cline 對話掃描只算資料夾（共 2 筆，session 內的 json 檔不算）', () => {
    const sessions = systemService.collectBrainSessionDirs('cline');
    assert.strictEqual(sessions.length, 2, `實際 ${JSON.stringify(sessions)}`);
    assert.ok(sessions.every((dir) => dir.startsWith(CLINE_SESSIONS)), `實際 ${JSON.stringify(sessions)}`);
  });

  check('D4 沒有新版 data/sessions 時，退回舊版 globalStorage/**/tasks', () => {
    const legacyTasks = path.join(
      USER_SETTINGS_DIR, 'globalStorage', 'saoudrizwan.claude-dev', 'tasks', 'task-legacy-1'
    );
    fs.mkdirSync(legacyTasks, { recursive: true });
    const sessionsBackup = CLINE_SESSIONS + '-backup';
    fs.renameSync(CLINE_SESSIONS, sessionsBackup);
    try {
      const paths = systemService.getGlobalPaths('cline');
      assert.strictEqual(paths.brain, path.dirname(legacyTasks), `實際 ${paths.brain}`);
      assert.strictEqual(systemService.collectBrainSessionDirs('cline').length, 1);
    } finally {
      fs.renameSync(sessionsBackup, CLINE_SESSIONS);
    }
  });

  check('D5 切換鈕已無筆數徽章（flavorCounts 不再回傳）', () => {
    const env = systemService.getEnvironmentInfo();
    assert.strictEqual(env.flavorCounts, undefined, `實際 ${JSON.stringify(env.flavorCounts)}`);
    assert.strictEqual(typeof systemService.getFlavorSessionCounts, 'undefined', '筆數 API 應已移除');
  });

  setConfig('uiFlavor', 'auto');

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const [status, label] of results) {
    console.log(`${status}  ${label}`);
  }
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);

  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error('測試執行失敗：', err);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
}

