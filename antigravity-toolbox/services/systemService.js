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

/**
 * 控制中心可切換的資料來源類別（對應 antigravity.uiFlavor / 面板頂部類別切換鈕）
 *
 * cline 是「外掛」而非 IDE：它寄生在 VS Code / Cursor / Antigravity 內，
 * 因此只能手動指定，auto 永遠不會判定成 cline（見 resolveFlavor）。
 */
const FLAVORS = ['antigravity', 'cursor', 'copilot', 'cline'];

/**
 * 讀取使用者手動指定的資料來源類別。
 * @returns {'auto'|'antigravity'|'cursor'|'copilot'|'cline'} auto 代表依宿主自動判定
 */
function getFlavorOverride() {
  try {
    const value = vscode.workspace.getConfiguration('antigravity').get('uiFlavor', 'auto');
    if (value === 'auto' || FLAVORS.includes(value)) return value;
    return 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * 解析目前應採用的資料來源類別。
 *
 * 手動指定（非 auto）時一律以指定值為準，讓同一套外掛在各 IDE 顯示一致；
 * auto 時依宿主判定：Cursor → cursor、VS Code 家族 + Copilot → copilot、其餘 → antigravity。
 * （cline 為寄生在 IDE 內的外掛，沒有自己的宿主，故 auto 不會回傳 cline。）
 * @returns {'antigravity'|'cursor'|'copilot'|'cline'}
 */
function resolveFlavor() {
  const override = getFlavorOverride();
  if (override !== 'auto') return override;
  if (detectHostIde().id === 'cursor') return 'cursor';
  if (isCopilotEnvironment()) return 'copilot';
  return 'antigravity';
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

/** Cline 家目錄：全域規則／技能／外掛／工作流與資料目錄都掛在這裡（`~/.cline`） */
function getClineHome() {
  return path.join(getHomeDir(), '.cline');
}

/**
 * 依序回傳第一個存在的候選目錄；全都不存在時回傳 fallback。
 *
 * Cline 的規則／外掛同時支援 `~/.cline/<x>`（官方主路徑）與 `~/Documents/Cline/<X>`
 * （相容用的額外搜尋路徑，見官方 Config 文件），使用者通常只有其中一種，
 * 因此優先指向實際存在的那一個，避免點開後看到空目錄。
 */
function firstExistingDir(candidates, fallback) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return fallback;
}

/**
 * Cline 對話目錄。
 *
 * 新版：`~/.cline/data/sessions/<sessionId>/`（IDE／CLI／SDK 共用，一個 session 一資料夾）
 * 舊版：`<IDE User>/globalStorage/saoudrizwan.claude-dev/tasks/<taskId>/`
 * 兩者都是「一個資料夾＝一筆對話」，因此可直接沿用 Brain 的資料夾統計與清理邏輯；
 * 新版存在時優先採用，避免兩種格式並存時重複計算同一批對話。
 * @returns {string}
 */
function resolveClineSessionsDir() {
  const modern = path.join(getClineHome(), 'data', 'sessions');
  if (fs.existsSync(modern)) return modern;
  const legacy = path.join(
    detectHostIde().userSettingsDir,
    'globalStorage',
    'saoudrizwan.claude-dev',
    'tasks'
  );
  if (fs.existsSync(legacy)) return legacy;
  return modern;
}

/**
 * Cline MCP 設定檔路徑（新版位於 `~/.cline/data/settings`，舊版位於 globalStorage）。
 * 兩者皆不存在時回傳新版路徑，供 handleOpenTarget 建立預設內容。
 * @returns {string}
 */
function resolveClineMcpConfigPath() {
  const modern = path.join(getClineHome(), 'data', 'settings', 'cline_mcp_settings.json');
  if (fs.existsSync(modern)) return modern;
  const legacy = path.join(
    detectHostIde().userSettingsDir,
    'globalStorage',
    'saoudrizwan.claude-dev',
    'settings',
    'cline_mcp_settings.json'
  );
  if (fs.existsSync(legacy)) return legacy;
  return modern;
}

/**
 * 取得全域目錄路徑對應表（依指定或解析出的資料來源類別）
 * @param {'antigravity'|'cursor'|'copilot'|'cline'} [flavor] 省略時依 antigravity.uiFlavor / 宿主自動判定
 */
function getGlobalPaths(flavor = resolveFlavor()) {
  const homeDir = getHomeDir();
  const host = detectHostIde();

  if (flavor === 'cursor') {
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

  if (flavor === 'copilot') {
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

  if (flavor === 'cline') {
    const clineHome = getClineHome();
    const clineDocs = path.join(homeDir, 'Documents', 'Cline');
    const clineSkills = path.join(clineHome, 'skills');

    return {
      globalConfig: clineHome,
      // 官方全域技能目錄為 ~/.cline/skills；Cline 另外也會讀 ~/.agents/skills（本工具的同步集散地）
      skills: firstExistingDir([clineSkills, path.join(homeDir, '.agents', 'skills')], clineSkills),
      rules: firstExistingDir([path.join(clineHome, 'rules'), path.join(clineDocs, 'Rules')], path.join(clineHome, 'rules')),
      plugins: firstExistingDir([path.join(clineHome, 'plugins'), path.join(clineDocs, 'Plugins')], path.join(clineHome, 'plugins')),
      mcpConfig: resolveClineMcpConfigPath(),
      appData: path.join(clineHome, 'data'),
      brain: resolveClineSessionsDir(),
      brainScanRoot: resolveClineSessionsDir(),
      userSettingsDir: host.userSettingsDir,
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
 * 收集對話紀錄資料夾
 * （Antigravity：brain；Cursor：各專案 agent-transcripts；Cline：data/sessions）
 * @param {'antigravity'|'cursor'|'copilot'|'cline'} [flavor] 省略時依 antigravity.uiFlavor / 宿主自動判定
 * @returns {string[]}
 */
function collectBrainSessionDirs(flavor = resolveFlavor()) {
  const paths = getGlobalPaths(flavor);
  const sessions = [];

  // Copilot 的對話為「單檔 jsonl 分散於各工作區」，非資料夾結構，
  // 一律改由 copilotChatService 處理，此處不提供項目以免語意混淆。
  if (flavor === 'copilot') return sessions;

  if (flavor === 'cursor') {
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
  // Cline 是外掛而非 IDE：只要本機有 ~/.cline（IDE／CLI／SDK 共用）或其對話目錄即視為可用
  const hasCline = fs.existsSync(getClineHome()) || fs.existsSync(resolveClineSessionsDir());

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
  // （cline 永遠不會是 auto 的結果：它是寄生在 IDE 內的外掛，只能由使用者手動指定）
  let autoFlavor = 'antigravity';
  let autoShowHostModules = false;

  if (host.isCursor) {
    autoFlavor = 'cursor';
    autoShowHostModules = true;
  } else if (isAntigravityIDE) {
    autoFlavor = 'antigravity';
    autoShowHostModules = true;
  } else if (Boolean(showInVsCode) && hasAntigravity) {
    autoFlavor = 'antigravity';
    autoShowHostModules = true;
  } else if (isCopilot && showCopilotInVsCode) {
    autoFlavor = 'copilot';
    autoShowHostModules = true;
  }

  // 面板頂部「類別切換鈕」(antigravity.uiFlavor)：手動指定後即不再受宿主限制，
  // 讓同一份外掛無論裝在哪個 IDE，都能切換檢視其他 IDE 的資料。
  const flavorOverride = getFlavorOverride();
  const uiFlavor = flavorOverride === 'auto' ? autoFlavor : flavorOverride;
  const showHostModules = flavorOverride === 'auto' ? autoShowHostModules : true;

  // 實際目標路徑摘要（前端用於按鈕 tooltip，讓使用者點擊前就知道會開啟何處）
  const paths = getGlobalPaths(uiFlavor);

  return {
    appName: host.appName,
    hostId: host.id,
    hostDisplayName: host.displayName,
    isAntigravityIDE,
    isCursor: host.isCursor,
    isCopilot,
    hasAntigravity,
    hasCursor: host.isCursor || cursorHomeExists,
    hasCline,
    uiFlavor,
    autoFlavor,
    flavorOverride,
    hostMode: uiFlavor,
    showHostModules,
    showAntigravityCards: showHostModules,
    // 各類別在本機是否具備可用資料（前端據此隱藏切換鈕，避免切到空資料）
    flavors: {
      antigravity: Boolean(hasAntigravity),
      cursor: Boolean(host.isCursor || cursorHomeExists),
      copilot: Boolean(isCopilot),
      cline: Boolean(hasCline),
    },
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
      // 用 mcpConfig 的所在目錄（各類別都等於 globalConfig，Cline 則在其 data/settings 之下）
      ensureDirectory(path.dirname(paths.mcpConfig));
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
  FLAVORS,
  getFlavorOverride,
  resolveFlavor,
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

