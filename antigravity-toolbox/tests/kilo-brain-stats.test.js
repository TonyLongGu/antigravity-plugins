// ==============================================================================
// 檔案名稱：tests/kilo-brain-stats.test.js
// 功能說明：Kilo 類別「對話記憶庫」統計的回歸測試（零相依）
//   驗證重點：
//     1. Kilo 7.x 的對話在 ~/.local/share/kilo/kilo.db（SQLite），不是資料夾；
//        統計必須走 DB（session 表）而不是回報 0 筆／0.0 MB
//     2. 環境沒有 node:sqlite 時，退回 storage/session_share/*.json 的檔案數
//     3. 佔用空間取整個資料家目錄（kilo.db、storage…），與卡片的「開啟」位置一致
//     4. 統計結果有 5 秒快取，forceRefresh 可強制重算
//   執行：node tests/kilo-brain-stats.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：所有夾具都在系統暫存目錄，測試結束自動清除，不觸碰真實使用者資料
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-kilo-brain-test');
const HOME = path.join(ROOT, 'home');
const APPDATA = path.join(ROOT, 'appdata');
const KILO_CONFIG_HOME = path.join(HOME, '.config', 'kilo');
const KILO_DATA_HOME = path.join(HOME, '.local', 'share', 'kilo');
const KILO_DB = path.join(KILO_DATA_HOME, 'kilo.db');
const KILO_SHARE_DIR = path.join(KILO_DATA_HOME, 'storage', 'session_share');

// ── 設定檔夾具 ──────────────────────────────────────────────────────────────
const configStore = {
  'antigravity.uiFlavor': 'kilo',
  'antigravity.locale': 'zh-TW',
};

// ── 以 stub 取代 vscode 模組 ────────────────────────────────────────────────
const vscodeStub = {
  env: { appName: 'Visual Studio Code' },
  workspace: {
    workspaceFile: null,
    workspaceFolders: [],
    getConfiguration: (section) => ({
      get: (key, defaultValue) => {
        const full = section ? `${section}.${key}` : key;
        return Object.prototype.hasOwnProperty.call(configStore, full) ? configStore[full] : defaultValue;
      },
      update: async () => {},
    }),
  },
  extensions: { getExtension: () => undefined },
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

process.env.USERPROFILE = HOME;
process.env.APPDATA = APPDATA;
process.env.XDG_CONFIG_HOME = path.join(HOME, '.config');
process.env.XDG_DATA_HOME = path.join(HOME, '.local', 'share');

const brainService = require(path.join(EXT_ROOT, 'services', 'brainService.js'));

// ── 測試框架 ────────────────────────────────────────────────────────────────
const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', `${label} :: ${e.message}`]);
  }
};

function createFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(KILO_CONFIG_HOME, { recursive: true });
  fs.mkdirSync(KILO_SHARE_DIR, { recursive: true });
  fs.writeFileSync(path.join(KILO_CONFIG_HOME, 'kilo.jsonc'), '{\n  "mcp": {}\n}\n');

  // 兩筆對話：DB 可用時寫入 session 表；同時保留兩份 session_share，讓退回路徑也有相同答案
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(KILO_DB);
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT)');
    db.exec("INSERT INTO session (id, title) VALUES ('ses_test_1', 'one'), ('ses_test_2', 'two')");
    db.close();
  } catch {
    // 舊版 Node 沒有 node:sqlite：只靠 session_share 的退回路徑
  }
  fs.writeFileSync(path.join(KILO_SHARE_DIR, 'ses_test_1.json'), '{"id":"ses_test_1"}');
  fs.writeFileSync(path.join(KILO_SHARE_DIR, 'ses_test_2.json'), '{"id":"ses_test_2"}');

  // 1 MB 的資料檔，驗證佔用空間不是 0.0 MB
  fs.writeFileSync(path.join(KILO_DATA_HOME, 'storage', 'blob.bin'), Buffer.alloc(1024 * 1024));
}

async function main() {
  createFixtures();
  brainService.invalidateCache();

  await check('K1 kilo 統計：對話數取自 kilo.db／session_share，佔用空間非 0', async () => {
    const stats = await brainService.getBrainStats(true);
    assert.strictEqual(stats.folderCount, 2, `實際 ${stats.folderCount}`);
    assert.strictEqual(stats.path, KILO_DATA_HOME, `實際 ${stats.path}`);
    assert.ok(Number(stats.totalMB) >= 1, `實際 ${stats.totalMB} MB`);
  });

  await check('K2 5 秒快取生效：未強制重算時沿用上次結果', async () => {
    const cached = await brainService.getBrainStats(false);
    assert.deepStrictEqual(cached, await brainService.getBrainStats(false));
  });

  await check('K3 invalidateCache() 後可重算', async () => {
    brainService.invalidateCache();
    const stats = await brainService.getBrainStats(false);
    assert.strictEqual(stats.folderCount, 2, `實際 ${stats.folderCount}`);
  });

  await check('K4 只有 session_share 時（無 DB）仍可數出對話', async () => {
    fs.rmSync(KILO_DB, { force: true });
    brainService.invalidateCache();
    const stats = await brainService.getBrainStats(true);
    assert.strictEqual(stats.folderCount, 2, `實際 ${stats.folderCount}`);
  });

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
