/**
 * 後端面板生命週期與訊息流驗證（以 mock vscode API 實際載入 extension.js）
 *
 * 驗證重點：
 *   1. 開檔（自訂編輯器）沿用 VS Code 既有分頁，initData 標記 isCustomEditor 並帶出目標檔
 *   2. 「展開為資料夾畫廊」→ 建立標題為「類型: 資料夾名」的畫廊分頁，並關閉原檔案分頁
 *   3. 同資料夾已有畫廊分頁時改為喚醒（不重複開分頁）並送 revealInGallery
 *   4. closeCustomEditor 守門：畫廊分頁不得被誤關
 *
 * 設計取捨：
 *   - 用「輪詢等待」而非固定 sleep，降低慢機器上的偽陰性。
 *   - 收尾一律 deactivate() + 刪除臨時素材 + process.exit()，
 *     避免串流伺服器行程殘留（曾發生過：測試程序不退出，佔用暫存檔）。
 *
 * 用法：node tests/backend.smoke.js
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_DIR = path.join(__dirname, '..');
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'script-runner-smoke-')).replace(/\\/g, '/');
const FIXTURE_NAME = path.basename(FIXTURE_DIR);
for (const name of ['a.png', 'b.png', 'c.jpg', 'd.mp4', 'e.mp3']) {
  fs.writeFileSync(path.join(FIXTURE_DIR, name), 'x');
}

let failed = 0;
let checked = 0;
const ok = (cond, label) => {
  checked++;
  if (cond) console.log('  PASS  ' + label);
  else { failed++; console.log('  FAIL  ' + label); }
};
const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = Date.now();
  for (;;) {
    if (predicate()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
};

// ===========================================================================
// mock vscode API（只實作 extension.js 實際用到的介面）
// ===========================================================================
class EventEmitter {
  constructor() { this._listeners = new Set(); }
  get event() { return (cb) => { this._listeners.add(cb); return { dispose() {} }; }; }
  fire(value) { this._listeners.forEach((cb) => cb(value)); }
  dispose() {}
}

function makeUri(p) {
  const fsPath = String(p).replace(/\\/g, '/');
  return {
    scheme: 'file',
    fsPath,
    path: fsPath,
    toString: () => 'file:///' + fsPath.replace(/^\//, ''),
    with: () => makeUri(p)
  };
}

const createdPanels = [];
const customEditorProviders = new Map();
const registeredCommands = new Map();

/** 建立假的 WebviewPanel，可觀察 postMessage 與 dispose */
function makePanel(id, title, column, options) {
  const messageListeners = new Set();
  const disposeListeners = new Set();
  const panel = {
    id,
    title,
    viewColumn: column,
    visible: true,
    _posted: [],
    _disposed: false,
    /** 測試專用：模擬 Webview 送出訊息 */
    _send: (msg) => { messageListeners.forEach((cb) => cb(msg)); },
    reveal() { panel.visible = true; },
    dispose() {
      if (panel._disposed) return;
      panel._disposed = true;
      disposeListeners.forEach((cb) => cb());
    },
    onDidDispose: (cb) => { disposeListeners.add(cb); return { dispose() {} }; },
    onDidChangeViewState: () => ({ dispose() {} })
  };
  panel.webview = {
    options: options || {},
    html: '',
    cspSource: 'vscode-webview://test',
    asWebviewUri: (uri) => ({ toString: () => 'https://webview.test/' + uri.fsPath }),
    postMessage: (msg) => { panel._posted.push(msg); return Promise.resolve(true); },
    onDidReceiveMessage: (cb) => { messageListeners.add(cb); return { dispose() {} }; }
  };
  createdPanels.push(panel);
  return panel;
}

const vscodeMock = {
  Uri: {
    file: makeUri,
    joinPath: (...parts) => makeUri(parts.map((p) => (typeof p === 'string' ? p : p.fsPath)).join('/')),
    parse: (s) => makeUri(s)
  },
  ViewColumn: { Active: -1, One: 1, Two: 2 },
  EventEmitter,
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  FileType: { File: 1, Directory: 2 },
  Disposable: class { constructor(fn) { this.dispose = fn || (() => {}); } },
  window: {
    activeTextEditor: null,
    terminals: [],
    tabGroups: { all: [] },
    createTerminal: () => ({ name: 'test-terminal', show() {}, sendText() {}, dispose() {} }),
    createWebviewPanel: (id, title, column, options) => makePanel(id, title, column, options),
    registerCustomEditorProvider: (id, provider) => {
      customEditorProviders.set(id, provider);
      return { dispose() {} };
    },
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    withProgress: (opts, task) => task({ report() {} }, { isCancellationRequested: false }),
    onDidChangeActiveTerminal: () => ({ dispose() {} })
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: () => undefined, update: () => Promise.resolve() }),
    fs: {
      readFile: fs.promises.readFile,
      stat: fs.promises.stat,
      delete: () => Promise.resolve(),
      readDirectory: () => Promise.resolve([])
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }),
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose() {} }),
      onDidCreate: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} }),
      dispose() {}
    })
  },
  commands: {
    registerCommand: (id, cb) => { registeredCommands.set(id, cb); return { dispose() {} }; },
    executeCommand: () => Promise.resolve()
  },
  env: { language: 'zh-tw' }
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.apply(this, arguments);
};

const extension = require(path.join(EXT_DIR, 'extension.js'));
const context = {
  subscriptions: [],
  extensionUri: makeUri(EXT_DIR),
  extensionPath: EXT_DIR,
  globalState: { get: () => undefined, update: () => Promise.resolve() },
  workspaceState: { get: () => undefined, update: () => Promise.resolve() }
};
extension.activate(context);

// ===========================================================================
// 測試案例
// ===========================================================================
const CASES = [
  { type: 'image', providerId: 'scriptRunner.imageViewer', file: 'a.png', titlePrefix: '圖片' },
  { type: 'video', providerId: 'scriptRunner.videoViewer', file: 'd.mp4', titlePrefix: '影片' },
  { type: 'audio', providerId: 'scriptRunner.audioViewer', file: 'e.mp3', titlePrefix: '聲音' }
];

/** 模擬「在檔案總管雙擊多媒體檔」：VS Code 以自訂編輯器開啟，沿用既有分頁 */
async function openFileTab(testCase) {
  const provider = customEditorProviders.get(testCase.providerId);
  ok(!!provider, `[${testCase.type}] 已註冊自訂編輯器 provider`);
  const filePath = FIXTURE_DIR + '/' + testCase.file;
  const document = provider.openCustomDocument(makeUri(filePath));
  const panel = makePanel(testCase.providerId, testCase.file, 1, {});
  const panelCountBefore = createdPanels.length;

  await provider.resolveCustomEditor(document, panel, { isCancellationRequested: false });
  ok(createdPanels.length === panelCountBefore, `[${testCase.type}] 開檔沿用 VS Code 既有分頁（未另開新分頁）`);

  panel._send({ type: 'ready' });
  const gotInitData = await waitFor(() => panel._posted.some((m) => m.type === 'initData'));
  const init = panel._posted.find((m) => m.type === 'initData');
  ok(gotInitData, `[${testCase.type}] 收到 ready 後送出 initData`);
  ok(!!init && init.isCustomEditor === true, `[${testCase.type}] initData 標記為檔案分頁 (isCustomEditor=true)`);
  ok(!!init && init.targetFilePath === filePath, `[${testCase.type}] initData 帶出目標檔路徑`);
  return { panel, filePath };
}

async function runCase(testCase) {
  console.log(`\n=== ${testCase.type}：檔案分頁「退出/展開」→ 轉入父層資料夾畫廊分頁 ===`);
  const { panel, filePath } = await openFileTab(testCase);

  // 1) 檔案分頁展開為畫廊
  const before = createdPanels.length;
  panel._posted.length = 0;
  panel._send({ type: 'expandToFolderGallery', filePath, selectFile: false });
  await waitFor(() => createdPanels.length === before + 1);

  const galleryPanel = createdPanels.slice(before).find((p) => !p._disposed);
  ok(createdPanels.length === before + 1, `[${testCase.type}] 展開時建立資料夾畫廊分頁`);
  ok(!!galleryPanel && galleryPanel.title === `${testCase.titlePrefix}: ${FIXTURE_NAME}`,
    `[${testCase.type}] 畫廊分頁標題為父層資料夾名（實際：${galleryPanel ? galleryPanel.title : 'none'}）`);
  ok(panel._disposed === true, `[${testCase.type}] 原檔案分頁已被關閉（不再殘留檔名分頁）`);

  // 2) 畫廊分頁載入（Webview ready）後才送 initData，其中需帶出待定位檔
  galleryPanel._send({ type: 'ready' });
  await waitFor(() => galleryPanel._posted.some((m) => m.type === 'initData'));
  const galleryInit = galleryPanel._posted.find((m) => m.type === 'initData');
  ok(!!galleryInit && galleryInit.isCustomEditor === false, `[${testCase.type}] 畫廊分頁標記為非自訂編輯器`);
  ok(!!galleryInit && galleryInit.revealFilePath === filePath, `[${testCase.type}] 畫廊分頁 initData 帶出待定位檔路徑（首次載入即定位）`);
  ok(!!galleryInit && galleryInit.selectFilePath === null, `[${testCase.type}] 未要求選取時 selectFilePath 為 null`);
  ok(!!galleryInit && galleryInit.folderPath === FIXTURE_DIR, `[${testCase.type}] 畫廊分頁指向父層資料夾（可瀏覽該資料夾全部檔案）`);

  // 3) 同資料夾再次展開：應喚醒既有畫廊分頁，不重複開分頁
  const second = await openFileTab(testCase);
  const beforeSecond = createdPanels.length;
  second.panel._posted.length = 0;
  galleryPanel._posted.length = 0;
  second.panel._send({ type: 'expandToFolderGallery', filePath: second.filePath, selectFile: true });
  await waitFor(() => galleryPanel._posted.length > 0);
  ok(createdPanels.length === beforeSecond, `[${testCase.type}] 既有畫廊分頁存在時不重複開新分頁（改喚醒既有分頁）`);
  ok(galleryPanel._posted.some((m) => m.type === 'revealInGallery' && m.filePath === second.filePath && m.select === true),
    `[${testCase.type}] 既有畫廊分頁收到 revealInGallery（並要求選取該檔）`);
  ok(second.panel._disposed === true, `[${testCase.type}] 該次的檔案分頁亦被關閉`);

  // 4) 守門：畫廊分頁不可被 closeCustomEditor 誤關（負向斷言，需給一點處理時間）
  galleryPanel._send({ type: 'closeCustomEditor' });
  await new Promise((r) => setTimeout(r, 80));
  ok(galleryPanel._disposed === false, `[${testCase.type}] 畫廊分頁收到 closeCustomEditor 時不會被關閉（防誤關守門有效）`);
}

(async () => {
  try {
    for (const testCase of CASES) {
      await runCase(testCase);
    }
  } finally {
    // 收尾：關閉串流伺服器、刪除臨時素材，確保程序可正常結束
    try { extension.deactivate(); } catch (_) {}
    try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n---------------------------------------------');
  console.log((failed === 0 ? 'BACKEND-ALL-ASSERTIONS-PASSED' : 'BACKEND-TEST-FAILED')
    + '  (checked=' + checked + ', failed=' + failed + ')');
  process.exit(failed === 0 ? 0 : 1);
})();

