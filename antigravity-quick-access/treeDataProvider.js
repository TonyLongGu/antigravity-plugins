const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 節點類型宣告
 * @typedef {'category' | 'root-file' | 'root-folder' | 'sub-folder' | 'sub-file' | 'empty-placeholder'} TreeItemType
 */

class QuickAccessItem extends vscode.TreeItem {
  /**
   * @param {string} label
   * @param {vscode.TreeItemCollapsibleState} collapsibleState
   * @param {TreeItemType} itemType
   * @param {object} [options]
   */
  constructor(label, collapsibleState, itemType, options = {}) {
    super(label, collapsibleState);
    this.itemType = itemType;
    this.contextValue = itemType;
    this.fsPath = options.fsPath;
    this.isPinned = options.isPinned || false;
    this.groupId = options.groupId;

    if (options.fsPath) {
      this.resourceUri = vscode.Uri.file(options.fsPath);
      this.tooltip = options.fsPath;
      if (options.description) {
        this.description = options.description;
      }
    }

    if (options.iconPath) {
      this.iconPath = options.iconPath;
    }

    if (options.command) {
      this.command = options.command;
    }
  }
}

class QuickAccessTreeDataProvider {
  /**
   * @param {import('./storageManager')} storageManager
   */
  constructor(storageManager) {
    this.storageManager = storageManager;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._debounceTimer = null;
  }

  /**
   * 觸發樹狀視圖重新整理（具備 200ms 防抖保護）
   */
  refresh() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire();
      this._debounceTimer = null;
    }, 200);
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem}
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * 取得子節點清單
   * @param {QuickAccessItem} [element]
   * @returns {Promise<QuickAccessItem[]>}
   */
  async getChildren(element) {
    // 1. 根目錄：顯示分組或全部項目
    if (!element) {
      return this._getRootElements();
    }

    // 2. 分組節點：展開該分組下的釘選/臨時項目
    if (element.itemType === 'category') {
      return this._getCategoryItems(element.groupId);
    }

    // 3. 資料夾節點（根資料夾或子資料夾）：讀取子目錄與檔案
    if (element.itemType === 'root-folder' || element.itemType === 'sub-folder') {
      return this._getDirectoryChildren(element.fsPath, element.groupId, element.isPinned);
    }

    return [];
  }

  /**
   * 取得頂層節點（常規釘選 & 臨時暫存）
   * @private
   */
  _getRootElements() {
    const { pinned, scratchpad } = this.storageManager.getValidItems();

    if (pinned.length === 0 && scratchpad.length === 0) {
      return [];
    }

    const categories = [];

    if (pinned.length > 0) {
      const pinnedCategory = new QuickAccessItem(
        `常規釘選 (${pinned.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        {
          groupId: 'pinned',
          iconPath: new vscode.ThemeIcon('pinned')
        }
      );
      categories.push(pinnedCategory);
    }

    if (scratchpad.length > 0) {
      const scratchCategory = new QuickAccessItem(
        `臨時暫存 (${scratchpad.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        {
          groupId: 'scratchpad',
          iconPath: new vscode.ThemeIcon('bookmark')
        }
      );
      categories.push(scratchCategory);
    }

    return categories;
  }

  /**
   * 取得指定分組下的頂層項目（依檔案總管多專案工作區順序與資料夾優先排序）
   * @private
   * @param {'pinned' | 'scratchpad'} groupId
   */
  _getCategoryItems(groupId) {
    const validItems = this.storageManager.getValidItems();
    const items = validItems[groupId] || [];
    const isPinned = groupId === 'pinned';

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const workspaceRoots = workspaceFolders.map(f => this.storageManager.normalizePath(f.uri.fsPath).toLowerCase());

    const getProjectIndex = (itemPath) => {
      const norm = this.storageManager.normalizePath(itemPath).toLowerCase();
      for (let i = 0; i < workspaceRoots.length; i++) {
        const root = workspaceRoots[i];
        if (norm === root || norm.startsWith(root + '/')) {
          return i;
        }
      }
      return 9999;
    };

    const sortedItems = [...items].sort((a, b) => {
      const idxA = getProjectIndex(a.path);
      const idxB = getProjectIndex(b.path);

      // 1. 優先依檔案總管工作區專案排列順序排序
      if (idxA !== idxB) {
        return idxA - idxB;
      }

      // 2. 同專案內：資料夾排在檔案前面
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;

      // 3. 同類型：依項目名稱自然排序
      const nameA = a.name || path.basename(a.path);
      const nameB = b.name || path.basename(b.path);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    return sortedItems.map(item => {
      const fsPath = item.path;
      const label = item.name || path.basename(fsPath);
      const isDir = item.type === 'dir';
      const relDesc = this._getRelativePathDescription(fsPath);

      if (isDir) {
        return new QuickAccessItem(
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          'root-folder',
          {
            fsPath,
            isPinned,
            groupId,
            description: relDesc
          }
        );
      } else {
        return new QuickAccessItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          'root-file',
          {
            fsPath,
            isPinned,
            groupId,
            description: relDesc,
            command: {
              command: 'vscode.open',
              title: '開啟檔案',
              arguments: [vscode.Uri.file(fsPath)]
            }
          }
        );
      }
    });
  }

  /**
   * 讀取並展開實體資料夾內的子項目
   * @private
   * @param {string} dirPath
   * @param {string} [parentGroupId]
   * @param {boolean} [parentIsPinned]
   */
  async _getDirectoryChildren(dirPath, parentGroupId = null, parentIsPinned = false) {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return [];
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const excludeConfig = vscode.workspace.getConfiguration('files').get('exclude') || {};

      // 過濾與排序
      const filteredEntries = entries.filter(entry => {
        const name = entry.name;
        if (name === '.git' || name === '.DS_Store' || name === 'Thumbs.db') return false;
        if (excludeConfig[name] === true || excludeConfig[`**/${name}`] === true) return false;
        return true;
      });

      // 資料夾在前，檔案在後
      filteredEntries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      return filteredEntries.map(entry => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          return new QuickAccessItem(
            entry.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            'sub-folder',
            {
              fsPath: fullPath,
              groupId: parentGroupId,
              isPinned: parentIsPinned
            }
          );
        } else {
          return new QuickAccessItem(
            entry.name,
            vscode.TreeItemCollapsibleState.None,
            'sub-file',
            {
              fsPath: fullPath,
              groupId: parentGroupId,
              isPinned: parentIsPinned,
              command: {
                command: 'vscode.open',
                title: '開啟檔案',
                arguments: [vscode.Uri.file(fullPath)]
              }
            }
          );
        }
      });
    } catch (err) {
      console.error(`無法讀取目錄內容 ${dirPath}:`, err);
      return [];
    }
  }

  /**
   * 計算相對工作區路徑，以提供清晰的次要說明文字
   * @private
   * @param {string} fsPath
   * @returns {string}
   */
  _getRelativePathDescription(fsPath) {
    const normPath = this.storageManager.normalizePath(fsPath);
    const normPathLower = normPath.toLowerCase();
    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    for (const folder of workspaceFolders) {
      const normRoot = this.storageManager.normalizePath(folder.uri.fsPath);
      const normRootLower = normRoot.toLowerCase();

      if (normPathLower === normRootLower) {
        return folder.name;
      }
      if (normPathLower.startsWith(normRootLower + '/')) {
        const rel = normPath.slice(normRoot.length + 1);
        const parentDir = path.dirname(rel).replace(/\\/g, '/');
        if (parentDir && parentDir !== '.') {
          return `${folder.name} • ${parentDir}`;
        }
        return folder.name;
      }
    }
    return path.dirname(normPath);
  }

  /**
   * 釋放資源
   */
  dispose() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._onDidChangeTreeData.dispose();
  }
}

const MIME_URI_LIST = 'text/uri-list';
const MIME_INTERNAL_TREE = 'application/vnd.code.tree.antigravity.quickAccessView';

/**
 * 樹狀視圖拖放控制器 (Drag & Drop Controller)
 * 支援向外拖曳至 Antigravity Chat 對話框、編輯器、終端機，以及從外部/檔案總管拖入加入清單
 * @implements {vscode.TreeDragAndDropController<QuickAccessItem>}
 */
class QuickAccessDragAndDropController {
  /**
   * @param {import('./storageManager')} storageManager
   * @param {QuickAccessTreeDataProvider} treeDataProvider
   */
  constructor(storageManager, treeDataProvider) {
    this.storageManager = storageManager;
    this.treeDataProvider = treeDataProvider;
    this.dragMimeTypes = [MIME_URI_LIST, MIME_INTERNAL_TREE];
    this.dropMimeTypes = [MIME_URI_LIST, MIME_INTERNAL_TREE];
  }

  /**
   * 處理向外拖曳 (Drag)
   * 將節點的本機路徑轉為標準 URI 清單，使 Chat 對話框、編輯器、終端機與外部程式能自動引用
   * @param {readonly QuickAccessItem[]} source
   * @param {vscode.DataTransfer} treeDataTransfer
   * @param {vscode.CancellationToken} token
   */
  async handleDrag(source, treeDataTransfer, token) {
    if (!Array.isArray(source) || source.length === 0) return;

    const uris = [];
    const validItems = [];

    for (const item of source) {
      if (item?.fsPath) {
        uris.push(vscode.Uri.file(item.fsPath));
        validItems.push(item);
      }
    }

    if (uris.length > 0) {
      // 1. 設定標準 text/uri-list（以 CRLF 分隔之 URI 字串）
      // Antigravity Chat 對話框與編輯器透過此 MIME 格式辨識拖入的檔案並生成引用
      const uriListText = uris.map(u => u.toString()).join('\r\n');
      treeDataTransfer.set(MIME_URI_LIST, new vscode.DataTransferItem(uriListText));

      // 2. 設定內部 Tree 拖曳資料
      treeDataTransfer.set(MIME_INTERNAL_TREE, new vscode.DataTransferItem(validItems));
    }
  }

  /**
   * 處理放入 (Drop)
   * 支援從檔案總管拖曳檔案加入清單，或在清單內部分組間移動
   * @param {QuickAccessItem | undefined} target
   * @param {vscode.DataTransfer} dataTransfer
   * @param {vscode.CancellationToken} token
   */
  async handleDrop(target, dataTransfer, token) {
    // 判斷放置目標分組（預設為臨時暫存，若拖至常規釘選則為釘選）
    let isPinned = false;
    if (target) {
      if (target.itemType === 'category') {
        isPinned = target.groupId === 'pinned';
      } else if (target.groupId) {
        isPinned = target.groupId === 'pinned';
      }
    }

    // 1. 內部拖曳（在清單內部拖放，例如從 scratchpad 拖到 pinned）
    const internalTransfer = dataTransfer.get(MIME_INTERNAL_TREE);
    if (internalTransfer) {
      const items = internalTransfer.value;
      if (Array.isArray(items) && items.length > 0) {
        const uris = items.map(i => i.fsPath ? vscode.Uri.file(i.fsPath) : null).filter(Boolean);
        if (uris.length > 0) {
          const res = await this.storageManager.addItem(uris, isPinned);
          this.treeDataProvider.refresh();
          if (res.success) {
            vscode.window.setStatusBarMessage(`$(bookmark) ${res.message}`, 3000);
          }
          return;
        }
      }
    }

    // 2. 外部拖入或從 VS Code 內建檔案總管拖入 (text/uri-list)
    const uriListTransfer = dataTransfer.get(MIME_URI_LIST);
    if (uriListTransfer) {
      let uriListText = '';
      if (typeof uriListTransfer.asString === 'function') {
        uriListText = await uriListTransfer.asString();
      } else if (typeof uriListTransfer.value === 'string') {
        uriListText = uriListTransfer.value;
      }

      if (uriListText) {
        const lines = uriListText
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('#'));

        const uris = [];
        for (const line of lines) {
          try {
            const parsedUri = vscode.Uri.parse(line);
            if (parsedUri.scheme === 'file') {
              uris.push(parsedUri);
            }
          } catch {
            // 若為直接檔案路徑
            if (fs.existsSync(line)) {
              uris.push(vscode.Uri.file(line));
            }
          }
        }

        if (uris.length > 0) {
          const res = await this.storageManager.addItem(uris, isPinned);
          this.treeDataProvider.refresh();
          if (res.success) {
            vscode.window.setStatusBarMessage(`$(bookmark) ${res.message}`, 3000);
          } else {
            vscode.window.showInformationMessage(res.message);
          }
        }
      }
    }
  }
}

module.exports = {
  QuickAccessItem,
  QuickAccessTreeDataProvider,
  QuickAccessDragAndDropController
};
