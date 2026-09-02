const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fsPromises = require('node:fs/promises');

/**
 * 輔助安全建立並獲取目錄
 * @param {string} dirPath
 * @returns {string}
 */
function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * 安全解析 JSON（支援去除 UTF-8 BOM）
 */
function safeJsonParse(content, fallback = null) {
  if (!content) return fallback;
  try {
    const clean = content.replace(/^\uFEFF/, '').trim();
    return JSON.parse(clean);
  } catch {
    return fallback;
  }
}

/**
 * 直接開啟 Windows 檔案總管獨立視窗進入資料夾內部
 * @param {string} folderPath
 */
function openFolderInside(folderPath) {
  if (!folderPath) return;
  ensureDirectory(folderPath);
  const winPath = path.normalize(folderPath);
  try {
    const child = spawn('explorer.exe', [winPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    vscode.window.showErrorMessage(`無法開啟 Windows 檔案總管：${err.message}`);
  }
}

/**
 * 解析路徑並自動校正為 Windows 磁碟實體的真實大小寫 (Canonical Path)
 * @param {string} targetPath
 * @param {string} [baseDir]
 * @returns {string}
 */
function getCanonicalPath(targetPath, baseDir) {
  if (!targetPath) return '';
  let fullPath = targetPath;
  if (baseDir && !path.isAbsolute(targetPath)) {
    fullPath = path.resolve(baseDir, targetPath);
  }
  fullPath = path.normalize(fullPath);

  try {
    if (fs.existsSync(fullPath)) {
      if (typeof fs.realpathSync.native === 'function') {
        fullPath = fs.realpathSync.native(fullPath);
      } else {
        fullPath = fs.realpathSync(fullPath);
      }
    }
  } catch {}

  return fullPath;
}

/**
 * 遞迴計算目錄總位元組大小 (非同步)
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
async function getDirectorySizeBytesAsync(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await getDirectorySizeBytesAsync(fullPath);
        } else if (entry.isFile()) {
          const stat = await fsPromises.stat(fullPath);
          total += stat.size;
        }
      } catch {}
    }
  } catch {}
  return total;
}

/**
 * 取得全域目錄路徑對應表
 */
function getGlobalPaths() {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  const globalConfigRoot = path.join(homeDir, '.gemini', 'config');
  const globalAppRoot = path.join(homeDir, '.gemini', 'antigravity-ide');
  const userSettingsDir = path.join(appData, 'Antigravity IDE', 'User');
  const userSettingsPath = path.join(userSettingsDir, 'settings.json');
  const ideExtensionsDir = path.join(homeDir, '.antigravity-ide', 'extensions');

  return {
    globalConfig: globalConfigRoot,
    skills: path.join(globalConfigRoot, 'skills'),
    rules: path.join(globalConfigRoot, 'rules'),
    plugins: path.join(globalConfigRoot, 'plugins'),
    mcpConfig: path.join(globalConfigRoot, 'mcp_config.json'),
    appData: globalAppRoot,
    brain: path.join(globalAppRoot, 'brain'),
    userSettingsDir: userSettingsDir,
    userSettingsPath: userSettingsPath,
    ideExtensions: ideExtensionsDir,
  };
}

/**
 * 處理開啟特定目標（設定檔、JSON、目錄）
 * @param {string} target
 * @param {object} provider
 */
async function handleOpenTarget(target, provider) {
  const paths = getGlobalPaths();
  try {
    if (target === 'settingsJson') {
      await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    } else if (target === 'settingsFolder') {
      await openFolderInside(paths.userSettingsDir);
    } else if (target === 'mcpConfig') {
      ensureDirectory(paths.globalConfig);
      if (fs.existsSync(paths.mcpConfig)) {
        const doc = await vscode.workspace.openTextDocument(paths.mcpConfig);
        await vscode.window.showTextDocument(doc);
      } else {
        fs.writeFileSync(paths.mcpConfig, '{\n  "mcpServers": {}\n}\n', 'utf-8');
        const doc = await vscode.workspace.openTextDocument(paths.mcpConfig);
        await vscode.window.showTextDocument(doc);
      }
    } else if (paths[target]) {
      await openFolderInside(paths[target]);
    }
  } catch (e) {
    if (provider && typeof provider.pushToast === 'function') {
      provider.pushToast(`開啟失敗：${e.message}`, 'error');
    } else {
      vscode.window.showErrorMessage(`開啟失敗：${e.message}`);
    }
  }
}

/**
 * 取得當前檔案總管過濾與排除設定狀態
 */
function getExplorerSettings() {
  const filesConfig = vscode.workspace.getConfiguration('files');
  const explorerConfig = vscode.workspace.getConfiguration('explorer');

  const exclude = filesConfig.get('exclude') || {};
  const excludeGitIgnore = explorerConfig.get('excludeGitIgnore', false);

  return {
    hideGitignore: !!exclude['**/.gitignore'],
    excludeGitIgnore: !!excludeGitIgnore,
    hideSystemJunk: !!(exclude['**/Thumbs.db'] || exclude['**/.DS_Store']),
    hidePythonCache: !!(exclude['**/__pycache__'] || exclude['**/*.pyc']),
  };
}

/**
 * 切換檔案總管過濾設定
 * @param {string} settingKey
 * @param {object} provider
 */
async function toggleExplorerSetting(settingKey, provider) {
  const filesConfig = vscode.workspace.getConfiguration('files');
  const explorerConfig = vscode.workspace.getConfiguration('explorer');

  try {
    if (settingKey === 'hideGitignore') {
      const current = { ...(filesConfig.get('exclude') || {}) };
      const isCurrentlyHidden = !!current['**/.gitignore'];
      const nextVal = !isCurrentlyHidden;
      if (nextVal) {
        current['**/.gitignore'] = true;
      } else {
        current['**/.gitignore'] = false;
      }
      await filesConfig.update('exclude', current, vscode.ConfigurationTarget.Global);
      if (provider) provider.pushToast(nextVal ? '已在檔案總管中隱藏 .gitignore' : '已在檔案總管中顯示 .gitignore', 'info');
    } else if (settingKey === 'excludeGitIgnore') {
      const current = explorerConfig.get('excludeGitIgnore', false);
      const nextVal = !current;
      await explorerConfig.update('excludeGitIgnore', nextVal, vscode.ConfigurationTarget.Global);
      if (provider) provider.pushToast(nextVal ? '已隱藏 Git 忽略之檔案' : '已顯示 Git 忽略之檔案', 'info');
    } else if (settingKey === 'hideSystemJunk') {
      const current = { ...(filesConfig.get('exclude') || {}) };
      const isCurrentlyHidden = !!(current['**/Thumbs.db'] || current['**/.DS_Store']);
      const nextVal = !isCurrentlyHidden;
      if (nextVal) {
        current['**/Thumbs.db'] = true;
        current['**/.DS_Store'] = true;
        current['**/desktop.ini'] = true;
      } else {
        current['**/Thumbs.db'] = false;
        current['**/.DS_Store'] = false;
        current['**/desktop.ini'] = false;
      }
      await filesConfig.update('exclude', current, vscode.ConfigurationTarget.Global);
      if (provider) provider.pushToast(nextVal ? '已隱藏系統雜項 (Thumbs.db, .DS_Store)' : '已顯示系統雜項', 'info');
    } else if (settingKey === 'hidePythonCache') {
      const current = { ...(filesConfig.get('exclude') || {}) };
      const isCurrentlyHidden = !!(current['**/__pycache__'] || current['**/*.pyc']);
      const nextVal = !isCurrentlyHidden;
      if (nextVal) {
        current['**/__pycache__'] = true;
        current['**/*.pyc'] = true;
      } else {
        current['**/__pycache__'] = false;
        current['**/*.pyc'] = false;
      }
      await filesConfig.update('exclude', current, vscode.ConfigurationTarget.Global);
      if (provider) provider.pushToast(nextVal ? '已隱藏 Python 快取 (__pycache__)' : '已顯示 Python 快取', 'info');
    }
  } catch (err) {
    if (provider) provider.pushToast(`設定更新失敗：${err.message}`, 'error');
  }
}

module.exports = {
  ensureDirectory,
  safeJsonParse,
  openFolderInside,
  getCanonicalPath,
  getDirectorySizeBytesAsync,
  getGlobalPaths,
  handleOpenTarget,
  getExplorerSettings,
  toggleExplorerSetting,
};

