const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const STORAGE_KEY = 'antigravity_quick_access_items_v1';

class StorageManager {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
  }

  /**
   * 取得儲存的項目清單（具備型別防禦）
   * @returns {{ pinned: Array<{path: string, type: 'file'|'dir', name: string, addedAt: number}>, scratchpad: Array<{path: string, type: 'file'|'dir', name: string, addedAt: number}> }}
   */
  getRawData() {
    const raw = this.context.workspaceState.get(STORAGE_KEY, { pinned: [], scratchpad: [] });
    return {
      pinned: Array.isArray(raw?.pinned) ? raw.pinned : [],
      scratchpad: Array.isArray(raw?.scratchpad) ? raw.scratchpad : []
    };
  }

  /**
   * 寫入儲存資料
   * @param {{ pinned: Array<any>, scratchpad: Array<any> }} data
   */
  async saveData(data) {
    await this.context.workspaceState.update(STORAGE_KEY, {
      pinned: Array.isArray(data?.pinned) ? data.pinned : [],
      scratchpad: Array.isArray(data?.scratchpad) ? data.scratchpad : []
    });
  }

  /**
   * 正規化路徑 (統一正斜線，大寫磁碟代號)
   * @param {string} fsPath
   * @returns {string}
   */
  normalizePath(fsPath) {
    if (!fsPath) return '';
    let normalized = path.normalize(fsPath).replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(normalized)) {
      normalized = normalized[0].toUpperCase() + normalized.slice(1);
    }
    if (normalized.length > 3 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  /**
   * 加入單一或多個項目至暫存或釘選清單
   * @param {vscode.Uri | vscode.Uri[] | string} target
   * @param {boolean} isPinned
   * @returns {Promise<{ success: boolean, message: string, addedCount: number }>}
   */
  async addItem(target, isPinned = false) {
    const uris = Array.isArray(target) ? target : [target];
    const data = this.getRawData();
    const targetGroup = isPinned ? 'pinned' : 'scratchpad';
    const otherGroup = isPinned ? 'scratchpad' : 'pinned';
    let addedCount = 0;
    let lastName = '';

    for (const uri of uris) {
      const rawPath = typeof uri === 'string' ? uri : uri?.fsPath;
      if (!rawPath) continue;

      const fsPath = this.normalizePath(rawPath);
      if (!fs.existsSync(fsPath)) continue;

      let isDir = false;
      try {
        const stat = fs.statSync(fsPath);
        isDir = stat.isDirectory();
      } catch {
        continue;
      }

      const itemName = path.basename(fsPath) || fsPath;
      lastName = itemName;

      // 檢查是否已存在目標群組（不分大小寫比對）
      const existsInTarget = data[targetGroup].some(item => this.normalizePath(item.path).toLowerCase() === fsPath.toLowerCase());
      if (existsInTarget) continue;

      // 若存在於另一組，先移除
      data[otherGroup] = data[otherGroup].filter(item => this.normalizePath(item.path).toLowerCase() !== fsPath.toLowerCase());

      // 置頂加入
      data[targetGroup].unshift({
        path: fsPath,
        name: itemName,
        type: isDir ? 'dir' : 'file',
        addedAt: Date.now()
      });
      addedCount++;
    }

    if (addedCount > 0) {
      await this.saveData(data);
      const msg = addedCount === 1
        ? `已將「${lastName}」加入至${isPinned ? '常規釘選' : '臨時暫存'}清單`
        : `已將 ${addedCount} 個項目加入至${isPinned ? '常規釘選' : '臨時暫存'}清單`;
      return { success: true, message: msg, addedCount };
    }

    return {
      success: false,
      message: uris.length === 1 ? `項目已存在於${isPinned ? '常規釘選' : '臨時暫存'}清單中或路徑無效` : '所選項目皆已存在或無效',
      addedCount: 0
    };
  }

  /**
   * 移除項目（支援單一項目或多選批次移除）
   * @param {string | string[] | Array<{fsPath?: string, path?: string}>} target
   * @returns {Promise<number>} 成功移除的項目數量
   */
  async removeItem(target) {
    const targets = Array.isArray(target) ? target : [target];
    const normTargets = new Set(
      targets
        .map(t => typeof t === 'string' ? t : (t?.fsPath || t?.path))
        .filter(Boolean)
        .map(t => this.normalizePath(t).toLowerCase())
    );

    if (normTargets.size === 0) return 0;

    const data = this.getRawData();
    const prevPinnedLen = data.pinned.length;
    const prevScratchLen = data.scratchpad.length;

    data.pinned = data.pinned.filter(item => !normTargets.has(this.normalizePath(item.path).toLowerCase()));
    data.scratchpad = data.scratchpad.filter(item => !normTargets.has(this.normalizePath(item.path).toLowerCase()));

    const removedCount = (prevPinnedLen - data.pinned.length) + (prevScratchLen - data.scratchpad.length);
    if (removedCount > 0) {
      await this.saveData(data);
      return removedCount;
    }
    return 0;
  }

  /**
   * 切換釘選/臨時狀態（支援單一項目或多選批次切換）
   * @param {string | string[] | Array<{fsPath?: string, path?: string}>} target
   * @returns {Promise<{ success: boolean, toggledCount: number, isPinned?: boolean, message?: string }>}
   */
  async togglePin(target) {
    const targets = Array.isArray(target) ? target : [target];
    const normTargets = new Set(
      targets
        .map(t => typeof t === 'string' ? t : (t?.fsPath || t?.path))
        .filter(Boolean)
        .map(t => this.normalizePath(t).toLowerCase())
    );

    if (normTargets.size === 0) return { success: false, toggledCount: 0 };

    const data = this.getRawData();
    let toggledCount = 0;
    let lastIsPinned = false;

    // 處理目前在 pinned 中的項目（移至 scratchpad）
    const remainingPinned = [];
    const movingToScratchpad = [];
    for (const item of data.pinned) {
      if (normTargets.has(this.normalizePath(item.path).toLowerCase())) {
        movingToScratchpad.push(item);
        toggledCount++;
        lastIsPinned = false;
      } else {
        remainingPinned.push(item);
      }
    }

    // 處理目前在 scratchpad 中的項目（移至 pinned）
    const remainingScratchpad = [];
    const movingToPinned = [];
    for (const item of data.scratchpad) {
      if (normTargets.has(this.normalizePath(item.path).toLowerCase())) {
        movingToPinned.push(item);
        toggledCount++;
        lastIsPinned = true;
      } else {
        remainingScratchpad.push(item);
      }
    }

    if (toggledCount > 0) {
      data.pinned = [...movingToPinned, ...remainingPinned];
      data.scratchpad = [...movingToScratchpad, ...remainingScratchpad];
      await this.saveData(data);
      return { success: true, toggledCount, isPinned: lastIsPinned };
    }

    return { success: false, toggledCount: 0, message: '找不到目標項目' };
  }

  /**
   * 清空臨時暫存清單（支援僅清空當前可見之項目，保護隱藏專案之暫存資料）
   * @param {string[]} [onlyVisiblePaths]
   * @returns {Promise<number>}
   */
  async clearScratchpad(onlyVisiblePaths = null) {
    const data = this.getRawData();
    if (Array.isArray(onlyVisiblePaths)) {
      const normTargets = new Set(onlyVisiblePaths.map(p => this.normalizePath(p).toLowerCase()));
      const prevLen = data.scratchpad.length;
      data.scratchpad = data.scratchpad.filter(item => !normTargets.has(this.normalizePath(item.path).toLowerCase()));
      const count = prevLen - data.scratchpad.length;
      if (count > 0) {
        await this.saveData(data);
      }
      return count;
    } else {
      const count = data.scratchpad.length;
      data.scratchpad = [];
      await this.saveData(data);
      return count;
    }
  }

  /**
   * 取得當前多專案工作區 (.code-workspace) 中被停用/隱藏的專案根目錄清單
   * @returns {string[]}
   */
  getDisabledWorkspaceRoots() {
    const wsFileUri = vscode.workspace.workspaceFile;
    if (!wsFileUri || !wsFileUri.fsPath || !fs.existsSync(wsFileUri.fsPath)) {
      return [];
    }

    try {
      const wsPath = wsFileUri.fsPath;
      const wsDir = path.dirname(wsPath);
      const raw = fs.readFileSync(wsPath, 'utf-8');
      const clean = raw.replace(/^\uFEFF/, '').trim();
      const json = JSON.parse(clean);

      if (!json || !Array.isArray(json.disabledFolders)) {
        return [];
      }

      return json.disabledFolders
        .map(item => {
          const folderPath = item.path || '';
          if (!folderPath) return '';
          const fullPath = path.isAbsolute(folderPath) ? folderPath : path.resolve(wsDir, folderPath);
          return this.normalizePath(fullPath).toLowerCase();
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 取得有效項目（自動過濾不存在之磁碟檔案，並動態隱藏屬於停用或已移出工作區專案之項目）
   * @returns {{ pinned: Array<any>, scratchpad: Array<any> }}
   */
  getValidItems() {
    const data = this.getRawData();
    const disabledRoots = this.getDisabledWorkspaceRoots();
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const activeWorkspaceRoots = workspaceFolders.map(f => this.normalizePath(f.uri.fsPath).toLowerCase());

    const filterValid = (items, isScratchpad = false) => {
      return items.filter(item => {
        const normPath = this.normalizePath(item.path);

        // 1. 本機實體檔案存在性校驗
        if (!fs.existsSync(normPath)) {
          return false;
        }

        const normPathLower = normPath.toLowerCase();

        // 2. 多專案工作區隱藏連動過濾：若該檔案所屬專案當前為 disabledFolders，暫時於視圖中隱藏
        if (disabledRoots.length > 0) {
          const isUnderDisabledRoot = disabledRoots.some(dRoot => {
            return normPathLower === dRoot || normPathLower.startsWith(dRoot + '/');
          });
          if (isUnderDisabledRoot) {
            return false;
          }
        }

        // 3. 活躍工作區範圍連動過濾（針對臨時暫存 scratchpad）：
        // 若當前有開啟一或多個工作區資料夾，則臨時暫存項目必須座落於活躍工作區資料夾內
        if (isScratchpad && activeWorkspaceRoots.length > 0) {
          const isUnderActiveRoot = activeWorkspaceRoots.some(aRoot => {
            return normPathLower === aRoot || normPathLower.startsWith(aRoot + '/');
          });
          if (!isUnderActiveRoot) {
            return false;
          }
        }

        return true;
      });
    };

    return {
      pinned: filterValid(data.pinned, false),
      scratchpad: filterValid(data.scratchpad, true)
    };
  }
}

module.exports = StorageManager;
