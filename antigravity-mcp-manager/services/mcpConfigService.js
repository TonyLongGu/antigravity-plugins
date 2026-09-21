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
const I18n = require('./i18nService');

// 訊息一律取自 locales/*.json，確保與面板語言一致
// （勿寫死字串：寫死會導致切換語系時原生 UI 與面板語言不一致）

class McpConfigService {
  static init(context) {
    CursorEnablementService.init(context);
    VscodeEnablementService.init(context);
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

  static get envName() {
    if (this.hostKind === 'antigravity') return 'Antigravity IDE';
    if (this.hostKind === 'cursor') return 'Cursor';
    if (this.hostKind === 'vscode') return 'VS Code Copilot';
    return I18n.t('host_unsupported');
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

  static async safeReadJson(filePath, fallback = {}) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      console.warn(`解析 JSON 失敗或檔案不存在 [${filePath}]:`, e.message);
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
      unsupportedMessage: UNSUPPORTED_HOST_MESSAGE,
      config: { mcpServers: {} },
      stats: { total: 0, enabled: 0, disabled: 0, viewOnly: false },
    };
  }

  static async getGlobalData() {
    const hostKind = this.hostKind;
    if (hostKind === 'unsupported') {
      return this.emptyUnsupportedData();
    }
    if (hostKind === 'vscode') {
      return await this.getVscodeData();
    }

    const viewOnly = this.isViewOnly;
    const configPath = this.globalConfigPath;
    const notesPath = this.notesFilePath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
    const notes = await this.getNotes();
    const servers = rawConfig[this.serversKey] || {};
    const disabledNames = viewOnly ? await CursorEnablementService.getDisabledServerNames() : null;
    const normalizedServers = {};

    for (const [name, server] of Object.entries(servers)) {
      const note = notes[name] || {};
      const desc = note.description || server.description || '';
      const disabled = viewOnly
        ? disabledNames.has(name)
        : server.disabled === true;
      normalizedServers[name] = {
        ...server,
        name,
        serverUrl: server.serverUrl || server.url,
        description: desc,
        disabled,
        effectiveDisabled: disabled,
        source: 'user',
        scope: 'global',
      };
    }

    return {
      path: configPath,
      notesPath,
      hostKind,
      isVsCode: false,
      isCursor: hostKind === 'cursor',
      viewOnly,
      envName: this.envName,
      config: {
        ...rawConfig,
        mcpServers: normalizedServers,
      },
      stats: this.calculateStats(normalizedServers),
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

  static async getVscodeData() {
    const configPath = this.globalConfigPath;
    const notesPath = this.notesFilePath;
    const rawConfig = await this.safeReadJson(configPath, { servers: {} });
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
      config: {
        ...rawConfig,
        mcpServers: normalizedServers,
      },
      stats: this.calculateStats(normalizedServers),
    };
  }

  static async toggleServer(serverName, disabled) {
    this.assertWritableToggles();

    const configPath = this.globalConfigPath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
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
    return { changes: [{ name: serverName, disabled: !!disabled }] };
  }

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
      const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
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

  static async batchToggle(action) {
    this.assertWritableToggles();
    const isEnable = action === 'enableAll' || action === 'enable_all';
    const isDisable = action === 'disableAll' || action === 'disable_all';
    const isInvert = action === 'invert';

    const configPath = this.globalConfigPath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
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
      })),
    };
  }
}

module.exports = McpConfigService;
