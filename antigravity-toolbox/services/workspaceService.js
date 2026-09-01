const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalPath, safeJsonParse } = require('./systemService');

let cachedWorkspaceContext = null;
let saveDebounceTimer = null;

/**
 * 宣告快取失效（當外部檔案變更時）
 */
function invalidateWorkspaceCache() {
  cachedWorkspaceContext = null;
}

/**
 * 載入並解析目前開啟的 .code-workspace 工作區檔案 (支援記憶體快取，防止連續操作磁碟 I/O 競態)
 * @param {object} [provider]
 * @param {boolean} [forceReload=false]
 * @returns {{ wsPath: string, wsDir: string, wsName: string, json: object } | null}
 */
function loadWorkspaceContext(provider = null, forceReload = false) {
  const wsFileUri = vscode.workspace.workspaceFile;
  if (!wsFileUri || !wsFileUri.fsPath || !fs.existsSync(wsFileUri.fsPath)) {
    cachedWorkspaceContext = null;
    return null;
  }

  const wsPath = getCanonicalPath(wsFileUri.fsPath);
  const wsDir = path.dirname(wsPath);
  const wsName = path.basename(wsPath);

  // 若記憶體中有快取且未要求強制重讀，直接回傳最新記憶體快照
  if (!forceReload && cachedWorkspaceContext && cachedWorkspaceContext.wsPath === wsPath) {
    return cachedWorkspaceContext;
  }

  try {
    const raw = fs.readFileSync(wsPath, 'utf-8');
    const json = safeJsonParse(raw, null);
    if (!json || typeof json !== 'object') {
      if (provider?.pushToast) provider.pushToast('無法解析 .code-workspace 檔案內容。', 'error');
      return null;
    }
    if (!Array.isArray(json.folders)) json.folders = [];
    if (!Array.isArray(json.disabledFolders)) json.disabledFolders = [];

    cachedWorkspaceContext = { wsPath, wsDir, wsName, json };
    return cachedWorkspaceContext;
  } catch (err) {
    if (provider?.pushToast) provider.pushToast(`讀取工作區失敗：${err.message}`, 'error');
    return null;
  }
}

/**
 * 防抖安全儲存 .code-workspace 檔案內容 (高頻操作合併寫入，消除 VS Code 重載風暴)
 * @param {string} wsPath
 * @param {object} json
 * @param {boolean} [immediate=false]
 */
function saveWorkspaceJson(wsPath, json, immediate = false) {
  if (cachedWorkspaceContext && cachedWorkspaceContext.wsPath === wsPath) {
    cachedWorkspaceContext.json = json;
  }

  const doWrite = () => {
    try {
      fs.writeFileSync(wsPath, JSON.stringify(json, null, 2), 'utf-8');
    } catch (err) {
      console.error('寫入 .code-workspace 失敗:', err);
    }
  };

  if (immediate) {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    doWrite();
  } else {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
    }
    saveDebounceTimer = setTimeout(() => {
      saveDebounceTimer = null;
      doWrite();
    }, 80);
  }
}

/**
 * 同步與維護工作區專案的原始順序列表 (自動過濾已移除的幽靈路徑)
 * @param {object} json .code-workspace JSON 物件
 * @param {string} wsDir 工作區目錄路徑
 * @returns {string[]} 標準化專案路徑順序陣列
 */
function syncFolderOrder(json, wsDir) {
  const existingItems = [...json.folders, ...json.disabledFolders];
  const activeCanonSet = new Set(
    existingItems.map((item) => getCanonicalPath(item.path || '', wsDir).toLowerCase())
  );

  const rawOrder = Array.isArray(json.folderOrder) ? json.folderOrder : [];
  const orderList = [];
  const recordedCanon = new Set();

  // 1. 保留依然存在於工作區中的既有排序項目（過濾幽靈路徑）
  rawOrder.forEach((p) => {
    const canon = getCanonicalPath(p || '', wsDir).toLowerCase();
    if (activeCanonSet.has(canon) && !recordedCanon.has(canon)) {
      orderList.push(p);
      recordedCanon.add(canon);
    }
  });

  // 2. 將新加入的專案追加至末尾
  existingItems.forEach((item) => {
    const p = item.path || '';
    const canon = getCanonicalPath(p, wsDir).toLowerCase();
    if (!recordedCanon.has(canon)) {
      orderList.push(p);
      recordedCanon.add(canon);
    }
  });

  json.folderOrder = orderList;
  return orderList;
}

/**
 * 建立高效的 O(1) 排序比較函式 (避免在 sort 循環中重複觸發磁碟 I/O)
 * @param {string[]} orderList
 * @param {string} wsDir
 * @returns {(a: {path?: string}, b: {path?: string}) => number}
 */
function createFolderComparator(orderList, wsDir) {
  const orderMap = new Map();
  orderList.forEach((op, idx) => {
    orderMap.set(getCanonicalPath(op || '', wsDir).toLowerCase(), idx);
  });

  return (a, b) => {
    const aCanon = getCanonicalPath(a?.path || '', wsDir).toLowerCase();
    const bCanon = getCanonicalPath(b?.path || '', wsDir).toLowerCase();
    const aIdx = orderMap.has(aCanon) ? orderMap.get(aCanon) : 9999;
    const bIdx = orderMap.has(bCanon) ? orderMap.get(bCanon) : 9999;
    return aIdx - bIdx;
  };
}

/**
 * 檢測專案清單同名衝突與同層連帶專案需求
 * @param {Array} folderInfos
 * @returns {{ duplicateCount: number, customNameCount: number }}
 */
function detectNameConflicts(folderInfos) {
  const leafCounts = {};
  let customNameCount = 0;

  folderInfos.forEach((f) => {
    leafCounts[f.leafName] = (leafCounts[f.leafName] || 0) + 1;
    if (f.customName) customNameCount++;
  });

  const conflictingParentDirs = new Set();
  folderInfos.forEach((f) => {
    if (leafCounts[f.leafName] > 1 && f.parentDir) {
      conflictingParentDirs.add(f.parentDir.toLowerCase());
    }
  });

  let duplicateCount = 0;
  folderInfos.forEach((f) => {
    const hasLeafDuplicate = leafCounts[f.leafName] > 1;
    const hasSiblingDuplicate = f.parentDir ? conflictingParentDirs.has(f.parentDir.toLowerCase()) : false;
    f.isDuplicate = hasLeafDuplicate || hasSiblingDuplicate;
    f.expectedName = (f.isDuplicate && f.parentName)
      ? `${f.parentName} \\ ${f.leafName}`
      : f.leafName;
    f.needsFix = f.isDuplicate && f.customName !== f.expectedName;
    if (f.needsFix && f.enabled !== false) {
      duplicateCount++;
    }
  });

  return { duplicateCount, customNameCount };
}

/**
 * 分析當前工作區狀態與同名衝突（包含啟用中 folders 與隱藏中 disabledFolders）
 */
function analyzeWorkspace() {
  const ctx = loadWorkspaceContext();
  if (!ctx) {
    const folders = vscode.workspace.workspaceFolders || [];
    return {
      hasMultiRoot: false,
      workspaceName: folders.length > 0 ? folders[0].name : '未開啟工作區',
      workspacePath: null,
      folderCount: folders.length,
      activeCount: folders.length,
      disabledCount: 0,
      duplicateCount: 0,
      customNameCount: 0,
      hasCustomNames: false,
      folders: folders.map((f) => {
        const fullPath = getCanonicalPath(f.uri.fsPath);
        return {
          name: f.name,
          path: fullPath,
          fullPath,
          leafName: path.basename(fullPath),
          enabled: true,
        };
      }),
    };
  }

  const { wsPath, wsDir, wsName, json } = ctx;
  const orderList = syncFolderOrder(json, wsDir);
  const comparator = createFolderComparator(orderList, wsDir);

  const parseFolderList = (list, isEnabled, source) => {
    return list.map((item, index) => {
      const folderPath = item.path || '';
      const fullPath = getCanonicalPath(folderPath, wsDir);
      const leafName = path.basename(fullPath);
      const parentDir = path.dirname(fullPath);
      const parentName = parentDir ? path.basename(parentDir) : '';

      return {
        item,
        index,
        source,
        path: folderPath,
        fullPath,
        leafName,
        parentDir,
        parentName,
        customName: item.name || null,
        name: item.name || leafName,
        enabled: isEnabled,
      };
    });
  };

  const activeInfos = parseFolderList(json.folders, true, 'folders');
  const disabledInfos = parseFolderList(json.disabledFolders, false, 'disabledFolders');
  const allInfos = [...activeInfos, ...disabledInfos].sort(comparator);

  const { duplicateCount, customNameCount } = detectNameConflicts(allInfos);

  return {
    hasMultiRoot: true,
    workspaceName: wsName,
    workspacePath: wsPath,
    folderCount: allInfos.length,
    activeCount: activeInfos.length,
    disabledCount: disabledInfos.length,
    duplicateCount,
    customNameCount,
    hasCustomNames: customNameCount > 0,
    folders: allInfos,
  };
}

/**
 * 等冪設定或切換專案在工作區中的啟用 (顯示) / 停用 (隱藏) 狀態（維持原始排序）
 * @param {string} targetPath 專案路徑
 * @param {boolean|null} [targetEnabled=null] 目標啟用狀態 (true/false)；若為 null 則自動反轉
 * @param {object} [provider]
 */
function setWorkspaceFolderEnabled(targetPath, targetEnabled = null, provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  const orderList = syncFolderOrder(json, wsDir);
  const comparator = createFolderComparator(orderList, wsDir);
  const targetCanonical = getCanonicalPath(targetPath, wsDir).toLowerCase();

  const findIdx = (arr) => arr.findIndex((f) => getCanonicalPath(f.path || '', wsDir).toLowerCase() === targetCanonical);

  const activeIndex = findIdx(json.folders);
  const disabledIndex = findIdx(json.disabledFolders);

  if (activeIndex === -1 && disabledIndex === -1) {
    if (provider?.pushToast) provider.pushToast('未找到指定的專案資料夾。', 'warning');
    return false;
  }

  // 判定是否需要啟用：若 targetEnabled 為 boolean 則以此為準，否則取反
  let isEnabling;
  if (typeof targetEnabled === 'boolean') {
    // 等冪性檢查：若已經符合目標狀態，直接返回成功，無需任何多餘寫入
    if (targetEnabled && activeIndex !== -1) return true;
    if (!targetEnabled && disabledIndex !== -1) return true;
    isEnabling = targetEnabled;
  } else {
    isEnabling = activeIndex === -1 && disabledIndex !== -1;
  }

  const fromList = isEnabling ? json.disabledFolders : json.folders;
  const toList = isEnabling ? json.folders : json.disabledFolders;
  const targetIdx = isEnabling ? disabledIndex : activeIndex;

  if (targetIdx !== -1 && fromList[targetIdx]) {
    const [movedItem] = fromList.splice(targetIdx, 1);
    toList.push(movedItem);

    json.folders.sort(comparator);
    json.disabledFolders.sort(comparator);

    saveWorkspaceJson(wsPath, json);
  }

  return true;
}

/**
 * 相容舊呼叫：切換專案在工作區中的啟用 / 停用狀態
 * @param {string} targetPath 專案路徑
 * @param {object} [provider]
 */
function toggleWorkspaceFolder(targetPath, provider = null) {
  return setWorkspaceFolderEnabled(targetPath, null, provider);
}

/**
 * 僅顯示首項專案（將第 1 個專案啟用，其餘移至 disabledFolders 隱藏）
 * @param {object} [provider]
 */
function showOnlyFirstWorkspaceFolder(provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  const orderList = syncFolderOrder(json, wsDir);
  const comparator = createFolderComparator(orderList, wsDir);

  const allItems = [...json.folders, ...json.disabledFolders].sort(comparator);
  if (allItems.length === 0) {
    const msg = '工作區未設定任何專案資料夾。';
    if (provider?.pushToast) provider.pushToast(msg, 'info');
    else vscode.window.showInformationMessage(msg);
    return false;
  }

  // 首項保留啟用，其餘全部隱藏
  json.folders = [allItems[0]];
  json.disabledFolders = allItems.slice(1);

  saveWorkspaceJson(wsPath, json);
  if (provider?.pushToast) provider.pushToast('已切換為僅顯示首項專案！', 'success');
  return true;
}

/**
 * 顯示全部專案（將所有專案啟用移入 folders，清空 disabledFolders）
 * @param {object} [provider]
 */
function showAllWorkspaceFolders(provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  const orderList = syncFolderOrder(json, wsDir);
  const comparator = createFolderComparator(orderList, wsDir);

  const allItems = [...json.folders, ...json.disabledFolders].sort(comparator);
  if (allItems.length === 0) {
    const msg = '工作區未設定任何專案資料夾。';
    if (provider?.pushToast) provider.pushToast(msg, 'info');
    else vscode.window.showInformationMessage(msg);
    return false;
  }

  json.folders = allItems;
  json.disabledFolders = [];

  saveWorkspaceJson(wsPath, json);
  if (provider?.pushToast) provider.pushToast('已全部顯示工作區專案！', 'success');
  return true;
}

/**
 * 反轉專案顯示狀態（首項強制保持開啟，其餘專案顯示/隱藏狀態反轉）
 * @param {object} [provider]
 */
function invertWorkspaceFolders(provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  const orderList = syncFolderOrder(json, wsDir);
  const comparator = createFolderComparator(orderList, wsDir);

  const activeSet = new Set(
    json.folders.map((f) => getCanonicalPath(f.path || '', wsDir).toLowerCase())
  );
  const allItems = [...json.folders, ...json.disabledFolders].sort(comparator);
  if (allItems.length === 0) {
    if (provider?.pushToast) provider.pushToast('工作區未設定任何專案資料夾。', 'info');
    return false;
  }

  const nextFolders = [];
  const nextDisabled = [];

  allItems.forEach((item, index) => {
    const canon = getCanonicalPath(item.path || '', wsDir).toLowerCase();
    const wasActive = activeSet.has(canon);
    const willBeActive = index === 0 ? true : !wasActive;

    if (willBeActive) {
      nextFolders.push(item);
    } else {
      nextDisabled.push(item);
    }
  });

  json.folders = nextFolders;
  json.disabledFolders = nextDisabled;

  saveWorkspaceJson(wsPath, json);
  if (provider?.pushToast) provider.pushToast('已反轉專案顯示狀態！', 'success');
  return true;
}

/**
 * 修正工作區同名專案名稱（包含同層連帶專案與隱藏專案）
 * @param {object} [provider]
 */
function fixWorkspaceDuplicates(provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  const allItems = [
    ...json.folders.map((item, index) => ({ item, index, source: 'folders' })),
    ...json.disabledFolders.map((item, index) => ({ item, index, source: 'disabledFolders' })),
  ];

  if (allItems.length === 0) {
    const msg = '工作區未設定任何專案資料夾。';
    if (provider?.pushToast) provider.pushToast(msg, 'info');
    else vscode.window.showInformationMessage(msg);
    return false;
  }

  const folderInfos = allItems.map(({ item, index, source }) => {
    const folderPath = item.path || '';
    const fullPath = getCanonicalPath(folderPath, wsDir);
    return {
      item,
      index,
      source,
      fullPath,
      leafName: path.basename(fullPath),
      parentDir: path.dirname(fullPath),
      parentName: path.basename(path.dirname(fullPath)),
      customName: item.name || null,
    };
  });

  detectNameConflicts(folderInfos);

  let changedCount = 0;
  folderInfos.forEach((f) => {
    if (f.needsFix) {
      json[f.source][f.index].name = f.expectedName;
      changedCount++;
    }
  });

  if (changedCount > 0) {
    saveWorkspaceJson(wsPath, json);
    const msg = `已成功修正 ${changedCount} 個專案名稱為「父資料夾 \\ 專案名」格式（含同層連帶專案）！`;
    if (provider?.pushToast) provider.pushToast(msg, 'success');
    else vscode.window.showInformationMessage(msg);
    return true;
  }

  const msg = '目前工作區專案名稱良好，無同名衝突或待修正項目。';
  if (provider?.pushToast) provider.pushToast(msg, 'info');
  else vscode.window.showInformationMessage(msg);
  return false;
}

/**
 * 重設工作區專案為預設資料夾名稱 (移除 custom name)
 * @param {object} [provider]
 */
function resetWorkspaceNames(provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, json } = ctx;
  const allItems = [...json.folders, ...json.disabledFolders];

  if (allItems.length === 0) {
    const msg = '工作區未設定任何專案資料夾。';
    if (provider?.pushToast) provider.pushToast(msg, 'info');
    else vscode.window.showInformationMessage(msg);
    return false;
  }

  let removedCount = 0;
  allItems.forEach((item) => {
    if (item.name !== undefined && item.name !== null) {
      delete item.name;
      removedCount++;
    }
  });

  if (removedCount > 0) {
    saveWorkspaceJson(wsPath, json);
    const msg = `已成功將 ${removedCount} 個專案名稱重設為預設名稱！`;
    if (provider?.pushToast) provider.pushToast(msg, 'success');
    else vscode.window.showInformationMessage(msg);
    return true;
  }

  const msg = '目前工作區所有專案皆已為預設名稱，無需重設。';
  if (provider?.pushToast) provider.pushToast(msg, 'info');
  else vscode.window.showInformationMessage(msg);
  return false;
}

/**
 * 重新排列工作區專案順序 (依據前端拖曳傳遞的新順序)
 * @param {string[]} newOrderPaths 新的專案路徑順序陣列
 * @param {object} [provider]
 */
function reorderWorkspaceFolders(newOrderPaths, provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  json.folderOrder = newOrderPaths;

  const comparator = createFolderComparator(newOrderPaths, wsDir);
  json.folders.sort(comparator);
  json.disabledFolders.sort(comparator);

  saveWorkspaceJson(wsPath, json);
  if (provider?.pushToast) provider.pushToast('專案排序已更新！', 'success');
  return true;
}

module.exports = {
  loadWorkspaceContext,
  invalidateWorkspaceCache,
  saveWorkspaceJson,
  analyzeWorkspace,
  setWorkspaceFolderEnabled,
  toggleWorkspaceFolder,
  showOnlyFirstWorkspaceFolder,
  showAllWorkspaceFolders,
  invertWorkspaceFolders,
  fixWorkspaceDuplicates,
  resetWorkspaceNames,
  reorderWorkspaceFolders,
};
