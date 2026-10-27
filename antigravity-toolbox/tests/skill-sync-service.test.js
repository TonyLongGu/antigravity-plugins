// ==============================================================================
// 檔案名稱：tests/skill-sync-service.test.js
// 功能說明：Skills 連結同步「服務層」接線的回歸測試（零相依，vscode 以 stub 取代）
//   為什麼要這一支：bug 不在 junction 工具本身，而在 workspaceService.maybeSyncSkills()
//   把「空的 folders」當成「沒有工作區資訊」而跳過同步。這裡直接走擴充套件的真實呼叫鏈：
//     maybeSyncSkills() → skillSyncService.syncEnabledProjectSkills() → syncWorkspaceSkills()
//   驗證重點：
//     1. 專案開關後依 folders 對齊連結（停用的專案移到 disabledFolders）
//     2. 【回歸】最後一個專案被關掉（folders 變空）時，連結一定要被解除，不得回 skipped
//     3. 【回歸】只剩沒有 skills 的專案時，先前專案的連結也要被解除
//     4. 同步主開關關閉時，maybeSyncSkills 不得改動全域目錄
//   執行：node tests/skill-sync-service.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：USERPROFILE／APPDATA／workspace 設定全部指向系統暫存目錄的夾具
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-skill-sync-service-test');
const HOME = path.join(ROOT, 'home');
const GLOBAL_SKILLS = path.join(HOME, '.agents', 'skills');

// ── 設定檔夾具 ──────────────────────────────────────────────────────────────
const configStore = {
  'antigravity.syncSkillsOnFolderToggle': true,
  'antigravity.skillSyncExcludeFirstProject': false,
  'antigravity.locale': 'zh-TW',
};

// ── vscode stub（只要滿足被呼叫到的 API）───────────────────────────────────
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
      update: async (key, value) => {
        configStore[`antigravity.${key}`] = value;
      },
      inspect: () => null,
    }),
    createFileSystemWatcher: () => ({
      onDidCreate: () => {},
      onDidDelete: () => {},
      onDidChange: () => {},
      dispose: () => {},
    }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  Uri: { file: (p) => ({ fsPath: p }), joinPath: () => ({ fsPath: '' }) },
  RelativePattern: class {},
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
process.env.APPDATA = path.join(ROOT, 'appdata');

const workspaceService = require(path.join(EXT_ROOT, 'services', 'workspaceService.js'));
const skillSyncService = require(path.join(EXT_ROOT, 'services', 'skillSyncService.js'));

// ── 測試框架 ────────────────────────────────────────────────────────────────
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✘ ${name}\n    ${e.message}`);
  }
}

// ── 夾具 ────────────────────────────────────────────────────────────────────
function caseDir(name) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProject(base, name, skills = []) {
  const proj = path.join(base, name);
  fs.mkdirSync(proj, { recursive: true });
  for (const skill of skills) {
    fs.mkdirSync(path.join(proj, '.agents', 'skills', skill), { recursive: true });
  }
  return { path: proj, name };
}

function entries(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** 模擬 workbench 的專案開關：停用的專案會被移到 disabledFolders */
function toggle(json, target) {
  const activeIndex = json.folders.findIndex((f) => f.path === target.path);
  if (activeIndex !== -1) {
    const [moved] = json.folders.splice(activeIndex, 1);
    json.disabledFolders.push(moved);
    return;
  }
  const disabledIndex = json.disabledFolders.findIndex((f) => f.path === target.path);
  if (disabledIndex !== -1) {
    const [moved] = json.disabledFolders.splice(disabledIndex, 1);
    json.folders.push(moved);
  }
}

function runSync(json, wsDir) {
  const toasts = [];
  workspaceService.maybeSyncSkills(json, wsDir, {
    pushToast: (text, type) => toasts.push({ text, type }),
    pushStatus: () => {},
  });
  return toasts;
}

function removeLinksOnly(dir) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of list) {
    const full = path.join(dir, entry.name);
    let isLink = false;
    try {
      isLink = fs.lstatSync(full).isSymbolicLink();
    } catch {}
    if (!isLink) continue;
    try { fs.rmSync(full, { recursive: false, force: true }); } catch {}
    try { if (fs.existsSync(full)) fs.rmdirSync(full); } catch {}
  }
}

function resetGlobalDir() {
  removeLinksOnly(GLOBAL_SKILLS);
  fs.rmSync(GLOBAL_SKILLS, { recursive: true, force: true });
  fs.mkdirSync(GLOBAL_SKILLS, { recursive: true });
}

// ── 測試本體 ────────────────────────────────────────────────────────────────
function main() {
  console.log('\n[skill-sync-service] 檢查「專案開關 → 全域 Skills 連結」的實際呼叫鏈\n');

  check('I1 依啟用專案建立連結', () => {
    resetGlobalDir();
    const base = caseDir('i1');
    const a = makeProject(base, 'projA', ['alpha']);
    const b = makeProject(base, 'projB', ['gamma']);
    const json = { folders: [a, b], disabledFolders: [] };

    runSync(json, base);

    assert.deepStrictEqual(entries(GLOBAL_SKILLS), ['alpha', 'gamma']);
  });

  check('I2 關閉一個專案：該專案的連結被解除', () => {
    resetGlobalDir();
    const base = caseDir('i2');
    const a = makeProject(base, 'projA', ['alpha']);
    const b = makeProject(base, 'projB', ['gamma']);
    const json = { folders: [a, b], disabledFolders: [] };

    runSync(json, base);
    toggle(json, b);
    runSync(json, base);

    assert.strictEqual(json.folders.length, 1, 'folders 應只剩 A');
    assert.deepStrictEqual(entries(GLOBAL_SKILLS), ['alpha']);
  });

  check('I3【回歸】關閉最後一個專案：連結必須全部解除（舊版殘留）', () => {
    resetGlobalDir();
    const base = caseDir('i3');
    const a = makeProject(base, 'projA', ['alpha']);
    const b = makeProject(base, 'projB', ['gamma']);
    const json = { folders: [a, b], disabledFolders: [] };

    runSync(json, base);
    toggle(json, b);
    runSync(json, base);
    toggle(json, a);
    const toasts = runSync(json, base);

    assert.strictEqual(json.folders.length, 0, 'folders 應已清空');
    assert.strictEqual(json.disabledFolders.length, 2, '兩個專案都應在 disabledFolders');
    assert.deepStrictEqual(entries(GLOBAL_SKILLS), [], '不得殘留任何連結');
    assert.ok(
      toasts.some((t) => t.text.includes('解除 1')),
      `應回報解除 1 個連結，實際 ${JSON.stringify(toasts)}`
    );
  });

  check('I4【回歸】只剩沒有 skills 的專案：先前專案的連結仍要被解除', () => {
    resetGlobalDir();
    const base = caseDir('i4');
    const a = makeProject(base, 'projA', ['alpha']);
    const b = makeProject(base, 'projB', ['gamma']);
    const empty = makeProject(base, 'projEmpty', []);
    const json = { folders: [a, b, empty], disabledFolders: [] };

    runSync(json, base);
    assert.deepStrictEqual(entries(GLOBAL_SKILLS), ['alpha', 'gamma']);

    toggle(json, a);
    toggle(json, b);
    const toasts = runSync(json, base);

    assert.deepStrictEqual(json.folders, [empty], '啟用清單應只剩沒有 skills 的專案');
    assert.deepStrictEqual(entries(GLOBAL_SKILLS), [], '殘留連結必須被解除');
    assert.ok(
      toasts.some((t) => t.text.includes('解除 2')),
      `應回報解除 2 個連結，實際 ${JSON.stringify(toasts)}`
    );
  });

  check('I5 同步主開關關閉時，專案開關不得改動全域目錄', () => {
    resetGlobalDir();
    const base = caseDir('i5');
    const a = makeProject(base, 'projA', ['alpha']);
    const json = { folders: [a], disabledFolders: [] };

    configStore['antigravity.syncSkillsOnFolderToggle'] = false;
    try {
      runSync(json, base);
      assert.deepStrictEqual(entries(GLOBAL_SKILLS), [], '關閉同步時不得建立連結');
    } finally {
      configStore['antigravity.syncSkillsOnFolderToggle'] = true;
    }
  });

  cleanup();

  console.log(`\n[skill-sync-service] ${failed === 0 ? '全部通過' : `${failed} 項失敗`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function cleanup() {
  removeLinksOnly(GLOBAL_SKILLS);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
}

main();
