// ==============================================================================
// 檔案名稱：tests/snapshot-source-default.test.js
// 功能說明：對話快照「來源 chips 預設跟隨宿主」回歸測試（零相依，直接以 node 執行）
//   驗證重點：
//     1. 未手動選擇（workspaceState 無 sourceFilter）⇒ 一律載入宿主原生來源
//     2. 使用者點過 chip 後（含 'all'）⇒ 沿用最後選擇，並寫回 workspaceState
//     3. 指定來源不可用時退回宿主原生來源
//     4. Webview HTML 會注入 INITIAL_SOURCE_FILTER（'' = 跟隨宿主）
//   執行：node tests/snapshot-source-default.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：以 Module._load 攔截 require('vscode')，不載入真實 IDE；狀態用記憶體 memento
// ==============================================================================

const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');

/** 最小可用的 workspaceState（Memento）替身 */
function createMemento(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get(key) {
      return store.get(key);
    },
    update(key, value) {
      store.set(key, value);
      return Promise.resolve();
    },
    _store: store
  };
}

let capturedProvider = null;

const fakeVscode = {
  env: { appName: 'Antigravity IDE', appRoot: EXT_ROOT },
  Uri: {
    file: (p) => ({ fsPath: p, toString: () => p }),
    joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) })
  },
  RelativePattern: class RelativePattern {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    workspaceFolders: [],
    workspaceFile: undefined,
    getConfiguration: () => ({
      get: (key, def) => (key === 'locale' ? 'zh-TW' : def),
      update: async () => {}
    }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    createFileSystemWatcher: () => ({
      onDidChange() {},
      onDidCreate() {},
      onDidDelete() {},
      dispose() {}
    })
  },
  window: {
    registerWebviewViewProvider: (id, provider) => {
      if (id === 'antigravity.aiContextView') capturedProvider = provider;
      return { dispose() {} };
    },
    onDidChangeWindowState: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeActiveTerminal: () => ({ dispose() {} })
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: () => {}
  }
};

// 必須在 require extension.js 之前攔截 vscode 模組
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, ...rest);
};
const extension = require(path.join(EXT_ROOT, 'extension.js'));
Module._load = originalLoad;

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', label + ' :: ' + e.message]);
  }
};

async function main() {
  const memento = createMemento();
  extension.activate({
    subscriptions: [],
    extensionUri: fakeVscode.Uri.file(EXT_ROOT),
    workspaceState: memento
  });

  const provider = capturedProvider;
  assert.ok(provider, '無法從 activate() 取得 AiContextViewProvider');
  const webview = { cspSource: 'test-csp', asWebviewUri: (uri) => 'test-uri:' + uri.fsPath };

  check('A1 未手動選擇 ⇒ 載入宿主原生來源', () => {
    assert.strictEqual(provider._sourceFilter, null, '初始 _sourceFilter 應為 null（跟隨宿主）');
    assert.strictEqual(provider._getRequestedSourceId(['antigravity', 'cline'], 'antigravity'), 'antigravity');
    assert.strictEqual(provider._getRequestedSourceId(['cursor', 'cline'], 'cursor'), 'cursor');
  });

  check('A2 未手動選擇時 HTML 注入空字串', () => {
    const html = provider._getHtmlForWebview(webview);
    assert.ok(html.includes('window.INITIAL_SOURCE_FILTER = "";'), 'INITIAL_SOURCE_FILTER 應為空字串');
    assert.ok(html.includes('window.INITIAL_NATIVE_SOURCE = "antigravity";'), '應注入宿主原生來源');
  });

  await provider._handleMessage({ type: 'saveSourceFilter', payload: { sourceFilter: 'cline' } });

  check('A3 點選 Cline chip ⇒ 寫回 workspaceState 並沿用', () => {
    assert.strictEqual(provider._sourceFilter, 'cline');
    assert.strictEqual(memento.get('aiContext.sourceFilter'), 'cline');
    assert.strictEqual(provider._getRequestedSourceId(['antigravity', 'cline'], 'antigravity'), 'cline');
  });

  check('A4 手動選擇後 HTML 注入該來源（重開視窗仍沿用）', () => {
    const html = provider._getHtmlForWebview(webview);
    assert.ok(html.includes('window.INITIAL_SOURCE_FILTER = "cline";'), 'INITIAL_SOURCE_FILTER 應為 cline');
  });

  await provider._handleMessage({ type: 'saveSourceFilter', payload: { sourceFilter: 'all' } });

  check('A5 取消篩選（all）⇒ 沿用已選對話來源，來源消失則回宿主', () => {
    assert.strictEqual(memento.get('aiContext.sourceFilter'), 'all');
    provider._selectedConvSource = 'cline';
    assert.strictEqual(provider._getRequestedSourceId(['antigravity', 'cline'], 'antigravity'), 'cline');
    provider._selectedConvSource = 'cursor'; // 不在可用清單
    assert.strictEqual(provider._getRequestedSourceId(['antigravity', 'cline'], 'antigravity'), 'antigravity');
    provider._selectedConvSource = null;
  });

  check('A6 指定的來源不可用 ⇒ 退回宿主原生來源', () => {
    provider._sourceFilter = 'copilot';
    assert.strictEqual(provider._getRequestedSourceId(['antigravity', 'cline'], 'antigravity'), 'antigravity');
    assert.strictEqual(provider._getRequestedSourceId(['cursor'], 'cursor'), 'cursor');
    provider._sourceFilter = 'cline';
  });

  await provider._handleMessage({ type: 'saveSourceFilter', payload: { sourceFilter: '' } });

  check('A7 空字串 ⇒ 清回「跟隨宿主」', () => {
    assert.strictEqual(provider._sourceFilter, null);
    assert.strictEqual(memento.get('aiContext.sourceFilter'), null);
    assert.strictEqual(provider._getRequestedSourceId(['antigravity', 'cline'], 'antigravity'), 'antigravity');
  });

  const failed = results.filter(r => r[0] === 'FAIL');
  for (const [status, label] of results) {
    console.log(`${status}  ${label}`);
  }
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  process.exit(1);
});
