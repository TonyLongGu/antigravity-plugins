// ==============================================================================
// 檔案名稱：tests/workspace-dedupe.test.js
// 功能說明：多專案工作區「重複登記」修復的回歸測試（零相依，vscode 以 stub 取代）
//   為什麼要這一支：VS Code「將資料夾加入工作區」對**已載入**的專案再按一次，會在 folders
//   內再插一筆同路徑。舊版只有「同名修正」、沒有去重，於是：
//     1. 面板出現兩份同名專案，切換開關只會動到第一筆（重複在兩份清單間分裂）
//     2. syncFolderOrder() 以長度比對唯一序列 ⇒ hasSequenceDiff 恆真 ⇒ 每次
//        analyzeWorkspace() 都空寫一次工作區檔（實測 .bak 與主檔同內容、時間戳只差 1 秒）
//   驗證重點：
//     D1 analyzeWorkspace() 自癒：移除 folders 內重複 ＋ 跨清單重複（啟用優先）
//     D2【回歸】自癒後再次分析不得再寫檔（不是「寫入相同內容」而是「完全不寫」）
//     D3 fixWorkspaceDuplicates() 同時處理重複登記與同名衝突
//     D4 setWorkspaceFolderEnabled() 遇到重複項：只留一筆並正確移到停用清單
//     D5 dedupeWorkspaceItems() 純函式邊界（缺欄位／空清單不算變更）
//   執行：node tests/workspace-dedupe.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-workspace-dedupe-test');
const HOME = path.join(ROOT, 'home');
const WS_PATH = path.join(ROOT, 'ws', 'Global.code-workspace');

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


// ── 測試框架（支援 await，因為 saveWorkspaceJson 預設防抖 80ms）─────────────
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
  fs.mkdirSync(path.dirname(WS_PATH), { recursive: true });
  fs.writeFileSync(WS_PATH, `${JSON.stringify(json, null, 2)}\n`, 'utf-8');
  workspaceService.invalidateWorkspaceCache();
}

function readWorkspace() {
  return JSON.parse(fs.readFileSync(WS_PATH, 'utf-8'));
}

/** canonical 路徑鍵（Windows 大小寫不敏感，與服務層一致） */
function key(p) {
  return fs.realpathSync.native(path.normalize(p)).toLowerCase();
}

async function main() {
  console.log('\n[workspace-dedupe] 檢查「重複登記」的自癒、修復與不空寫\n');

  await check('D1 analyzeWorkspace() 自癒：folders 內重複 ＋ 跨清單重複（啟用優先）', async () => {
    const base = caseDir('d1');
    const a = makeProject(base, 'projA');
    const b = makeProject(base, 'projB');
    const c = makeProject(base, 'projC');
    writeWorkspace({ folders: [a, a, b], disabledFolders: [b, c] });

    const status = workspaceService.analyzeWorkspace();
    assert.strictEqual(
      status.deduplicatedCount,
      2,
      `應移除 2 筆（A 重複 1、B 跨清單 1），實際 ${status.deduplicatedCount}`
    );

    await wait(200);
    const json = readWorkspace();
    assert.strictEqual(json.folders.length, 2, 'folders 應只剩 A、B');
    assert.strictEqual(json.disabledFolders.length, 1, 'disabledFolders 應只剩 C（B 已在啟用清單）');
    assert.strictEqual(new Set(json.folders.map((f) => key(f.path))).size, 2, 'folders 不得有重複路徑');
    assert.strictEqual(json.folderOrder.length, 3, 'folderOrder 應收斂為 3 個唯一路徑');
  });

  await check('D2【回歸】自癒後再次分析：不得再寫檔（舊版每輪都空寫）', async () => {
    workspaceService.invalidateWorkspaceCache();
    workspaceService.analyzeWorkspace();
    await wait(200);

    const before = fs.statSync(WS_PATH).mtimeMs;
    await wait(30);
    workspaceService.analyzeWorkspace();
    await wait(200);
    const after = fs.statSync(WS_PATH).mtimeMs;

    assert.strictEqual(after, before, `分析不應改寫檔案（mtime ${before} → ${after}）`);
  });

  await check('D3 fixWorkspaceDuplicates() 同時修重複登記與同名衝突', async () => {
    const base = caseDir('d3');
    const x = makeProject(path.join(base, 'x'), 'proj');
    const y = makeProject(path.join(base, 'y'), 'proj');
    writeWorkspace({ folders: [x, x, y], disabledFolders: [] });

    const toasts = [];
    const changed = workspaceService.fixWorkspaceDuplicates({
      pushToast: (text, status) => toasts.push({ text, status }),
    });
    assert.strictEqual(changed, true, '應回報已變更');

    await wait(200);
    const json = readWorkspace();
    assert.strictEqual(json.folders.length, 2, '重複的 x 應被移除');
    assert.deepStrictEqual(
      json.folders.map((f) => f.name),
      ['x \\ proj', 'y \\ proj'],
      '同名專案應補上「父資料夾 \\ 專案名」'
    );
    assert.ok(
      toasts.some((t) => t.text.includes('移除 1 筆重複登記的專案')),
      `訊息應回報移除重複，實際 ${JSON.stringify(toasts)}`
    );
    assert.ok(
      toasts.some((t) => t.text.includes('修正 2 個專案名稱')),
      `訊息應回報名稱修正，實際 ${JSON.stringify(toasts)}`
    );
  });

  await check('D4 setWorkspaceFolderEnabled() 遇到重複項：只留一筆並移到停用清單', async () => {
    const base = caseDir('d4');
    const a = makeProject(base, 'projA');
    writeWorkspace({ folders: [a, a], disabledFolders: [] });

    workspaceService.setWorkspaceFolderEnabled(a.path, false);

    await wait(300);
    const json = readWorkspace();
    assert.strictEqual(json.folders.length, 0, 'folders 應已清空（不得留下第二筆重複）');
    assert.strictEqual(json.disabledFolders.length, 1, '停用清單應只有一筆');
    assert.strictEqual(key(json.disabledFolders[0].path), key(a.path));
  });

  await check('D5 dedupeWorkspaceItems() 邊界：缺欄位／空清單不算變更', () => {
    const base = caseDir('d5');
    const a = makeProject(base, 'projA');

    assert.strictEqual(
      workspaceService.dedupeWorkspaceItems({}, base).changed,
      false,
      '缺 folders／disabledFolders 不應視為變更'
    );
    assert.strictEqual(
      workspaceService.dedupeWorkspaceItems({ folders: [a], disabledFolders: [] }, base).changed,
      false,
      '沒有重複時不應回報變更'
    );
    const json = { folders: [a, a], disabledFolders: [] };
    const result = workspaceService.dedupeWorkspaceItems(json, base);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.removed.length, 1);
    assert.strictEqual(json.folders.length, 1, '應就地修正傳入的物件');
  });

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}

  console.log(`\n[workspace-dedupe] ${failed === 0 ? '全部通過' : `${failed} 項失敗`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

