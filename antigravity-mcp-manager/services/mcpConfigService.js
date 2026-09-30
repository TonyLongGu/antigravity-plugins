// ==============================================================================
// 檔案名稱：services/mcpConfigService.js
// 功能說明：MCP 配置檔與獨立備註管理服務
// 宿主：
//   Antigravity — ~/.gemini/config/mcp_config.json（mcpServers.disabled 可寫開關）
//   Cursor — ~/.cursor/mcp.json（僅檢視／探測／備註；開關請用 Customize）
//   VS Code — <User>/mcp.json + 工作區 .vscode/mcp.json
//             （僅檢視／探測／備註；開關存於 state.vscdb 的 mcp.enablement，請用 VS Code 原生 UI）
// ==============================================================================

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = { env: { appName: '' }, workspace: undefined };
}
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const CursorEnablementService = require('./cursorEnablementService');
const VscodeEnablementService = require('./vscodeEnablementService');
const ClineMcpService = require('./clineMcpService');
const I18n = require('./i18nService');

// 訊息一律取自 locales/*.json，確保與面板語言一致
// （勿寫死字串：寫死會導致切換語系時原生 UI 與面板語言不一致）

class McpConfigService {
  static init(context) {
    CursorEnablementService.init(context);
    VscodeEnablementService.init(context);
    ClineMcpService.init(context);
  }

  static get isClineInstalled() {
    return ClineMcpService.isInstalled();
  }

  static get clineConfigPath() {
    return ClineMcpService.getConfigPath();
  }

  static get appName() {
    return vscode?.env?.appName || '';
  }

  /**
   * 當前宿主種類：antigravity | cursor | vscode | unsupported
   * 非 Cursor / Antigravity 的 VS Code 相容宿主一律視為 vscode
   */
  static get hostKind() {
    if (/antigravity/i.test(this.appName)) return 'antigravity';
    if (/cursor/i.test(this.appName)) return 'cursor';
    if (this.appName) return 'vscode';
    return 'unsupported';
  }

  static get isUnsupportedHost() {
    return this.hostKind === 'unsupported';
  }

  static get isCursor() {
    return this.hostKind === 'cursor';
  }

  static get isVsCode() {
    return this.hostKind === 'vscode';
  }

  /**
   * 開關是否唯讀
   * Antigravity 可寫（mcp_config.json 支援 disabled 欄位）；
   * Cursor 與 VS Code 皆為純檢視——兩者的開關分別存於各自的內部狀態，
   * 且 VS Code 端寫入後必須重載視窗才生效，故此面板不提供寫入。
   */
  static get isViewOnly() {
    const kind = this.hostKind;
    return kind === 'cursor' || kind === 'vscode';
  }

  /** 唯讀時提示訊息（依宿主對應語系鍵） */
  static get viewOnlyMessage() {
    return I18n.t(this.hostKind === 'vscode' ? 'err_vscode_view_only' : 'err_cursor_view_only');
  }

  /** 設定檔中伺服器清單的鍵名（VS Code 使用 servers，其餘使用 mcpServers） */
  static get serversKey() {
    return this.hostKind === 'vscode' ? 'servers' : 'mcpServers';
  }

  /**
   * 開關狀態來源的變更簽章（僅 VS Code 有外部來源）
   * 供 Extension Host 以低成本輪詢偵測「使用者於原生 UI 切換開關」
   */
  static enablementSignature() {
    if (this.hostKind !== 'vscode') return '';
    try {
      return VscodeEnablementService.dbSignature();
    } catch {
      return '';
    }
  }

  /**
   * 狀態列顯示範圍（單一真相來源：VS Code 設定 antigravity.mcp.displayMode）
   * 舊版另有 globalState('antigravity.mcp.displaySource') 作為第二份真相，
   * 造成「設定 UI 改了設定、懸停視窗卻顯示舊值」的不一致，故一律以本 getter 為準。
   */
  static get displayMode() {
    try {
      const mode = vscode?.workspace?.getConfiguration('antigravity.mcp')?.get('displayMode');
      if (mode === 'antigravity' || mode === 'cline' || mode === 'both') return mode;
    } catch (_) {}
    return 'both';
  }

  /** 寫入狀態列顯示範圍（全專案唯一的寫入點） */
  static async setDisplayMode(mode) {
    if (!['antigravity', 'cline', 'both'].includes(mode)) return false;
    await vscode.workspace
      .getConfiguration('antigravity.mcp')
      .update('displayMode', mode, vscode.ConfigurationTarget.Global);
    return true;
  }

  /**
   * 一次性遷移：舊版把顯示範圍存在 globalState。
   * 若使用者尚未在設定中明確指定，則沿用舊值寫回設定，避免升級後被重設為預設；
   * 遷移後即清除舊鍵，確保之後只有一份真相。
   */
  static async migrateLegacyDisplayMode(context) {
    try {
      const legacy = context?.globalState?.get('antigravity.mcp.displaySource');
      if (!legacy) return;
      const cfg = vscode.workspace.getConfiguration('antigravity.mcp');
      const inspect = typeof cfg.inspect === 'function' ? cfg.inspect('displayMode') : null;
      const explicitlySet = !!(inspect && (inspect.globalValue !== undefined || inspect.workspaceValue !== undefined));
      if (!explicitlySet && ['antigravity', 'cline', 'both'].includes(legacy)) {
        await this.setDisplayMode(legacy);
      }
      await context.globalState.update('antigravity.mcp.displaySource', undefined);
    } catch (_) {}
  }

  static get envName() {
    if (this.hostKind === 'antigravity') return 'Antigravity IDE';
    if (this.hostKind === 'cursor') return 'Cursor';
    if (this.hostKind === 'vscode') return 'VS Code Copilot';
    return I18n.t('host_unsupported');
  }

  /**
   * 此 IDE 原生 MCP 的顯示名稱。
   * 內部來源鍵仍是 antigravity（設定檔與 globalState 的既有值），
   * 畫面上必須依宿主顯示，避免在 Cursor / VS Code 寫成 Antigravity。
   */
  static get nativeSourceName() {
    if (this.hostKind === 'cursor') return 'Cursor';
    if (this.hostKind === 'vscode') return 'VS Code';
    return 'Antigravity';
  }

  /** 狀態列與 Cline 並排時的短標。Antigravity 維持 AG，避免狀態列過長。 */
  static get nativeSourceShort() {
    if (this.hostKind === 'cursor') return 'Cursor';
    if (this.hostKind === 'vscode') return 'VS Code';
    return 'AG';
  }

  static get globalConfigPath() {
    if (this.hostKind === 'cursor') {
      return path.join(os.homedir(), '.cursor', 'mcp.json');
    }
    if (this.hostKind === 'vscode') {
      return path.join(VscodeEnablementService.profileDir, 'mcp.json');
    }
    return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  }

  static get notesFilePath() {
    if (this.hostKind === 'cursor') {
      return path.join(os.homedir(), '.cursor', 'mcp_notes.json');
    }
    if (this.hostKind === 'vscode') {
      return path.join(VscodeEnablementService.profileDir, 'mcp_notes.json');
    }
    return path.join(os.homedir(), '.gemini', 'config', 'antigravity_mcp_notes.json');
  }

  static assertSupportedHost() {
    if (this.isUnsupportedHost) {
      throw new Error(I18n.t('err_unsupported_host'));
    }
  }

  static assertWritableToggles() {
    this.assertSupportedHost();
    if (this.isViewOnly) {
      throw new Error(this.viewOnlyMessage);
    }
  }

  /**
   * 讀取 JSON。
   * Windows 上 PowerShell 5.1 / 部分編輯器會寫入 UTF-8 BOM，Node 的 JSON.parse 會直接失敗。
   * 主設定檔解析失敗時應拋出（throwOnError），不可回傳空物件，否則面板會誤顯示「沒有伺服器」，
   * 後續寫入還可能把原檔覆蓋成空清單。
   */
  static async safeReadJson(filePath, fallback = {}, options = {}) {
    let content;
    try {
      content = await fsPromises.readFile(filePath, 'utf-8');
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      console.warn(`讀取 JSON 失敗 [${filePath}]:`, e.message);
      if (options.throwOnError) throw e;
      return fallback;
    }

    try {
      const text = typeof content === 'string' ? content.replace(/^\uFEFF/, '') : content;
      return JSON.parse(text);
    } catch (e) {
      console.warn(`解析 JSON 失敗 [${filePath}]:`, e.message);
      if (options.throwOnError) {
        throw new Error(I18n.t('err_json_parse', { path: filePath, msg: e.message }));
      }
      return fallback;
    }
  }

  static async safeSaveJson(filePath, dataObj) {
    const dir = path.dirname(filePath);
    try {
      await fsPromises.mkdir(dir, { recursive: true });
    } catch (e) {}

    const jsonContent = JSON.stringify(dataObj, null, 2) + '\n';
    JSON.parse(jsonContent);

    try {
      await fsPromises.copyFile(filePath, `${filePath}.bak`);
    } catch (e) {}

    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      await fsPromises.writeFile(tempPath, jsonContent, 'utf-8');
      try {
        await fsPromises.rename(tempPath, filePath);
      } catch (err) {
        await fsPromises.copyFile(tempPath, filePath);
      }
      return true;
    } finally {
      await fsPromises.unlink(tempPath).catch(() => {});
    }
  }

  static async ensureConfigFile() {
    this.assertSupportedHost();
    const configPath = this.globalConfigPath;
    try {
      await fsPromises.access(configPath);
    } catch {
      // VS Code 的 mcp.json 使用 servers 鍵並支援 inputs；其餘宿主沿用 mcpServers
      const empty = this.hostKind === 'vscode' ? { servers: {}, inputs: [] } : { mcpServers: {} };
      await this.safeSaveJson(configPath, empty);
    }
  }

  static async getNotes() {
    return await this.safeReadJson(this.notesFilePath, {});
  }

  static async saveNotes(notesObj) {
    await this.safeSaveJson(this.notesFilePath, notesObj);
    return notesObj;
  }

  static calculateStats(servers = {}) {
    const serverKeys = Object.keys(servers);
    let enabled = 0;
    let disabled = 0;

    for (const key of serverKeys) {
      if (servers[key].disabled === true) {
        disabled++;
      } else {
        enabled++;
      }
    }

    return { total: serverKeys.length, enabled, disabled };
  }

  /**
   * 讀取 Cline 延伸模組的 MCP 摘要（純檢視）
   * Antigravity / Cursor / VS Code 三個宿主共用：狀態列、懸停視窗與快捷選單依此並列顯示 Cline 統計。
   * Cline 一律唯讀（開關由 Cline 自身的 UI 管理），故此處只讀不寫。
   */
  static async readClineSummary() {
    const isClineInstalled = ClineMcpService.isInstalled();
    if (!isClineInstalled) {
      return {
        isClineInstalled: false,
        clineServers: {},
        clineStats: { total: 0, enabled: 0, disabled: 0 },
        clineConfigPath: '',
        clineEnabledNames: [],
      };
    }

    const clineData = await ClineMcpService.getServers();
    const clineServers = clineData.servers || {};
    return {
      isClineInstalled: true,
      clineServers,
      clineStats: clineData.stats || { total: 0, enabled: 0, disabled: 0 },
      clineConfigPath: clineData.path || '',
      clineEnabledNames: Object.keys(clineServers).filter((name) => clineServers[name].disabled !== true),
    };
  }

  static emptyUnsupportedData() {
    return {
      path: '',
      notesPath: '',
      hostKind: 'unsupported',
      isVsCode: false,
      isCursor: false,
      viewOnly: false,
      envName: this.envName,
      unsupported: true,
      unsupportedMessage: I18n.t('err_unsupported_host'),
      config: { mcpServers: {} },
      stats: { total: 0, enabled: 0, disabled: 0, viewOnly: false },
    };
  }

  static async getGlobalData(displaySource = 'both') {
    const hostKind = this.hostKind;
    if (hostKind === 'unsupported') {
      return this.emptyUnsupportedData();
    }
    if (hostKind === 'vscode') {
      return await this.getVscodeData(displaySource);
    }

    // Cline 摘要（純檢視）：與 VS Code 分支共用同一份讀取邏輯，避免兩處各寫一份而再度不同步
    const { isClineInstalled, clineServers, clineStats, clineConfigPath, clineEnabledNames } =
      await this.readClineSummary();
    const effectiveDisplaySource = isClineInstalled ? displaySource : 'antigravity';

    const viewOnly = this.isViewOnly;
    const configPath = this.globalConfigPath;
    const notesPath = this.notesFilePath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} }, { throwOnError: true });
    const notes = await this.getNotes();
    const servers = rawConfig[this.serversKey] || {};
    const disabledNames = viewOnly ? await CursorEnablementService.getDisabledServerNames() : null;
    const agServers = {};

    for (const [name, server] of Object.entries(servers)) {
      const note = notes[name] || {};
      const desc = note.description || server.description || '';
      const disabled = viewOnly
        ? disabledNames.has(name)
        : server.disabled === true;
      agServers[name] = {
        ...server,
        name,
        rawName: name,
        sourceType: 'antigravity',
        serverUrl: server.serverUrl || server.url,
        description: desc,
        disabled,
        effectiveDisabled: disabled,
        source: 'user',
        scope: 'global',
      };
    }
    const agStats = this.calculateStats(agServers);

    const combinedStats = {
      total: agStats.total + clineStats.total,
      enabled: agStats.enabled + clineStats.enabled,
      disabled: agStats.disabled + clineStats.disabled,
    };

    // 側邊欄面板遵循規範：Cline 不需要側邊開關 MCP 工具，側邊欄專注管理 Antigravity
    const displayServers = agServers;
    const displayStats = agStats;

    const agEnabledNames = Object.keys(agServers).filter((k) => agServers[k].disabled !== true);

    return {
      path: configPath,
      notesPath,
      hostKind,
      isVsCode: false,
      isCursor: hostKind === 'cursor',
      viewOnly,
      envName: this.envName,
      isClineInstalled,
      clineConfigPath,
      displaySource: effectiveDisplaySource,
      agStats,
      clineStats,
      combinedStats,
      agEnabledNames,
      clineEnabledNames,
      clineServers,
      config: {
        ...rawConfig,
        mcpServers: displayServers,
      },
      stats: displayStats,
    };
  }

  // ── VS Code（Copilot）───────────────────────────────────────────────────

  /**
   * 讀取單一工作區資料夾的 MCP 設定檔，回傳可用的伺服器來源清單
   * VS Code 支援兩種位置：
   *   .vscode/mcp.json → { servers: {...} }（另含 inputs）
   *   .mcp.json（根）  → { mcpServers: {...} } 或裸格式 { <name>: {...} }（Claude 風格，不支援 inputs）
   * 格式依 VS Code 原始碼 parseWorkspaceRootMcpConfiguration()：
   *   有 mcpServers 鍵 → 取該鍵；否則整個物件即為伺服器對照表。
   *
   * @returns {Promise<Array<{folderIndex:number, folderName:string, path:string, source:'workspace'|'workspaceRoot', servers:object}>>}
   */
  static async readWorkspaceMcpServers() {
    if (this.hostKind !== 'vscode') return [];
    const folders = vscode?.workspace?.workspaceFolders || [];
    const result = [];

    for (const folder of folders) {
      const folderIndex = typeof folder.index === 'number' ? folder.index : 0;
      const folderName = folder.name || '';

      // 1) .vscode/mcp.json
      const vsPath = path.join(folder.uri.fsPath, '.vscode', 'mcp.json');
      if (fs.existsSync(vsPath)) {
        const raw = await this.safeReadJson(vsPath, { servers: {} });
        const servers = raw.servers || {};
        if (Object.keys(servers).length > 0) {
          result.push({ folderIndex, folderName, path: vsPath, source: 'workspace', servers });
        }
      }

      // 2) 工作區根 .mcp.json（Claude 風格；支援包裝與裸格式）
      const rootPath = path.join(folder.uri.fsPath, '.mcp.json');
      if (fs.existsSync(rootPath)) {
        const raw = await this.safeReadJson(rootPath, {});
        const container = Object.prototype.hasOwnProperty.call(raw, 'mcpServers') ? raw.mcpServers : raw;
        const servers = {};
        if (container && typeof container === 'object' && !Array.isArray(container)) {
          for (const [name, cfg] of Object.entries(container)) {
            // 只收看起來像伺服器設定的項目（裸格式時頂層可能混入其他鍵）
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
            if (!cfg.command && !cfg.url && !cfg.serverUrl && !cfg.type) continue;
            servers[name] = cfg;
          }
        }
        if (Object.keys(servers).length > 0) {
          result.push({ folderIndex, folderName, path: rootPath, source: 'workspaceRoot', servers });
        }
      }
    }
    return result;
  }

  /** 將 VS Code 伺服器正規化為儀表板統一格式 */
  static normalizeVscodeServer(name, server, source, notes, enablement, workspaceFolderIndex) {
    const note = notes[name] || {};
    const state = VscodeEnablementService.resolve(enablement, name, source, workspaceFolderIndex);

    // 主開關 = 實際生效狀態（與 VS Code 一致），使用者所見即「這個工作區現在能不能用」
    const effectiveEnabled = state.effectiveEnabled;

    return {
      ...server,
      name,
      id: state.id,
      serverUrl: server.serverUrl || server.url,
      description: note.description || '',
      disabled: !effectiveEnabled,
      effectiveDisabled: !effectiveEnabled,
      profileEnabled: state.profileEnabled,
      profileDisabled: !state.profileEnabled,
      hasWorkspaceOverride: state.hasWorkspaceOverride,
      workspaceOverride: state.workspaceOverride,
      workspaceFolderIndex,
      source,
      scope: 'global',
    };
  }

  static async getVscodeData(displaySource = 'both') {
    const configPath = this.globalConfigPath;
    const notesPath = this.notesFilePath;
    const rawConfig = await this.safeReadJson(configPath, { servers: {} }, { throwOnError: true });
    const notes = await this.getNotes();
    const enablement = await VscodeEnablementService.readState();
    const normalizedServers = {};
    let createdConfig = false;

    const userServers = rawConfig[this.serversKey] || {};
    for (const [name, server] of Object.entries(userServers)) {
      normalizedServers[name] = this.normalizeVscodeServer(name, server, 'user', notes, enablement, 0);
    }

    const workspaceEntries = await this.readWorkspaceMcpServers();
    const workspacePaths = [];
    for (const entry of workspaceEntries) {
      workspacePaths.push(entry.path);
      for (const [name, server] of Object.entries(entry.servers)) {
        // 同名時的優先序：使用者 mcp.json > .vscode/mcp.json > 根 .mcp.json
        // （與 VS Code 一致：同名以較高優先來源為準）
        if (normalizedServers[name]) continue;
        normalizedServers[name] = this.normalizeVscodeServer(
          name,
          server,
          entry.source,
          notes,
          enablement,
          entry.folderIndex
        );
      }
    }

    if (!fs.existsSync(configPath)) createdConfig = true;

    // 本 IDE（VS Code）自身的統計；與 Antigravity 分支同名同義，供狀態列與懸停視窗共用
    const agStats = this.calculateStats(normalizedServers);
    // Cline 僅檢視：與 Antigravity / Cursor 一致地並列顯示，開關仍由 Cline 自身 UI 管理
    const { isClineInstalled, clineServers, clineStats, clineConfigPath, clineEnabledNames } =
      await this.readClineSummary();

    return {
      path: configPath,
      notesPath,
      workspacePaths,
      stateDbPath: enablement.profileDb,
      workspaceDbPath: enablement.workspaceDb,
      stateReadable: !!(enablement.profile || enablement.workspace),
      // true = 本次讀取失敗、沿用上次成功值（避免狀態誤導）
      stateStale: enablement.stale === true,
      hostKind: 'vscode',
      isVsCode: true,
      isCursor: false,
      viewOnly: this.isViewOnly,
      envName: this.envName,
      configMissing: createdConfig,
      isClineInstalled,
      clineConfigPath,
      displaySource: isClineInstalled ? displaySource : 'antigravity',
      agStats,
      clineStats,
      combinedStats: {
        total: agStats.total + clineStats.total,
        enabled: agStats.enabled + clineStats.enabled,
        disabled: agStats.disabled + clineStats.disabled,
      },
      agEnabledNames: Object.keys(normalizedServers).filter((name) => normalizedServers[name].disabled !== true),
      clineEnabledNames,
      clineServers,
      config: {
        ...rawConfig,
        mcpServers: normalizedServers,
      },
      stats: agStats,
    };
  }

  /**
   * 切換本 IDE 的單一伺服器開關
   * Cline 不在此服務的寫入範圍：本套件對 Cline 恆為純檢視（開關由 Cline 自身 MCP 面板管理），
   * 故這裡不提供 sourceType='cline' 的直通與自動轉發，避免唯讀宿主（Cursor / VS Code）
   * 或任何未來入口意外改寫 Cline 的 cline_mcp_settings.json。
   */
  static async toggleServer(serverName, disabled, sourceType = 'antigravity') {
    if (sourceType === 'cline') {
      throw new Error(I18n.t('err_cline_view_only'));
    }

    this.assertWritableToggles();

    const configPath = this.globalConfigPath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} }, { throwOnError: true });
    const servers = rawConfig[this.serversKey] || {};
    if (!servers[serverName]) {
      throw new Error(I18n.t('err_server_not_found', { name: serverName }));
    }

    if (disabled) {
      servers[serverName].disabled = true;
    } else {
      delete servers[serverName].disabled;
    }

    await this.safeSaveJson(configPath, rawConfig);
    return { changes: [{ name: serverName, disabled: !!disabled, sourceType: 'antigravity' }] };
  }

  /**
   * 更新伺服器用途說明
   * 說明一律寫入本套件自有的 sidecar 檔（不污染官方 schema 的 mcp.json）。
   * Cline 為純檢視，不提供寫入；其既有 sidecar 內容仍會被讀取並顯示。
   */
  static async updateServerDescription(serverName, description) {
    this.assertSupportedHost();
    const notes = await this.getNotes();
    const trimmed = typeof description === 'string' ? description.trim() : '';

    if (trimmed) {
      notes[serverName] = { ...(notes[serverName] || {}), description: trimmed };
    } else if (notes[serverName]) {
      delete notes[serverName].description;
      if (Object.keys(notes[serverName]).length === 0) {
        delete notes[serverName];
      }
    }

    await this.saveNotes(notes);

    // 僅 Antigravity 的 mcp_config.json 支援自訂 description 欄位；
    // Cursor 與 VS Code 的 mcp.json 皆有官方 schema，備註只寫 sidecar，避免汙染設定檔
    if (this.hostKind !== 'antigravity') return;

    try {
      const configPath = this.globalConfigPath;
      const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} }, { throwOnError: true });
      const servers = rawConfig[this.serversKey];
      if (servers && servers[serverName]) {
        if (trimmed) {
          servers[serverName].description = trimmed;
        } else {
          delete servers[serverName].description;
        }
        await this.safeSaveJson(configPath, rawConfig);
      }
    } catch (err) {
      console.warn('同步更新 MCP 設定檔備註失敗:', err.message);
    }
  }

  /**
   * 批次切換本 IDE 的伺服器開關
   * 顯示範圍（本 IDE / Cline / 兩者）只影響「顯示」，不影響寫入範圍：
   * Cline 恆為純檢視，故批次一律只作用於本 IDE 的設定檔，並受唯讀守門約束。
   */
  static async batchToggle(action) {
    const isEnable = action === 'enableAll' || action === 'enable_all';
    const isDisable = action === 'disableAll' || action === 'disable_all';
    const isInvert = action === 'invert';

    // 唯讀宿主（Cursor / VS Code）不寫入任何設定檔，回傳空變更清單而非拋錯
    if (this.isViewOnly) return { changes: [] };

    const configPath = this.globalConfigPath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} }, { throwOnError: true });
    const servers = rawConfig[this.serversKey] || {};

    for (const key of Object.keys(servers)) {
      if (isEnable) {
        delete servers[key].disabled;
      } else if (isDisable) {
        servers[key].disabled = true;
      } else if (isInvert) {
        if (servers[key].disabled === true) {
          delete servers[key].disabled;
        } else {
          servers[key].disabled = true;
        }
      }
    }

    await this.safeSaveJson(configPath, rawConfig);
    return {
      changes: Object.keys(servers).map((name) => ({
        name,
        disabled: isEnable ? false : isDisable ? true : servers[name].disabled === true,
        sourceType: 'antigravity',
      })),
    };
  }
}

module.exports = McpConfigService;
