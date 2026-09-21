const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fsPromises = require('node:fs/promises');

/** @type {vscode.ExtensionContext | null} */
let extensionContext = null;

/**
 * 綁定 ExtensionContext，供後續以實際 User / extensions 路徑解析當前 IDE
 * @param {vscode.ExtensionContext} context
 */
function bindExtensionContext(context) {
  extensionContext = context || null;
}

function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || '';
}

function getAppDataDir() {
  const homeDir = getHomeDir();
  return process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
}

/**
 * 偵測當前 Extension Host 所屬 IDE（VS Code 與相容分支：Cursor、VSCodium、Antigravity）
 * 優先用 context 推導真實路徑，避免寫死 AppData 資料夾名稱。
 */
function detectHostIde() {
  const appName = vscode.env.appName || '';
  const homeDir = getHomeDir();
  const appData = getAppDataDir();

  let id = 'vscode';
  let userDataFolder = 'Code';
  let extensionsHome = path.join(homeDir, '.vscode');

  if (/antigravity/i.test(appName)) {
    id = 'antigravity';
    userDataFolder = 'Antigravity IDE';
    extensionsHome = path.join(homeDir, '.antigravity-ide');
  } else if (/cursor/i.test(appName)) {
    id = 'cursor';
    userDataFolder = 'Cursor';
    extensionsHome = path.join(homeDir, '.cursor');
  } else if (/insider/i.test(appName)) {
    id = 'vscode-insiders';
    userDataFolder = 'Code - Insiders';
    extensionsHome = path.join(homeDir, '.vscode-insiders');
  } else if (/vscodium|codium/i.test(appName)) {
    id = 'vscodium';
    userDataFolder = 'VSCodium';
    extensionsHome = path.join(homeDir, '.vscode-oss');
  }

  let userSettingsDir = path.join(appData, userDataFolder, 'User');
  let ideExtensionsDir = path.join(extensionsHome, 'extensions');

  if (extensionContext?.globalStorageUri?.fsPath) {
    // {userData}/User/globalStorage/{extId} → User
    userSettingsDir = path.normalize(path.join(extensionContext.globalStorageUri.fsPath, '..', '..'));
  }

  if (extensionContext?.extensionUri?.fsPath) {
    const parent = path.dirname(extensionContext.extensionUri.fsPath);
    if (path.basename(parent).toLowerCase() === 'extensions') {
      ideExtensionsDir = parent;
    }
  }

  return {
    id,
    appName,
    displayName: appName || 'VS Code',
    isAntigravityIDE: id === 'antigravity',
    isCursor: id === 'cursor',
    userSettingsDir,
    userSettingsPath: path.join(userSettingsDir, 'settings.json'),
    ideExtensionsDir,
  };
}

/** @type {boolean | null} */
let _copilotEnvironmentCache = null;

/**
 * 偵測目前環境是否為「VS Code 家族 + GitHub Copilot」
 *
 * 判定優先序（由強至弱）：
 *   1. Extension API 是否載入 Copilot 擴充套件（最準確）
 *   2. 使用者資料目錄是否已有 Copilot Chat 儲存區
 *   3. 是否存在 BYOK 語言模型設定或 Copilot CLI 家目錄
 *
 * @returns {boolean}
 */
function isCopilotEnvironment() {
  if (_copilotEnvironmentCache !== null) return _copilotEnvironmentCache;

  const host = detectHostIde();
  const isVsCodeFamily = host.id === 'vscode' || host.id === 'vscode-insiders' || host.id === 'vscodium';
  if (!isVsCodeFamily) {
    _copilotEnvironmentCache = false;
    return _copilotEnvironmentCache;
  }

  try {
    const ext = vscode.extensions.getExtension('github.copilot-chat')
      || vscode.extensions.getExtension('github.copilot');
    if (ext) {
      _copilotEnvironmentCache = true;
      return _copilotEnvironmentCache;
    }
  } catch {}

  const homeDir = getHomeDir();
  const markers = [
    path.join(host.userSettingsDir, 'globalStorage', 'github.copilot-chat'),
    path.join(host.userSettingsDir, 'chatLanguageModels.json'),
    path.join(homeDir, '.copilot', 'session-store.db'),
  ];
  _copilotEnvironmentCache = markers.some((marker) => fs.existsSync(marker));
  return _copilotEnvironmentCache;
}

/**
 * 清除 Copilot 環境偵測快取（供設定變更或測試時重新判定）
 */
function resetCopilotEnvironmentCache() {
  _copilotEnvironmentCache = null;
}

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
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        try {
          if (entry.isDirectory()) {
            return await getDirectorySizeBytesAsync(fullPath);
          } else if (entry.isFile()) {
            const stat = await fsPromises.stat(fullPath);
            return stat.size;
          }
        } catch {}
        return 0;
      })
    );
    return sizes.reduce((sum, s) => sum + s, 0);
  } catch {
    return 0;
  }
}

function getCursorHome() {
  return path.join(getHomeDir(), '.cursor');
}

/**
 * 將本機路徑轉成 Cursor `~/.cursor/projects/<id>` 可能的資料夾名稱
 * 例：D:\PJ\Ai\ai → d-PJ-Ai-ai
 */
function toCursorProjectIdCandidates(absPath) {
  if (!absPath) return [];
  const resolved = path.resolve(absPath);
  const dashed = resolved.replace(/[\\/]/g, '-').replace(/:/g, '');
  const dotted = dashed.replace(/\./g, '-');
  const flipDrive = (value, toUpper) => {
    if (!/^[A-Za-z]-/.test(value)) return value;
    const drive = toUpper ? value[0].toUpperCase() : value[0].toLowerCase();
    return drive + value.slice(1);
  };
  return [...new Set([
    dashed,
    dotted,
    flipDrive(dashed, false),
    flipDrive(dotted, false),
    flipDrive(dashed, true),
    flipDrive(dotted, true),
  ])];
}

function resolveCursorProjectDir() {
  const projectsRoot = path.join(getCursorHome(), 'projects');
  if (!fs.existsSync(projectsRoot)) return null;

  let entries = [];
  try {
    entries = fs.readdirSync(projectsRoot);
  } catch {
    return null;
  }
  const exact = new Set(entries);
  const lowerMap = new Map(entries.map((name) => [name.toLowerCase(), name]));

  const candidates = [];
  if (vscode.workspace.workspaceFile?.fsPath) {
    candidates.push(...toCursorProjectIdCandidates(vscode.workspace.workspaceFile.fsPath));
  }
  for (const folder of vscode.workspace.workspaceFolders || []) {
    candidates.push(...toCursorProjectIdCandidates(folder.uri.fsPath));
  }

  for (const id of candidates) {
    if (exact.has(id)) return path.join(projectsRoot, id);
    const mapped = lowerMap.get(id.toLowerCase());
    if (mapped) return path.join(projectsRoot, mapped);
  }
  return null;
}

function getCursorRulesDir() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder) {
    return path.join(folder, '.cursor', 'rules');
  }
  return path.join(getCursorHome(), 'rules');
}

/**
 * 取得全域目錄路徑對應表（依目前 IDE 使用本環境路徑）
 */
function getGlobalPaths() {
  const homeDir = getHomeDir();
  const host = detectHostIde();

  if (host.id === 'cursor') {
    const cursorHome = getCursorHome();
    const cursorProject = resolveCursorProjectDir();
    const projectsRoot = path.join(cursorHome, 'projects');
    const brain = cursorProject
      ? path.join(cursorProject, 'agent-transcripts')
      : projectsRoot;

    return {
      globalConfig: cursorHome,
      skills: path.join(cursorHome, 'skills'),
      rules: getCursorRulesDir(),
      plugins: path.join(cursorHome, 'plugins'),
      mcpConfig: path.join(cursorHome, 'mcp.json'),
      appData: host.userSettingsDir,
      brain,
      brainScanRoot: projectsRoot,
      userSettingsDir: host.userSettingsDir,
      userSettingsPath: host.userSettingsPath,
      ideExtensions: host.ideExtensionsDir,
    };
  }

  if (isCopilotEnvironment()) {
    const userDir = host.userSettingsDir;
    const copilotHome = path.join(homeDir, '.copilot');
    const workspaceRoot = path.join(userDir, 'workspaceStorage');

    return {
      globalConfig: userDir,
      // Copilot 支援 .agents/skills 作為專案層級 Skills；本工具既有同步機制亦以此為全域集散地
      skills: path.join(homeDir, '.agents', 'skills'),
      // 使用者層級客製化（*.instructions.md / *.prompt.md / *.agent.md），會隨 Settings Sync 漫遊
      rules: path.join(userDir, 'prompts'),
      plugins: path.join(copilotHome, 'installed-plugins'),
      mcpConfig: path.join(userDir, 'mcp.json'),
      appData: path.join(userDir, 'globalStorage'),
      // 對話紀錄分散於各工作區，開啟入口統一導向 workspaceStorage 根
      brain: workspaceRoot,
      brainScanRoot: workspaceRoot,
      userSettingsDir: userDir,
      userSettingsPath: host.userSettingsPath,
      ideExtensions: host.ideExtensionsDir,
    };
  }

  const globalConfigRoot = path.join(homeDir, '.gemini', 'config');
  const globalAppRoot = path.join(homeDir, '.gemini', 'antigravity-ide');

  return {
    globalConfig: globalConfigRoot,
    skills: path.join(globalConfigRoot, 'skills'),
    rules: path.join(globalConfigRoot, 'rules'),
    plugins: path.join(globalConfigRoot, 'plugins'),
    mcpConfig: path.join(globalConfigRoot, 'mcp_config.json'),
    appData: globalAppRoot,
    brain: path.join(globalAppRoot, 'brain'),
    brainScanRoot: path.join(globalAppRoot, 'brain'),
    userSettingsDir: host.userSettingsDir,
    userSettingsPath: host.userSettingsPath,
    ideExtensions: host.ideExtensionsDir,
  };
}

/**
 * 收集對話紀錄資料夾（Cursor：各專案 agent-transcripts；Antigravity：brain）
 * @returns {string[]}
 */
function collectBrainSessionDirs() {
  const paths = getGlobalPaths();
  const host = detectHostIde();
  const sessions = [];

  // Copilot 的對話為「單檔 jsonl 分散於各工作區」，非資料夾結構，
  // 一律改由 copilotChatService 處理，此處不提供項目以免語意混淆。
  if (isCopilotEnvironment()) return sessions;

  if (host.id === 'cursor') {
    const projectsRoot = paths.brainScanRoot;
    if (!projectsRoot || !fs.existsSync(projectsRoot)) return sessions;
    let projects = [];
    try {
      projects = fs.readdirSync(projectsRoot, { withFileTypes: true });
    } catch {
      return sessions;
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const transcriptsDir = path.join(projectsRoot, project.name, 'agent-transcripts');
      if (!fs.existsSync(transcriptsDir)) continue;
      try {
        const entries = fs.readdirSync(transcriptsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            sessions.push(path.join(transcriptsDir, entry.name));
          }
        }
      } catch {}
    }
    return sessions;
  }

  const brainDir = paths.brain;
  if (!brainDir || !fs.existsSync(brainDir)) return sessions;
  try {
    const entries = fs.readdirSync(brainDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        sessions.push(path.join(brainDir, entry.name));
      }
    }
  } catch {}
  return sessions;
}

/**
 * 取得當前 IDE 環境特徵與控制卡片顯示權限
 */
function getEnvironmentInfo() {
  const homeDir = getHomeDir();
  const appData = getAppDataDir();
  const host = detectHostIde();
  const isAntigravityIDE = host.isAntigravityIDE;

  const globalConfigRoot = path.join(homeDir, '.gemini', 'config');
  const globalAppRoot = path.join(homeDir, '.gemini', 'antigravity-ide');
  const antigravityAppData = path.join(appData, 'Antigravity IDE');

  const geminiExists = fs.existsSync(globalConfigRoot) || fs.existsSync(globalAppRoot) || fs.existsSync(antigravityAppData);
  const hasAntigravity = isAntigravityIDE || geminiExists;
  const cursorHomeExists = fs.existsSync(getCursorHome());

  const config = vscode.workspace.getConfiguration('antigravity');
  // 預設為 false：在純 VS Code 等外部 IDE 中預設不顯示 Antigravity 專屬卡片
  const showInVsCode = config.get('showAntigravityModulesInVsCode', false);
  // 預設為 true：VS Code 偵測到 Copilot 時自動顯示對應卡片
  const showCopilotInVsCode = config.get('showCopilotModulesInVsCode', true);
  const isCopilot = isCopilotEnvironment();

  // UI 語系變體（決定採用的 i18n 鍵後綴）與卡片顯示權限決策：
  // 1. Cursor            → cursor（顯示 ~/.cursor 與 agent-transcripts）
  // 2. Antigravity IDE   → antigravity（顯示 ~/.gemini 與 brain）
  // 3. VS Code + 手動開啟設定且有 Antigravity → antigravity（尊重使用者明確設定）
  // 4. VS Code + Copilot → copilot（顯示 Copilot 對應路徑與 chatSessions 對話紀錄）
  // 5. 其餘               → 隱藏兩張主機相依卡片
  let uiFlavor = 'antigravity';
  let showHostModules = false;

  if (host.isCursor) {
    uiFlavor = 'cursor';
    showHostModules = true;
  } else if (isAntigravityIDE) {
    uiFlavor = 'antigravity';
    showHostModules = true;
  } else if (Boolean(showInVsCode) && hasAntigravity) {
    uiFlavor = 'antigravity';
    showHostModules = true;
  } else if (isCopilot && showCopilotInVsCode) {
    uiFlavor = 'copilot';
    showHostModules = true;
  }

  // 實際目標路徑摘要（前端用於按鈕 tooltip，讓使用者點擊前就知道會開啟何處）
  const paths = getGlobalPaths();

  return {
    appName: host.appName,
    hostId: host.id,
    hostDisplayName: host.displayName,
    isAntigravityIDE,
    isCursor: host.isCursor,
    isCopilot,
    hasAntigravity,
    hasCursor: host.isCursor || cursorHomeExists,
    uiFlavor,
    hostMode: uiFlavor,
    showHostModules,
    showAntigravityCards: showHostModules,
    paths: {
      globalConfig: paths.globalConfig,
      mcpConfig: paths.mcpConfig,
      skills: paths.skills,
      rules: paths.rules,
      plugins: paths.plugins,
      appData: paths.appData,
      brain: paths.brain,
    },
  };
}

/**
 * 以一般文字編輯器開啟目前 IDE 的 User settings.json。
 *
 * 不可改回 workbench.action.openSettingsJson：Cursor 的 Settings UI
 * 會走 serializeReplyOK IPC；從 Webview 觸發時，renderer 常因大型物件圖
 * 與 Method not found: toJSON 進入忙等，整個視窗卡住甚至當機。
 * 直接開實體檔與 mcp.json 同一條路徑，避開 Settings UI。
 */
async function openUserSettingsJson() {
  const paths = getGlobalPaths();
  ensureDirectory(paths.userSettingsDir);
  if (!fs.existsSync(paths.userSettingsPath)) {
    fs.writeFileSync(paths.userSettingsPath, '{}\n', 'utf-8');
  }
  const uri = vscode.Uri.file(paths.userSettingsPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
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
      await openUserSettingsJson();
    } else if (target === 'settingsFolder') {
      await openFolderInside(paths.userSettingsDir);
    } else if (target === 'agentsSkills') {
      const skillDir = path.join(getHomeDir(), '.agents', 'skills');
      await openFolderInside(skillDir);
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
  bindExtensionContext,
  detectHostIde,
  isCopilotEnvironment,
  resetCopilotEnvironmentCache,
  collectBrainSessionDirs,
  ensureDirectory,
  safeJsonParse,
  openFolderInside,
  getCanonicalPath,
  getDirectorySizeBytesAsync,
  getGlobalPaths,
  getEnvironmentInfo,
  openUserSettingsJson,
  handleOpenTarget,
  getExplorerSettings,
  toggleExplorerSetting,
};

