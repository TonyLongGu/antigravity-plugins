// ==============================================================================
// 檔案名稱：services/copilotCliMcpService.js
// 功能說明：Copilot CLI（Agent Host）MCP 設定檔「唯讀」服務（路徑推導、讀取與統計）
// 設計定位：本服務不提供任何寫入 API。Copilot CLI 的 mcp-config.json 沒有開關欄位，
//           也沒有對應的啟停狀態資料庫（VS Code 的開關存於 state.vscdb，Copilot CLI 無此機制），
//           故此來源一律唯讀；開關請由 Copilot CLI 自身的設定管理。
// 路徑推導：COPILOT_HOME 環境變數優先，否則 ~/.copilot/mcp-config.json
//           （與 VS Code 內建 MCP 遷移器的解析一致：COPILOT_HOME || homedir/.copilot）
// 遵循規範：可遷移性優先（自推導路徑，嚴禁寫死本機使用者名稱與特定機器路徑）
// ==============================================================================

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Copilot CLI 的伺服器對照表鍵名（與 VS Code 的 servers 鍵不同，勿混用）
const SERVERS_KEY = 'mcpServers';

class CopilotCliMcpService {
  /** Copilot CLI 家目錄（COPILOT_HOME 可覆寫；空字串視為未設定） */
  static get homeDir() {
    const override = process.env.COPILOT_HOME;
    if (typeof override === 'string' && override.trim()) return override.trim();
    return path.join(os.homedir(), '.copilot');
  }

  static getConfigPath() {
    return path.join(this.homeDir, 'mcp-config.json');
  }

  static isAvailable() {
    try {
      return fs.existsSync(this.getConfigPath());
    } catch (_) {
      return false;
    }
  }

  static calculateStats(servers = {}) {
    const keys = Object.keys(servers);
    let enabled = 0;
    let disabled = 0;
    for (const key of keys) {
      if (servers[key] && servers[key].disabled === true) disabled++;
      else enabled++;
    }
    return { total: keys.length, enabled, disabled };
  }

  /**
   * 讀取 Copilot CLI 的 MCP 伺服器清單（唯讀、不正規化）
   * 官方格式：{ "mcpServers": { <name>: {...} } }；亦容忍裸格式（頂層即對照表），
   * 與工作區根 .mcp.json 的讀法一致：裸格式時只收「看起來像伺服器設定」的項目。
   * 檔案不存在或無法解析時回傳空清單（呼叫端只做顯示，不應因此中斷整個面板），
   * 但 exists / parseError 會照實回報，避免「檔案壞了」被誤認為「沒有伺服器」
   * @returns {Promise<{path:string, exists:boolean, parseError:boolean, servers:object}>}
   */
  static async readRaw() {
    const configPath = this.getConfigPath();
    const base = { path: configPath, exists: false, parseError: false, servers: {} };

    if (!this.isAvailable()) return base;

    let raw;
    try {
      const text = await fsPromises.readFile(configPath, 'utf-8');
      raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (_) {
      return { ...base, exists: true, parseError: true };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...base, exists: true, parseError: true };
    }

    const container = Object.prototype.hasOwnProperty.call(raw, SERVERS_KEY) ? raw[SERVERS_KEY] : raw;
    const servers = {};
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      for (const [name, cfg] of Object.entries(container)) {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
        if (!cfg.command && !cfg.url && !cfg.serverUrl && !cfg.type) continue;
        servers[name] = cfg;
      }
    }
    return { path: configPath, exists: true, parseError: false, servers };
  }

  /**
   * 讀取並正規化為儀表板統一格式
   * 註：description 不由本服務提供——Copilot CLI 設定檔無此欄位，
   *     且備註一律由宿主（VS Code）的 sidecar 檔管理，故交由呼叫端套用。
   * @param {Map<string, boolean>|Set<string>|null} agentHostStates
   *   agent host 的開關狀態（Map 的值 false = 停用；亦接受 Set = 停用清單）。
   *   Copilot CLI 設定檔本身沒有停用欄位，實際開關由 agent host 保管，故由呼叫端注入。
   * @returns {Promise<{path:string, exists:boolean, parseError:boolean, servers:object, stats:{total:number,enabled:number,disabled:number}>}>}
   */
  static async getServers(agentHostStates = null) {
    const { path: configPath, exists, parseError, servers: rawServers } = await this.readRaw();
    const normalizedServers = {};

    // Copilot CLI 設定檔本身沒有停用欄位，實際開關由 agent host 保管 → 由呼叫端注入，
    // 未提供時只反映設定檔自身宣告（不猜測），避免同一件事有兩份不一致的計算
    const isDisabledByAgentHost = (name) => {
      if (!agentHostStates) return false;
      // Set 沒有 get()；兩者語意不同（Set 直接就是停用清單）
      if (agentHostStates instanceof Set) return agentHostStates.has(name);
      if (typeof agentHostStates.get === 'function') return agentHostStates.get(name) === false;
      return false;
    };

    for (const [name, server] of Object.entries(rawServers)) {
      const declaredDisabled = server.disabled === true;
      const agentHostDisabled = !declaredDisabled && isDisabledByAgentHost(name);
      const isDisabled = declaredDisabled || agentHostDisabled;
      normalizedServers[name] = {
        ...server,
        // 舊檔案若沿用 VS Code 的 local 型別，語意等同 stdio（VS Code 遷移器亦如此轉換）
        type: server.type === 'local' ? 'stdio' : server.type,
        name,
        rawName: name,
        sourceType: 'copilotCli',
        serverUrl: server.serverUrl || server.url,
        disabled: isDisabled,
        effectiveDisabled: isDisabled,
        // 停用來源：'config' = 設定檔自身宣告、'agentHost' = VS Code 的 MCP 開關
        disabledBy: declaredDisabled ? 'config' : agentHostDisabled ? 'agentHost' : '',
        workspaceOverride: 'inherit',
        source: 'copilotCli',
        scope: 'global',
      };
    }

    return {
      path: configPath,
      exists,
      parseError,
      servers: normalizedServers,
      stats: this.calculateStats(normalizedServers),
    };
  }
}

module.exports = CopilotCliMcpService;
