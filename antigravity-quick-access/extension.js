const vscode = require('vscode');
const path = require('node:path');
const I18n = require('./i18n');
const StorageManager = require('./storageManager');
const { QuickAccessTreeDataProvider, QuickAccessDragAndDropController } = require('./treeDataProvider');

/**
 * 擴充套件啟動進入點
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const i18n = new I18n(context.extensionUri);
  const storageManager = new StorageManager(context, i18n);
  const treeDataProvider = new QuickAccessTreeDataProvider(storageManager, i18n);
  const dndController = new QuickAccessDragAndDropController(storageManager, treeDataProvider);

  // 1. 註冊 TreeView（開啟 canSelectMany 支援 Ctrl/Shift 多選，並啟用滑鼠拖放控制器）
  const treeView = vscode.window.createTreeView('antigravity.quickAccessView', {
    treeDataProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dndController
  });
  treeDataProvider.refresh();

  // 輔助訊息顯示（使用 StatusBar 輕量反饋，避免彈窗干擾）
  const showFeedback = (msg) => {
    vscode.window.setStatusBarMessage(`$(bookmark) ${msg}`, 3000);
  };

  /**
   * 解析命令觸發時傳入的目標 URI 清單（支援右鍵單選、多選與當前編輯器）
   * @param {vscode.Uri | QuickAccessItem} uri
   * @param {vscode.Uri[]} [uris]
   * @returns {vscode.Uri[]}
   */
  const getTargetUris = (uri, uris) => {
    if (Array.isArray(uris) && uris.length > 0) return uris;
    if (uri instanceof vscode.Uri) return [uri];
    if (uri?.fsPath) return [vscode.Uri.file(uri.fsPath)];
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc && activeDoc.uri.scheme === 'file') return [activeDoc.uri];
    return [];
  };

  /**
   * 取得 TreeView 中選取的所有項目（支援單選與多選）
   * @param {QuickAccessItem} element
   * @param {QuickAccessItem[]} [elements]
   * @returns {QuickAccessItem[]}
   */
  const getSelectedElements = (element, elements) => {
    if (Array.isArray(elements) && elements.length > 0) return elements;
    if (element) return [element];
    return [];
  };

  // 2. 註冊命令：加入至臨時暫存 (Scratchpad，支援單選與多選)
  const addHandler = async (uri, uris) => {
    const targets = getTargetUris(uri, uris);
    if (targets.length === 0) {
      vscode.window.showInformationMessage(i18n.t('msg_select_file_scratchpad'));
      return;
    }

    const res = await storageManager.addItem(targets, false);
    if (res.success) {
      treeDataProvider.refresh();
      showFeedback(res.message);
    } else {
      vscode.window.showWarningMessage(res.message);
    }
  };

  // 3. 註冊命令：加入至常規釘選 (Pinned，支援單選與多選)
  const addPinnedHandler = async (uri, uris) => {
    const targets = getTargetUris(uri, uris);
    if (targets.length === 0) {
      vscode.window.showInformationMessage(i18n.t('msg_select_file_pinned'));
      return;
    }

    const res = await storageManager.addItem(targets, true);
    if (res.success) {
      treeDataProvider.refresh();
      showFeedback(res.message);
    } else {
      vscode.window.showWarningMessage(res.message);
    }
  };

  // 4. 註冊命令：加入目前活躍檔案 (Add Active File)
  const addActiveHandler = async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document.uri) {
      vscode.window.showInformationMessage(i18n.t('msg_no_active_tab'));
      return;
    }

    if (activeEditor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage(i18n.t('msg_not_local_file'));
      return;
    }

    const res = await storageManager.addItem(activeEditor.document.uri, false);
    if (res.success) {
      treeDataProvider.refresh();
      showFeedback(res.message);
    } else {
      vscode.window.showInformationMessage(res.message);
    }
  };

  // 5. 註冊命令：從清單移除 (Remove，支援多選批次移除)
  const removeHandler = async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    if (selected.length === 0) return;

    const targetPaths = selected
      .map(el => el?.fsPath || (el instanceof vscode.Uri ? el.fsPath : null))
      .filter(Boolean);

    if (targetPaths.length === 0) return;

    const count = await storageManager.removeItem(targetPaths);
    if (count > 0) {
      treeDataProvider.refresh();
      showFeedback(count === 1 ? i18n.t('msg_removed_single') : i18n.t('msg_removed_multi', { count }));
    }
  };

  // 6. 註冊命令：切換 釘選 / 臨時 (支援多選批次切換，並相容展開之子項目切換)
  const togglePinHandler = async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    if (selected.length === 0) return;

    const res = await storageManager.togglePin(selected);
    if (res.success) {
      treeDataProvider.refresh();
      const msg = res.toggledCount === 1
        ? (res.isPinned ? i18n.t('msg_toggled_pinned') : i18n.t('msg_toggled_scratchpad'))
        : i18n.t('msg_toggled_multi', { count: res.toggledCount });
      showFeedback(msg);
    } else if (res.message) {
      vscode.window.showInformationMessage(res.message);
    }
  };

  // 7. 註冊命令：清空臨時暫存清單 (Clear Scratchpad，僅清空目前可見之項目，保護隱藏專案暫存)
  const clearScratchpadHandler = async () => {
    const { scratchpad } = storageManager.getValidItems();
    if (scratchpad.length === 0) {
      showFeedback(i18n.t('msg_scratchpad_empty'));
      return;
    }

    const confirmBtn = i18n.t('btn_clear_scratchpad');
    const confirm = await vscode.window.showWarningMessage(
      i18n.t('confirm_clear_scratchpad', { count: scratchpad.length }),
      { modal: true },
      confirmBtn
    );

    if (confirm === confirmBtn) {
      const visiblePaths = scratchpad.map(i => i.path);
      const count = await storageManager.clearScratchpad(visiblePaths);
      treeDataProvider.refresh();
      showFeedback(i18n.t('msg_cleared_count', { count }));
    }
  };

  // 8. 註冊命令：重新整理 (Refresh)
  const refreshHandler = () => {
    treeDataProvider.refresh();
    showFeedback(i18n.t('msg_refreshed'));
  };

  // 9. 註冊命令：在檔案總管中標示 (Reveal in Explorer)
  const revealInExplorerHandler = async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    const target = selected[0];
    const targetPath = target?.fsPath || (target instanceof vscode.Uri ? target.fsPath : null);
    if (targetPath) {
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(targetPath));
    }
  };

  // 10. 註冊命令：在系統檔案總管開啟 (Reveal in File Explorer)
  const revealInOSHandler = async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    for (const item of selected) {
      const targetPath = item?.fsPath || (item instanceof vscode.Uri ? item.fsPath : null);
      if (targetPath) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
      }
    }
  };

  // 11. 工作區專案增減/隱藏即時連動監聽
  const workspaceFoldersWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    treeDataProvider.refresh();
  });

  // 12. 檔案系統變更監聽 (當檔案被刪除或更名時即時連動過濾)
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fsWatcher.onDidDelete(() => treeDataProvider.refresh());
  fsWatcher.onDidCreate(() => treeDataProvider.refresh());

  // 13. 多專案工作區檔案 (.code-workspace) 即時變更監聽 (連動 antigravity-toolbox 專案開關)
  let wsFileWatcher = null;
  if (vscode.workspace.workspaceFile?.fsPath) {
    try {
      const wsDir = path.dirname(vscode.workspace.workspaceFile.fsPath);
      const wsName = path.basename(vscode.workspace.workspaceFile.fsPath);
      wsFileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(wsDir, wsName));
      wsFileWatcher.onDidChange(() => treeDataProvider.refresh());
      wsFileWatcher.onDidCreate(() => treeDataProvider.refresh());
      wsFileWatcher.onDidDelete(() => treeDataProvider.refresh());
    } catch {}
  }

  // 14. 設定變更監聽 (files.exclude 或 workbench.list 設定變動，以及 antigravity.locale 語言全域變更)
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('antigravity.locale') ||
      e.affectsConfiguration('files.exclude') ||
      e.affectsConfiguration('workbench.list') ||
      e.affectsConfiguration('workbench.tree')
    ) {
      treeDataProvider.refresh();
    }
  });

  context.subscriptions.push(
    treeView,
    treeDataProvider,
    vscode.commands.registerCommand('antigravity.quickAccess.add', addHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.add.en', addHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.addPinned', addPinnedHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.addPinned.en', addPinnedHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.addActive', addActiveHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.addActive.en', addActiveHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.remove', removeHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.remove.en', removeHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.togglePin', togglePinHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.togglePin.en', togglePinHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.clearScratchpad', clearScratchpadHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.clearScratchpad.en', clearScratchpadHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.refresh', refreshHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.refresh.en', refreshHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.revealInExplorer', revealInExplorerHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.revealInExplorer.en', revealInExplorerHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.revealInOS', revealInOSHandler),
    vscode.commands.registerCommand('antigravity.quickAccess.revealInOS.en', revealInOSHandler),
    workspaceFoldersWatcher,
    fsWatcher,
    configWatcher
  );

  if (wsFileWatcher) {
    context.subscriptions.push(wsFileWatcher);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
