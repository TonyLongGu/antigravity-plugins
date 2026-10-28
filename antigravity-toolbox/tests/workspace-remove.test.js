// ==============================================================================
// 檔案名稱：tests/workspace-remove.test.js
// 功能說明：多專案工作區「拖曳出面板邊界 → 移除專案」的回歸測試（零相依，vscode 以 stub 取代）
//   為什麼要這一支：面板卡片支援按住拖曳排序，拖出 webview 邊界後放開會發
//   `removeWorkspaceFolder`。移除必須同時處理：
//     1. `folders`（啟用中）與 `disabledFolders`（隱藏中）兩份清單
//     2. `folderOrder`（清單顯示／腳本排序／排除首專案的共同排序依據）
//     3. 重複登記的殘留副本（同路徑不得留在任何一份清單）
//     4. 立即寫檔（移除後 `pushStatus(0)` 必須讀到新內容，不能等 80ms 防抖）
//   驗證重點：
//     R1 移除啟用中專案：folders／folderOrder 同步剔除，其他專案順序不變
//     R2 移除隱藏中專案：只動 disabledFolders
//     R3 找不到路徑：回 false 且完全不寫檔
//     R4 相對路徑與缺少 folderOrder：仍能正確移除且不拋錯
//     R5 重複登記：移除時一併收斂為唯一集合
//     R6 沒有 .code-workspace：回 false 並提示
//   執行：node tests/workspace-remove.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-workspace-remove-test');
const HOME = path.join(ROOT, 'home');
const WS_DIR = path.join(ROOT, 'ws');
const WS_PATH = path.join(WS_DIR, 'Global.code-workspace');
const REMOVED_MESSAGE = '已將專案從多專案工作區移除！';

// ── vscode stub（只滿足被呼叫到的 API）─────────────────────────────────────
const vscodeStub = {
  env: { appName: 'Visual Studio Code' },
  workspace: {
    workspaceFile: { fsPath: WS_PATH },
    workspaceFolders: [],
    getConfiguration: () => ({
      get: (key, defaultValue) => defaultValue,
      update: async () => {},
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

// ── 測試框架 ────────────────────────────────────────────────────────────────
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✘ ${name}\n    ${e.message}`);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (p) => path.resolve(p).toLowerCase();

function caseDir(name) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProject(base, name) {
  const proj = path.join(base, name);
  fs.mkdirSync(proj, { recursive: true });
  return { path: proj, name };
}

function writeWorkspace(json) {
  fs.mkdirSync(WS_DIR, { recursive: true });
  fs.writeFileSync(WS_PATH, `${JSON.stringify(json, null, 2)}\n`, 'utf-8');
  workspaceService.invalidateWorkspaceCache();
}

function readWorkspace() {
  return JSON.parse(fs.readFileSync(WS_PATH, 'utf-8'));
}

function toastCollector() {
  const toasts = [];
  return { toasts, provider: { pushToast: (text, status) => toasts.push({ text, status }) } };
}

async function main() {
  console.log('\n[workspace-remove] 多專案工作區「拖出面板即移除」測試\n');

  await check('R1 移除啟用中專案：folders／folderOrder 同步剔除，其他順序不變', async () => {
    const base = caseDir('r1');
    const a = makeProject(base, 'projA');
    const b = makeProject(base, 'projB');
    const c = makeProject(base, 'projC');
    writeWorkspace({
      folders: [a, b, c],
      disabledFolders: [],
      folderOrder: [a.path, b.path, c.path],
    });

    const { toasts, provider } = toastCollector();
    const removed = workspaceService.removeWorkspaceFolder(b.path, provider);
    assert.strictEqual(removed, true, '應回報已移除');

    const json = readWorkspace();
    assert.deepStrictEqual(
      json.folders.map((f) => key(f.path)),
      [key(a.path), key(c.path)],
      'folders 應只剩 A、C 且順序不變'
    );
    assert.deepStrictEqual(
      json.folderOrder.map(key),
      [key(a.path), key(c.path)],
      'folderOrder 必須同步剔除被移除的專案'
    );
    assert.strictEqual(json.disabledFolders.length, 0, 'disabledFolders 不應被動到');
    assert.ok(
      toasts.some((t) => t.text === REMOVED_MESSAGE && t.status === 'success'),
      `應提示移除成功，實際 ${JSON.stringify(toasts)}`
    );
  });

  await check('R2 移除隱藏中專案：只動 disabledFolders，folders 不動', async () => {
    const base = caseDir('r2');
    const a = makeProject(base, 'projA');
    const b = makeProject(base, 'projB');
    writeWorkspace({
      folders: [a],
      disabledFolders: [b],
      folderOrder: [a.path, b.path],
    });

    const removed = workspaceService.removeWorkspaceFolder(b.path);
    assert.strictEqual(removed, true);

    const json = readWorkspace();
    assert.deepStrictEqual(json.folders.map((f) => key(f.path)), [key(a.path)], 'folders 應保持原樣');
    assert.strictEqual(json.disabledFolders.length, 0, 'disabledFolders 應已清空');
    assert.deepStrictEqual(json.folderOrder.map(key), [key(a.path)], 'folderOrder 應只剩 A');
  });

  await check('R3 找不到路徑：回 false 且完全不寫檔', async () => {
    const base = caseDir('r3');
    const a = makeProject(base, 'projA');
    writeWorkspace({ folders: [a], disabledFolders: [], folderOrder: [a.path] });

    const before = fs.readFileSync(WS_PATH, 'utf-8');
    const beforeMtime = fs.statSync(WS_PATH).mtimeMs;
    await wait(30);

    const { toasts, provider } = toastCollector();
    const removed = workspaceService.removeWorkspaceFolder(path.join(base, 'not-exist'), provider);

    assert.strictEqual(removed, false, '找不到專案時應回 false');
    assert.strictEqual(fs.readFileSync(WS_PATH, 'utf-8'), before, '內容不得變更');
    assert.strictEqual(fs.statSync(WS_PATH).mtimeMs, beforeMtime, '不得寫檔（mtime 不變）');
    assert.ok(
      toasts.some((t) => t.status === 'warning'),
      '應以 warning 提示找不到專案'
    );
  });

  await check('R4 相對路徑＋缺少 folderOrder：可正常移除且不拋錯', async () => {
    const base = caseDir('r4');
    const relName = 'relProj';
    fs.mkdirSync(path.join(WS_DIR, relName), { recursive: true });
    const keep = makeProject(base, 'keepProj');
    writeWorkspace({
      folders: [{ path: relName, name: 'Rel Proj' }, keep],
      disabledFolders: [],
    });

    // 前端送來的是絕對路徑（analyzeWorkspace 正規化後的 fullPath），檔案內存的是相對路徑
    const removed = workspaceService.removeWorkspaceFolder(path.join(WS_DIR, relName));
    assert.strictEqual(removed, true, '相對路徑登記的專案也必須能移除');

    const json = readWorkspace();
    assert.deepStrictEqual(json.folders.map((f) => key(f.path)), [key(keep.path)], '只應留下 keepProj');
    assert.ok(Array.isArray(json.folderOrder), 'folderOrder 應被建立為陣列');
    assert.deepStrictEqual(json.folderOrder.map(key), [key(keep.path)], 'folderOrder 應只含 keepProj');
  });

  await check('R5 重複登記：移除時一併收斂為唯一集合', async () => {
    const base = caseDir('r5');
    const a = makeProject(base, 'projA');
    const b = makeProject(base, 'projB');
    writeWorkspace({
      folders: [a, a, b],
      disabledFolders: [],
      folderOrder: [a.path, a.path, b.path],
    });

    const removed = workspaceService.removeWorkspaceFolder(a.path);
    assert.strictEqual(removed, true);

    const json = readWorkspace();
    assert.deepStrictEqual(json.folders.map((f) => key(f.path)), [key(b.path)], '重複的 A 應全部消失');
    assert.strictEqual(new Set(json.folderOrder.map(key)).size, json.folderOrder.length, 'folderOrder 不得有重複');
    assert.deepStrictEqual(json.folderOrder.map(key), [key(b.path)], 'folderOrder 應只剩 B');
  });

  await check('R6 沒有 .code-workspace：回 false 並提示', async () => {
    const originalFile = vscodeStub.workspace.workspaceFile;
    vscodeStub.workspace.workspaceFile = null;
    workspaceService.invalidateWorkspaceCache();

    try {
      const { toasts, provider } = toastCollector();
      const removed = workspaceService.removeWorkspaceFolder('C:\\some\\project', provider);
      assert.strictEqual(removed, false, '單資料夾／無工作區時不得移除');
      assert.ok(toasts.some((t) => t.status === 'warning'), '應提示尚未開啟多專案工作區');
    } finally {
      vscodeStub.workspace.workspaceFile = originalFile;
      workspaceService.invalidateWorkspaceCache();
    }
  });

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}

  console.log(`\n[workspace-remove] ${failed === 0 ? '全部通過' : `${failed} 項失敗`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
