// ==============================================================================
// 檔案名稱：services/mcpConfigService.js
// 功能說明：MCP 配置檔管理服務 (支援全域與專案層級 JSON 讀寫、備份、開關與批次操作)
// ==============================================================================

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');

class McpConfigService {
  static get globalConfigPath() {
    return GLOBAL_CONFIG_PATH;
  }

  /**
   * 安全讀取並解析 JSON 檔案
   */
  static async safeReadJson(filePath, fallback = { mcpServers: {} }) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      console.error(`解析 JSON 失敗 [${filePath}]:`, e);
      return fallback;
    }
  }

  /**
   * 安全儲存 MCP 配置檔（含自動 .bak 備份與 JSON 格式校驗）
   */
  static async safeSaveMCPConfig(filePath, configObj) {
    const dir = path.dirname(filePath);
    try {
      await fsPromises.mkdir(dir, { recursive: true });
    } catch (e) {}

    // 1. 若原始檔案存在，建立備份
    try {
      await fsPromises.access(filePath);
      const backupPath = `${filePath}.bak`;
      await fsPromises.copyFile(filePath, backupPath);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn('建立備份檔失敗:', e);
      }
    }

    // 2. 格式化為易讀 JSON (2 格縮排)
    const jsonContent = JSON.stringify(configObj, null, 2) + '\n';

    // 3. 驗證格式可被正確解析
    JSON.parse(jsonContent);

    // 4. 寫入 UTF-8 檔案
    await fsPromises.writeFile(filePath, jsonContent, 'utf-8');
    return true;
  }

  /**
   * 計算伺服器統計數據 (Total, Enabled, Disabled)
   */
  static calculateStats(config) {
    const servers = (config && config.mcpServers) || {};
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

  /**
   * 取得全域 MCP 配置與統計資訊
   */
  static async getGlobalData() {
    const config = await this.safeReadJson(GLOBAL_CONFIG_PATH, { mcpServers: {} });
    const stats = this.calculateStats(config);
    return {
      path: GLOBAL_CONFIG_PATH,
      config,
      stats,
    };
  }

  /**
   * 切換單一伺服器啟用/停用狀態
   */
  static async toggleServer(filePath, serverName, disabled) {
    const config = await this.safeReadJson(filePath, { mcpServers: {} });
    if (!config.mcpServers || !config.mcpServers[serverName]) {
      throw new Error(`找不到伺服器：${serverName}`);
    }

    if (disabled) {
      config.mcpServers[serverName].disabled = true;
    } else {
      delete config.mcpServers[serverName].disabled;
    }

    await this.safeSaveMCPConfig(filePath, config);
    return config;
  }

  /**
   * 批次切換伺服器狀態 (enable_all / disable_all / invert)
   */
  static async batchToggle(filePath, action) {
    const config = await this.safeReadJson(filePath, { mcpServers: {} });
    const servers = config.mcpServers || {};

    for (const key of Object.keys(servers)) {
      if (action === 'enable_all') {
        delete servers[key].disabled;
      } else if (action === 'disable_all') {
        servers[key].disabled = true;
      } else if (action === 'invert') {
        if (servers[key].disabled === true) {
          delete servers[key].disabled;
        } else {
          servers[key].disabled = true;
        }
      }
    }

    await this.safeSaveMCPConfig(filePath, config);
    return config;
  }
}

module.exports = McpConfigService;
