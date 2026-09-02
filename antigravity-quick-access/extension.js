const vscode = require('vscode');
const path = require('node:path');
const StorageManager = require('./storageManager');
const { QuickAccessTreeDataProvider, QuickAccessDragAndDropController } = require('./treeDataProvider');

/**
 * 擴充套件啟動進入點
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const storageManager = new StorageManager(context);
  const treeDataProvider = new QuickAccessTreeDataProvider(storageManager);
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
  const addCmd = vscode.commands.registerCommand('antigravity.quickAccess.add', async (uri, uris) => {
    const targets = getTargetUris(uri, uris);
    if (targets.length === 0) {
      vscode.window.showInformationMessage('請選擇要加入暫存清單的本機檔案或資料夾');
      return;
    }

    const res = await storageManager.addItem(targets, false);
    if (res.success) {
      treeDataProvider.refresh();
      showFeedback(res.message);
    } else {
      vscode.window.showWarningMessage(res.message);
    }
  });

  // 3. 註冊命令：加入至常規釘選 (Pinned，支援單選與多選)
  const addPinnedCmd = vscode.commands.registerCommand('antigravity.quickAccess.addPinned', async (uri, uris) => {
    const targets = getTargetUris(uri, uris);
    if (targets.length === 0) {
      vscode.window.showInformationMessage('請選擇要加入常規釘選的本機檔案或資料夾');
      return;
    }

    const res = await storageManager.addItem(targets, true);
    if (res.success) {
      treeDataProvider.refresh();
      showFeedback(res.message);
    } else {
      vscode.window.showWarningMessage(res.message);
    }
  });

  // 4. 註冊命令：加入目前活躍檔案 (Add Active File)
  const addActiveCmd = vscode.commands.registerCommand('antigravity.quickAccess.addActive', async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document.uri) {
      vscode.window.showInformationMessage('目前未開啟任何可加入的編輯器分頁');
      return;
    }

    if (activeEditor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('目前分頁不是本機磁碟檔案，無法加入暫存清單');
      return;
    }

    const res = await storageManager.addItem(activeEditor.document.uri, false);
    if (res.success) {
      treeDataProvider.refresh();
      showFeedback(res.message);
    } else {
      vscode.window.showInformationMessage(res.message);
    }
  });

  // 5. 註冊命令：從清單移除 (Remove，支援多選批次移除)
  const removeCmd = vscode.commands.registerCommand('antigravity.quickAccess.remove', async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    if (selected.length === 0) return;

    const targetPaths = selected
      .map(el => el?.fsPath || (el instanceof vscode.Uri ? el.fsPath : null))
      .filter(Boolean);

    if (targetPaths.length === 0) return;

    const count = await storageManager.removeItem(targetPaths);
    if (count > 0) {
      treeDataProvider.refresh();
      showFeedback(count === 1 ? '已從清單移除' : `已批次移除 ${count} 個項目`);
    }
  });

  // 6. 註冊命令：切換 釘選 / 臨時 (支援多選批次切換，並相容展開之子項目切換)
  const togglePinCmd = vscode.commands.registerCommand('antigravity.quickAccess.togglePin', async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    if (selected.length === 0) return;

    const res = await storageManager.togglePin(selected);
    if (res.success) {
      treeDataProvider.refresh();
      const msg = res.toggledCount === 1
        ? (res.isPinned ? '已加入至常規釘選' : '已移至臨時暫存')
        : `已批次切換 ${res.toggledCount} 個項目狀態`;
      showFeedback(msg);
    } else if (res.message) {
      vscode.window.showInformationMessage(res.message);
    }
  });

  // 7. 註冊命令：清空臨時暫存清單 (Clear Scratchpad，僅清空目前可見之項目，保護隱藏專案暫存)
  const clearScratchpadCmd = vscode.commands.registerCommand('antigravity.quickAccess.clearScratchpad', async () => {
    const { scratchpad } = storageManager.getValidItems();
    if (scratchpad.length === 0) {
      showFeedback('目前臨時暫存清單已是空的');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `確定要清空當前臨時暫存清單中的 ${scratchpad.length} 個項目嗎？（常規釘選與隱藏專案之暫存不會受到影響）`,
      { modal: true },
      '清空清單'
    );

    if (confirm === '清空清單') {
      const visiblePaths = scratchpad.map(i => i.path);
      const count = await storageManager.clearScratchpad(visiblePaths);
      treeDataProvider.refresh();
      showFeedback(`已清空 ${count} 個臨時暫存項目`);
    }
  });

  // 8. 註冊命令：重新整理 (Refresh)
  const refreshCmd = vscode.commands.registerCommand('antigravity.quickAccess.refresh', () => {
    treeDataProvider.refresh();
    showFeedback('清單已重新整理');
  });

  // 9. 註冊命令：在檔案總管中標示 (Reveal in Explorer)
  const revealInExplorerCmd = vscode.commands.registerCommand('antigravity.quickAccess.revealInExplorer', async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    const target = selected[0];
    const targetPath = target?.fsPath || (target instanceof vscode.Uri ? target.fsPath : null);
    if (targetPath) {
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(targetPath));
    }
  });

  // 10. 註冊命令：在系統檔案總管開啟 (Reveal in File Explorer)
  const revealInOSCmd = vscode.commands.registerCommand('antigravity.quickAccess.revealInOS', async (element, elements) => {
    const selected = getSelectedElements(element, elements);
    for (const item of selected) {
      const targetPath = item?.fsPath || (item instanceof vscode.Uri ? item.fsPath : null);
      if (targetPath) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
      }
    }
  });

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

  // 14. 設定變更監聽 (files.exclude 或 workbench.list 設定變動)
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('files.exclude') || e.affectsConfiguration('workbench.list') || e.affectsConfiguration('workbench.tree')) {
      treeDataProvider.refresh();
    }
  });

  context.subscriptions.push(
    treeView,
    treeDataProvider,
    addCmd,
    addPinnedCmd,
    addActiveCmd,
    removeCmd,
    togglePinCmd,
    clearScratchpadCmd,
    refreshCmd,
    revealInExplorerCmd,
    revealInOSCmd,
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
