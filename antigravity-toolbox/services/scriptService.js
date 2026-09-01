const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalPath } = require('./systemService');
const { loadWorkspaceContext, saveWorkspaceJson, analyzeWorkspace } = require('./workspaceService');

/**
 * 計算兩路徑的相對路徑 (支援跨磁碟安全處理)
 * @param {string} fromDir 基準目錄
 * @param {string} toPath 目標路徑
 * @returns {string}
 */
function getSafeRelativePath(fromDir, toPath) {
  try {
    const rel = path.relative(fromDir, toPath);
    // 如果不是以 .. 開頭且不是絕對路徑，採用正斜線標準化
    if (!path.isAbsolute(rel) && !rel.startsWith('..')) {
      return rel.replace(/\\/g, '/');
    }
  } catch {}
  return toPath.replace(/\\/g, '/');
}

/**
 * 標準化路徑 (統一正斜線，大寫磁碟代號，去除尾部斜線)
 * @param {string} p
 * @returns {string}
 */
function normalizeStandardPath(p) {
  if (!p) return '';
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(norm)) {
    norm = norm[0].toUpperCase() + norm.slice(1);
  }
  if (norm.length > 3 && norm.endsWith('/')) {
    norm = norm.slice(0, -1);
  }
  return norm;
}

/**
 * 獲取並解析當前工作區的所有腳本清單（依專案排列順序自動排序）
 * @returns {{ scripts: Array<object>, count: number }}
 */
function getWorkspaceScripts() {
  const ctx = loadWorkspaceContext();
  if (!ctx) {
    return { scripts: [], count: 0 };
  }

  const { wsPath, wsDir, json } = ctx;
  const rawScripts = Array.isArray(json.scripts) ? json.scripts : [];
  if (rawScripts.length === 0) {
    return { scripts: [], count: 0 };
  }

  // 取得工作區專案分析資訊（包含排序好的 folders 與其 customName）
  const wsStatus = analyzeWorkspace();
  const folders = Array.isArray(wsStatus.folders) ? wsStatus.folders : [];

  const parsedScripts = rawScripts.map((item, originalIndex) => {
    const rawPath = typeof item === 'string' ? item : (item.path || '');
    const canonicalFullPath = getCanonicalPath(rawPath, wsDir);
    const normScriptPath = normalizeStandardPath(canonicalFullPath).toLowerCase();
    const exists = fs.existsSync(canonicalFullPath);
    const fileName = path.basename(canonicalFullPath);
    const ext = path.extname(canonicalFullPath).toLowerCase();
    const type = ext.replace('.', '') || 'ps1';
    const isCustom = typeof item === 'object' && Boolean(item.name);
    const customName = isCustom ? item.name : null;
    const scriptTitle = isCustom ? item.name : fileName;

    // 比對此腳本隸屬於哪一個專案資料夾
    let matchedFolderIndex = 9999;
    let matchedFolderName = '';
    let matchedFolderPath = '';
    let matchedFolderEnabled = false;

    for (let i = 0; i < folders.length; i++) {
      const f = folders[i];
      const fCanon = getCanonicalPath(f.fullPath || f.path || '', wsDir);
      const normFolder = normalizeStandardPath(fCanon).toLowerCase();

      // 若腳本路徑為該專案資料夾或座落於該專案路徑之下
      if (normScriptPath === normFolder || normScriptPath.startsWith(normFolder + '/')) {
        matchedFolderIndex = i;
        matchedFolderName = f.name || f.leafName || path.basename(fCanon);
        matchedFolderPath = fCanon;
        matchedFolderEnabled = f.enabled !== false;
        break;
      }
    }

    // 若未落在已知專案資料夾中（例如所屬專案已被從工作區移除，或為外部腳本）
    if (matchedFolderIndex === 9999) {
      const parentDir = path.dirname(canonicalFullPath);
      matchedFolderName = path.basename(parentDir) || '外部腳本';
      matchedFolderPath = parentDir;
      // 若工作區有設定專案，未落在任何專案中的腳本視為已移出工作區而動態隱藏
      matchedFolderEnabled = folders.length === 0;
    }

    return {
      id: `${matchedFolderIndex}-${fileName}-${originalIndex}`,
      name: scriptTitle,
      fileName,
      customName,
      hasCustomName: Boolean(customName),
      rawPath,
      fullPath: canonicalFullPath,
      type,
      exists,
      folderIndex: matchedFolderIndex,
      folderEnabled: matchedFolderEnabled,
      workspaceName: matchedFolderName,
      projectPath: matchedFolderPath,
      originalIndex,
    };
  });

  // 只保留所屬專案處於啟用狀態 (在檔案總管中已加載) 的腳本
  const activeScripts = parsedScripts.filter((s) => s.folderEnabled);

  // 依專案排列順序 (folderIndex) 進行排序；同專案內按檔案名稱排序
  activeScripts.sort((a, b) => {
    if (a.folderIndex !== b.folderIndex) {
      return a.folderIndex - b.folderIndex;
    }
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    scripts: activeScripts,
    count: activeScripts.length,
  };
}

/**
 * 新增一或多個腳本至專案腳本執行器
 * @param {vscode.Uri[]|vscode.Uri} uris 檔案 URI 清單或單一 URI
 * @param {object} [provider]
 */
function addScripts(uris, provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) {
    const msg = '目前尚未開啟任何 .code-workspace 多專案工作區，無法儲存專案腳本！';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    else vscode.window.showWarningMessage(msg);
    return false;
  }

  const { wsPath, wsDir, json } = ctx;
  if (!Array.isArray(json.scripts)) {
    json.scripts = [];
  }

  const uriList = Array.isArray(uris) ? uris : [uris];
  let addedCount = 0;
  let duplicateCount = 0;

  // 取得現有腳本的 Canonical Path 集合防重複
  const existingSet = new Set(
    json.scripts.map((s) => {
      const p = typeof s === 'string' ? s : (s.path || '');
      return getCanonicalPath(p, wsDir).toLowerCase();
    })
  );

  uriList.forEach((uri) => {
    if (!uri || !uri.fsPath) return;
    const fsPath = uri.fsPath;
    const ext = path.extname(fsPath).toLowerCase();
    if (!['.ps1', '.bat', '.cmd'].includes(ext)) {
      return;
    }

    const canon = getCanonicalPath(fsPath, wsDir).toLowerCase();
    if (existingSet.has(canon)) {
      duplicateCount++;
      return;
    }

    const relPath = getSafeRelativePath(wsDir, fsPath);
    const baseName = path.basename(fsPath, ext);

    json.scripts.push({
      name: baseName,
      path: relPath,
    });

    existingSet.add(canon);
    addedCount++;
  });

  if (addedCount > 0) {
    saveWorkspaceJson(wsPath, json);
    if (provider?.pushToast) {
      provider.pushToast(`已成功加入 ${addedCount} 個腳本至執行器！`, 'success');
      provider.pushStatus();
    } else {
      vscode.window.showInformationMessage(`已成功加入 ${addedCount} 個腳本至專案腳本執行器！`);
    }
    return true;
  } else if (duplicateCount > 0) {
    if (provider?.pushToast) {
      provider.pushToast('所選腳本已存在於專案執行器中。', 'info');
    }
    return false;
  }

  return false;
}

/**
 * 彈出 VS Code 檔案選取視窗供使用者瀏覽並多選腳本
 * @param {object} [provider]
 */
async function pickAndAddScripts(provider = null) {
  const ctx = loadWorkspaceContext(provider);
  const defaultUri = ctx ? vscode.Uri.file(ctx.wsDir) : undefined;

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    defaultUri,
    openLabel: '加入腳本',
    title: '選取要加入至專案腳本執行器的腳本檔案',
    filters: {
      '腳本檔案 (*.ps1, *.bat, *.cmd)': ['ps1', 'bat', 'cmd'],
      'PowerShell 腳本 (*.ps1)': ['ps1'],
      'Batch 批次檔 (*.bat, *.cmd)': ['bat', 'cmd'],
      '所有檔案 (*.*)': ['*'],
    },
  });

  if (selected && selected.length > 0) {
    addScripts(selected, provider);
  }
}

/**
 * 從專案腳本執行器清單中移除指定腳本
 * @param {string} targetPath 腳本的相對或絕對路徑
 * @param {object} [provider]
 */
function removeScript(targetPath, provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) return false;

  const { wsPath, wsDir, json } = ctx;
  if (!Array.isArray(json.scripts)) return false;

  const targetCanon = getCanonicalPath(targetPath, wsDir).toLowerCase();
  const initialLength = json.scripts.length;

  json.scripts = json.scripts.filter((s) => {
    const p = typeof s === 'string' ? s : (s.path || '');
    return getCanonicalPath(p, wsDir).toLowerCase() !== targetCanon;
  });

  if (json.scripts.length !== initialLength) {
    saveWorkspaceJson(wsPath, json);
    if (provider?.pushToast) {
      provider.pushToast('已從執行器清單移除該腳本。', 'info');
      provider.pushStatus();
    }
    return true;
  }
  return false;
}

/**
 * 重新命名腳本在執行器中的自訂顯示名稱 (僅修改工作區設定，不變更磁碟檔案實體檔名)
 * @param {string} targetPath 腳本路徑
 * @param {object} [provider]
 */
async function renameScript(targetPath, provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) return false;

  const { wsPath, wsDir, json } = ctx;
  if (!Array.isArray(json.scripts)) return false;

  const canonicalFullPath = resolveScriptPath(targetPath, provider) || getCanonicalPath(targetPath, wsDir);
  const targetCanon = canonicalFullPath.toLowerCase();

  const scriptItem = json.scripts.find((s) => {
    const p = typeof s === 'string' ? s : (s.path || '');
    return getCanonicalPath(p, wsDir).toLowerCase() === targetCanon;
  });

  if (!scriptItem) {
    const msg = '未在專案執行器中找到指定腳本。';
    if (provider?.pushToast) provider.pushToast(msg, 'warning');
    return false;
  }

  const currentDisplayName = (typeof scriptItem === 'object' && scriptItem.name) ? scriptItem.name : path.basename(canonicalFullPath);

  const inputName = await vscode.window.showInputBox({
    prompt: '請輸入此腳本在控制中心的「自訂顯示名稱」（不影響磁碟檔名）：',
    value: currentDisplayName,
    placeHolder: '例如：一鍵同步全部擴充套件',
    validateInput: (val) => {
      if (!val || !val.trim()) {
        return '顯示名稱不可為空白';
      }
      return null;
    },
  });

  if (!inputName || !inputName.trim()) {
    return false;
  }

  const newName = inputName.trim();
  const idx = json.scripts.indexOf(scriptItem);
  if (typeof scriptItem === 'string') {
    json.scripts[idx] = {
      name: newName,
      path: scriptItem,
    };
  } else {
    scriptItem.name = newName;
  }

  saveWorkspaceJson(wsPath, json);

  if (provider?.pushToast) {
    provider.pushToast(`已重命名顯示名稱為「${newName}」！`, 'success');
    provider.pushStatus();
  } else {
    vscode.window.showInformationMessage(`已將腳本顯示名稱更新為「${newName}」！`);
  }

  return true;
}

/**
 * 恢復腳本為預設檔案名稱 (移除 custom name)
 * @param {string} targetPath 腳本路徑
 * @param {object} [provider]
 */
function resetScriptDisplayName(targetPath, provider = null) {
  const ctx = loadWorkspaceContext(provider);
  if (!ctx) return false;

  const { wsPath, wsDir, json } = ctx;
  if (!Array.isArray(json.scripts)) return false;

  const canonicalFullPath = resolveScriptPath(targetPath, provider) || getCanonicalPath(targetPath, wsDir);
  const targetCanon = canonicalFullPath.toLowerCase();

  const scriptItem = json.scripts.find((s) => {
    const p = typeof s === 'string' ? s : (s.path || '');
    return getCanonicalPath(p, wsDir).toLowerCase() === targetCanon;
  });

  if (!scriptItem) {
    return false;
  }

  if (typeof scriptItem === 'object' && scriptItem.name) {
    delete scriptItem.name;
    saveWorkspaceJson(wsPath, json);

    if (provider?.pushToast) {
      provider.pushToast('已恢復為預設檔案名稱！', 'success');
      provider.pushStatus();
    }
    return true;
  }

  return false;
}

/**
 * 智能解析腳本實體路徑 (支援絕對路徑、工作區相對路徑與專案多資料夾搜尋)
 * @param {string} scriptPath
 * @param {object} [provider]
 * @returns {string|null}
 */
function resolveScriptPath(scriptPath, provider = null) {
  if (!scriptPath) return null;

  // 1. 若 scriptPath 本身即為有效絕對路徑
  const directPath = getCanonicalPath(scriptPath);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  // 2. 結合 .code-workspace 所在目錄解析
  const ctx = loadWorkspaceContext(provider);
  if (ctx && ctx.wsDir) {
    const wsRelPath = getCanonicalPath(scriptPath, ctx.wsDir);
    if (fs.existsSync(wsRelPath)) {
      return wsRelPath;
    }
  }

  // 3. 結合 VS Code 目前開啟的所有工作區資料夾解析
  const wsFolders = vscode.workspace.workspaceFolders || [];
  for (const wf of wsFolders) {
    const folderRelPath = getCanonicalPath(scriptPath, wf.uri.fsPath);
    if (fs.existsSync(folderRelPath)) {
      return folderRelPath;
    }
  }

  return null;
}

/**
 * 執行腳本 (支援一般權限在 Terminal 運行與系統管理員 UAC 提權運行)
 * @param {string} scriptPath 腳本絕對或相對路徑
 * @param {boolean} asAdmin 是否以 Windows 系統管理員身分運行
 * @param {object} [provider]
 */
function runScript(scriptPath, asAdmin = false, provider = null) {
  const canonicalFullPath = resolveScriptPath(scriptPath, provider);

  if (!canonicalFullPath || !fs.existsSync(canonicalFullPath)) {
    const msg = `找不到腳本實體檔案：${scriptPath}`;
    if (provider?.pushToast) provider.pushToast(msg, 'error');
    else vscode.window.showErrorMessage(msg);
    return;
  }

  const fileName = path.basename(canonicalFullPath);
  const scriptDir = path.dirname(canonicalFullPath);
  const ext = path.extname(canonicalFullPath).toLowerCase();

  try {
    const terminalName = asAdmin ? `[管理員] ${fileName}` : `[腳本] ${fileName}`;
    let terminal = vscode.window.terminals.find((t) => t.name === terminalName);
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: scriptDir,
      });
    }

    terminal.show(true);

    if (asAdmin) {
      // 1. 管理員身分執行 (透過前台 PTY 終端機以 PowerShell 原生陣列調用，既支援空格檔名又保持終端機輸出清爽美觀)
      if (ext === '.ps1') {
        terminal.sendText(`Write-Host ">> 正在以系統管理員權限啟動：${fileName}..." -ForegroundColor Cyan; Start-Process -FilePath "powershell.exe" -WorkingDirectory '${scriptDir}' -Verb RunAs -ArgumentList @('-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', '""${canonicalFullPath}""')`);
      } else {
        // bat / cmd (使用 /k 保留管理員視窗檢視執行結果)
        terminal.sendText(`Write-Host ">> 正在以系統管理員權限啟動：${fileName}..." -ForegroundColor Cyan; Start-Process -FilePath "cmd.exe" -WorkingDirectory '${scriptDir}' -Verb RunAs -ArgumentList @('/k', '""${canonicalFullPath}""')`);
      }

      if (provider?.pushToast) {
        provider.pushToast(`已透過終端機發起管理員提權：${fileName}`, 'success');
      }
    } else {
      // 2. 一般權限執行
      if (ext === '.ps1') {
        terminal.sendText(`powershell.exe -NoLogo -ExecutionPolicy Bypass -File "${canonicalFullPath}"`);
      } else {
        // 使用 PowerShell 官方呼叫運算子 & 直接執行 .bat / .cmd，100% 免疫路徑空格與引號問題
        terminal.sendText(`& "${canonicalFullPath}"`);
      }

      if (provider?.pushToast) {
        provider.pushToast(`正在終端機執行：${fileName}`, 'info');
      }
    }
  } catch (err) {
    const msg = `執行腳本失敗：${err.message}`;
    if (provider?.pushToast) provider.pushToast(msg, 'error');
    else vscode.window.showErrorMessage(msg);
  }
}

/**
 * 在 VS Code 左側檔案總管樹狀圖中定位並選中該檔案
 * @param {string} scriptPath 腳本路徑
 * @param {object} [provider]
 */
async function revealScriptInExplorer(scriptPath, provider = null) {
  const canonicalFullPath = resolveScriptPath(scriptPath, provider);
  if (!canonicalFullPath || !fs.existsSync(canonicalFullPath)) {
    const msg = `找不到腳本實體檔案：${scriptPath}`;
    if (provider?.pushToast) provider.pushToast(msg, 'error');
    else vscode.window.showErrorMessage(msg);
    return false;
  }

  try {
    const uri = vscode.Uri.file(canonicalFullPath);
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return true;
  } catch (err) {
    const msg = `無法在檔案總管中定位檔案：${err.message}`;
    if (provider?.pushToast) provider.pushToast(msg, 'error');
    else vscode.window.showErrorMessage(msg);
    return false;
  }
}

module.exports = {
  getWorkspaceScripts,
  addScripts,
  pickAndAddScripts,
  removeScript,
  renameScript,
  resetScriptDisplayName,
  runScript,
  revealScriptInExplorer,
};
