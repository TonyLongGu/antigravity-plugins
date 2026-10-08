// ==============================================================================
// 檔案名稱：services/agentHostMcpService.js
// 功能說明：Agent Host（Copilot CLI harness）的 MCP 開關狀態讀取（唯讀）
// 定位：VS Code 的 MCP 開關有「兩套」儲存，各管各的來源，不可互相套用：
//   1. state.vscdb → mcp.enablement（id: mcp.config.usrlocal.<名稱>）
//      管的是 VS Code「使用者 profile 的 mcp.json」這個來源
//   2. globalStorage/agent-host-storage.json → customizationEnablement
//      管的是 **agent host 自己**（本機即 Copilot CLI 讀的 ~/.copilot/mcp-config.json）
// 本服務處理第 2 套。使用者在 VS Code 的 MCP 伺服器清單切換開關時，寫入的就是這裡，
// 因此 Copilot CLI 來源的條目必須以此為準，面板才會與使用者所見一致。
// 依據原始碼：out/vs/platform/agentHost/node/agentHostMain.js
//   N1 = "customizationEnablement"；key 規則 HK()：
//     mcpServer 未被 plugin 擁有 → `mcpServers#<名稱>`
//     mcpServer 由 plugin 擁有   → `<pluginSource>#mcp=<名稱>`
//     plugin                     → `<來源 URI>`
//   解析優先序 resolve()：session → workingDirectory（工作區）→ global → clientGlobal
//   值為布林：false = 停用；未記載 = 依上層或預設啟用
// 遵循規範：可遷移性優先（路徑由 VS Code 的 globalStorage 推導，不寫死本機路徑）
// ==============================================================================

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const VscodeEnablementService = require('./vscodeEnablementService');

const STORAGE_FILE = 'agent-host-storage.json';
const ENABLEMENT_KEY = 'customizationEnablement';
const MCP_KEY_PREFIX = 'mcpServers#';
const PLUGIN_MCP_MARKER = '#mcp=';

// 已知的「plugin／同步來源」鍵前綴：這類鍵的名稱可能與 CLI 設定檔同名，
// 但屬於不同實體（例如 Pylance 提供的 `pylance mcp server`），
// 拿來判定 CLI 條目會造成跨來源誤停用，故一律忽略。
const PLUGIN_KEY_PREFIXES = [
  'vscode-synced-customization:',
  'vscode-userdata:',
  'file:',
  'https:',
  'http:',
];

class AgentHostMcpService {
  static init(context) {
    // 與 VscodeEnablementService 共用 storageRootDir 的推導來源
    VscodeEnablementService.init(context);
  }

  /** agent host 的持久化設定檔（位於 VS Code 的 globalStorage 根目錄） */
  static get storageFilePath() {
    const root = VscodeEnablementService.storageRootDir;
    return root ? path.join(root, STORAGE_FILE) : '';
  }

  static isAvailable() {
    const p = this.storageFilePath;
    try {
      return !!p && fs.existsSync(p);
    } catch (_) {
      return false;
    }
  }

  /**
   * 解析 enablement 的鍵
   * 只有「不屬於任何 plugin」的 MCP 伺服器（鍵為 `mcpServers#<名稱>`）才視為符合：
   *   - 已知來源 URI 前綴（`vscode-synced-customization:` 等）代表該伺服器由某個 plugin／
   *     同步來源提供，名稱可能與 CLI 設定檔同名但**屬於不同實體**，拿來判定 CLI 條目會誤傷
   *   - 未知鍵則採既有規則（含 `#mcp=` 者取出名稱）
   * 依據：agentHostMain.js 的 HK() —— 有 owningPluginSource 時鍵為
   *   `<pluginSource>#mcp=<名稱>`，否則為 `mcpServers#<名稱>`
   * @returns {{kind:'mcpServer'|'ignored', name:string, reason:string}}
   */
  static parseEnablementKey(key) {
    if (typeof key !== 'string' || !key) return { kind: 'ignored', name: '', reason: 'empty' };

    if (key.startsWith(MCP_KEY_PREFIX)) {
      const name = key.slice(MCP_KEY_PREFIX.length);
      return name ? { kind: 'mcpServer', name, reason: 'root' } : { kind: 'ignored', name: '', reason: 'emptyName' };
    }

    for (const prefix of PLUGIN_KEY_PREFIXES) {
      if (key.includes(prefix)) {
        return { kind: 'ignored', name: '', reason: 'pluginScoped' };
      }
    }

    const idx = key.indexOf(PLUGIN_MCP_MARKER);
    if (idx >= 0) {
      const name = key.slice(idx + PLUGIN_MCP_MARKER.length);
      return name ? { kind: 'mcpServer', name, reason: 'pluginUnclassified' } : { kind: 'ignored', name: '', reason: 'emptyName' };
    }

    return { kind: 'ignored', name: '', reason: 'unrecognized' };
  }

  /** 由 enablement 物件取出**根來源**（`mcpServers#<名稱>`）的 MCP 伺服器名稱 → 布林 */
  static extractMcpServers(enablement) {
    const result = new Map();
    if (!enablement || typeof enablement !== 'object' || Array.isArray(enablement)) return result;
    for (const [key, value] of Object.entries(enablement)) {
      const parsed = this.parseEnablementKey(key);
      if (parsed.kind !== 'mcpServer' || !parsed.name) continue;
      if (typeof value !== 'boolean') continue;
      result.set(parsed.name, value);
    }
    return result;
  }

  /** 被忽略的鍵（plugin 範圍／無法辨識），供除錯與回報使用 */
  static ignoredKeys(enablement) {
    const ignored = [];
    if (!enablement || typeof enablement !== 'object' || Array.isArray(enablement)) return ignored;
    for (const key of Object.keys(enablement)) {
      const parsed = this.parseEnablementKey(key);
      if (parsed.kind === 'ignored') ignored.push({ key, reason: parsed.reason });
    }
    return ignored;
  }

  /**
   * 讀取 agent host 的 MCP 開關狀態
   * @param {string} workspaceUri 目前工作區資料夾的 URI 字串（可選；用於 workingDirectories 覆寫）
   * @returns {Promise<{path:string, exists:boolean, parseError:boolean, global:Map<string,boolean>, workspace:Map<string,boolean>}>}
   */
  static async readState(workspaceUri = '') {
    const filePath = this.storageFilePath;
    const base = { path: filePath, exists: false, parseError: false, global: new Map(), workspace: new Map() };
    if (!this.isAvailable()) return base;

    let raw;
    try {
      const text = await fsPromises.readFile(filePath, 'utf-8');
      raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (_) {
      return { ...base, exists: true, parseError: true };
    }

    const container = raw && typeof raw === 'object' ? raw[ENABLEMENT_KEY] : null;
    if (!container || typeof container !== 'object') {
      return { ...base, exists: true };
    }

    const global = this.extractMcpServers(container.global);
    let workspace = new Map();
    if (workspaceUri && container.workingDirectories && typeof container.workingDirectories === 'object') {
      workspace = this.extractMcpServers(container.workingDirectories[workspaceUri]);
    }
    return { path: filePath, exists: true, parseError: false, global, workspace };
  }

  /**
   * 解析出每個伺服器的實際啟用狀態（工作區覆寫優先於全域）
   * @returns {Map<string, boolean>} 僅含「有明確記載」的伺服器
   */
  static resolveStates(state) {
    const resolved = new Map(state?.global || []);
    if (state?.workspace && state.workspace.size > 0) {
      for (const [name, enabled] of state.workspace) resolved.set(name, enabled);
    }
    return resolved;
  }

  /** 明確被停用的伺服器名稱（供正規化時標記 disabled） */
  static disabledNames(states) {
    const names = new Set();
    for (const [name, enabled] of states || []) {
      if (enabled === false) names.add(name);
    }
    return names;
  }

  /** 變更簽章（mtime:size，成本極低；供輪詢偵測外部切換） */
  static signature() {
    const p = this.storageFilePath;
    if (!p) return '-';
    try {
      const st = fs.statSync(p);
      return `${st.mtimeMs}:${st.size}`;
    } catch (_) {
      return 'x';
    }
  }
}

module.exports = AgentHostMcpService;
