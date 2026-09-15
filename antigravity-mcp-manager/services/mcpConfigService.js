// ==============================================================================
// 檔案名稱：services/mcpConfigService.js
// 功能說明：MCP 配置檔與獨立備註管理服務
// 宿主：Antigravity（~/.gemini/config/mcp_config.json，mcpServers.disabled）
// 不支援 Cursor / VS Code（安裝腳本也不會掛到對應 extensions）
// ==============================================================================

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = { env: { appName: '' } };
}
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const UNSUPPORTED_HOST_MESSAGE = '此擴充套件僅支援 Antigravity IDE，不支援 Cursor 與 Visual Studio Code';

class McpConfigService {
  static init(_context) {}

  static get appName() {
    return vscode?.env?.appName || '';
  }

  /**
   * 當前宿主種類：antigravity | unsupported
   */
  static get hostKind() {
    return /antigravity/i.test(this.appName) ? 'antigravity' : 'unsupported';
  }

  static get isUnsupportedHost() {
    return this.hostKind === 'unsupported';
  }

  static get isVsCode() {
    return false;
  }

  static get usesEnablementDb() {
    return false;
  }

  static get envName() {
    return this.hostKind === 'antigravity' ? 'Antigravity IDE' : '不支援的 IDE';
  }

  static get globalConfigPath() {
    return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  }

  static get notesFilePath() {
    return path.join(os.homedir(), '.gemini', 'config', 'antigravity_mcp_notes.json');
  }

  static assertSupportedHost() {
    if (this.isUnsupportedHost) {
      throw new Error(UNSUPPORTED_HOST_MESSAGE);
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

  static async getNotes() {
    return await this.safeReadJson(this.notesFilePath, {});
  }

  static async saveNotes(notesObj) {
    await this.safeSaveJson(this.notesFilePath, notesObj);
    return notesObj;
  }

  static calculateStats(servers = {}) {
    const serverKeys = Object.keys(servers);
    const total = serverKeys.length;
    let enabled = 0;
    let disabled = 0;

    for (const key of serverKeys) {
      if (servers[key].disabled === true) {
        disabled++;
      } else {
        enabled++;
      }
    }

    return { total, enabled, disabled };
  }

  static async getGlobalData() {
    const hostKind = this.hostKind;
    if (hostKind === 'unsupported') {
      return {
        path: '',
        notesPath: '',
        hostKind,
        isVsCode: false,
        isCursor: false,
        envName: this.envName,
        unsupported: true,
        unsupportedMessage: UNSUPPORTED_HOST_MESSAGE,
        config: { mcpServers: {} },
        stats: { total: 0, enabled: 0, disabled: 0 },
      };
    }

    const configPath = this.globalConfigPath;
    const notesPath = this.notesFilePath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
    const notes = await this.getNotes();
    const servers = rawConfig.mcpServers || {};
    const normalizedServers = {};

    for (const [name, server] of Object.entries(servers)) {
      const note = notes[name] || {};
      const desc = note.description || server.description || '';
      normalizedServers[name] = {
        ...server,
        serverUrl: server.serverUrl || server.url,
        description: desc,
        disabled: server.disabled === true,
      };
    }

    return {
      path: configPath,
      notesPath,
      hostKind,
      isVsCode: false,
      isCursor: false,
      envName: this.envName,
      config: {
        ...rawConfig,
        mcpServers: normalizedServers,
      },
      stats: this.calculateStats(normalizedServers),
    };
  }

  static async toggleServer(serverName, disabled) {
    this.assertSupportedHost();
    const configPath = this.globalConfigPath;
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
    if (!rawConfig.mcpServers || !rawConfig.mcpServers[serverName]) {
      throw new Error(`找不到伺服器：${serverName}`);
    }

    if (disabled) {
      rawConfig.mcpServers[serverName].disabled = true;
    } else {
      delete rawConfig.mcpServers[serverName].disabled;
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

    try {
      const configPath = this.globalConfigPath;
      const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
      if (rawConfig.mcpServers && rawConfig.mcpServers[serverName]) {
        if (trimmed) {
          rawConfig.mcpServers[serverName].description = trimmed;
        } else {
          delete rawConfig.mcpServers[serverName].description;
        }
        await this.safeSaveJson(configPath, rawConfig);
      }
    } catch (err) {
      console.warn('同步更新 mcp_config.json 失敗:', err.message);
    }
  }

  static async batchToggle(action) {
    this.assertSupportedHost();
    const configPath = this.globalConfigPath;
    const isEnable = action === 'enableAll' || action === 'enable_all';
    const isDisable = action === 'disableAll' || action === 'disable_all';
    const isInvert = action === 'invert';
    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
    const servers = rawConfig.mcpServers || {};

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
