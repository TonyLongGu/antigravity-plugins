// ==============================================================================
// 檔案名稱：services/kiloMcpService.js
// 功能說明：Kilo Code MCP 設定「唯讀」服務（路徑推導、JSONC 解析與統計）
// 設計定位：不提供任何寫入 API。Kilo 的 MCP 開關由 Kilo 自身（CLI／擴充 UI）管理，
//           第三方直接改寫 kilo.jsonc 會與執行中的 Kilo 設定衝突。
// 資料位置（Kilo Code 7.x，實測）：~/.config/kilo/kilo.jsonc 的 mcp 段；
//           舊版相容目錄為 ~/.kilo、~/.kilocode（僅讀既有檔案，不建立）。
// 遵循規範：不讀 headers／environment／auth.json，只取啟動方式與啟停狀態。
// ==============================================================================

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = { extensions: { getExtension: () => null } };
}
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

class KiloMcpService {
  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  static getConfigHome() {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(this.getUserHome(), '.config');
    return path.join(xdgConfigHome, 'kilo');
  }

  /**
   * Kilo 擴充是否啟用中。Kilo CLI 可獨立存在（只有設定檔沒有擴充），
   * 因此可用性另外以「設定檔存在」判斷（見 isAvailable）。
   */
  static isExtensionInstalled() {
    try {
      return !!vscode.extensions?.getExtension('kilocode.kilo-code');
    } catch {
      return false;
    }
  }

  /** 目前作用中的 Kilo 全域 MCP 設定檔（找不到時回傳預設路徑供 UI 顯示） */
  static getConfigPath() {
    const homeDir = this.getUserHome();
    const candidates = [
      path.join(this.getConfigHome(), 'kilo.jsonc'),
      path.join(this.getConfigHome(), 'kilo.json'),
      path.join(homeDir, '.kilo', 'kilo.jsonc'),
      path.join(homeDir, '.kilo', 'kilo.json'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return candidates[0];
  }

  /** 擴充啟用或設定檔存在即視為可用（Kilo CLI 使用者不一定有擴充） */
  static isAvailable() {
    try {
      return this.isExtensionInstalled() || fs.existsSync(this.getConfigPath());
    } catch {
      return false;
    }
  }

  /**
   * 解析 JSONC（Kilo 的 kilo.jsonc 允許 `//`、`/* *\/` 註解與尾逗號）。
   * 只剝除字串外的註解，不引入額外相依套件。
   */
  static parseJsoncText(content) {
    const text = typeof content === 'string' ? content.replace(/^\uFEFF/, '') : '';
    let out = '';
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inLineComment) {
        if (ch === '\n') {
          inLineComment = false;
          out += ch;
        }
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inString) {
        out += ch;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        out += ch;
        continue;
      }
      if (ch === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      out += ch;
    }
    return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'));
  }

  static async safeReadJsonc(filePath, fallback = {}) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      return this.parseJsoncText(content);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn(`[KiloMcpService] 讀取設定失敗 [${filePath}]:`, e.message);
      }
      return fallback;
    }
  }

  /** 統計啟用／停用數（Kilo 以 `enabled: false` 表示停用，舊欄位 `disabled` 一併相容） */
  static calculateStats(servers = {}) {
    const keys = Object.keys(servers || {});
    let enabled = 0;
    let disabled = 0;
    for (const key of keys) {
      if (servers[key].disabled === true) disabled++;
      else enabled++;
    }
    return { total: keys.length, enabled, disabled };
  }

  /** 讀取 Kilo 全域 MCP 伺服器（純檢視；不讀 headers／environment） */
  static async getServers() {
    const configPath = this.getConfigPath();
    if (!configPath || !fs.existsSync(configPath)) {
      return { config: { mcp: {} }, servers: {}, stats: { total: 0, enabled: 0, disabled: 0 } };
    }

    const rawConfig = await this.safeReadJsonc(configPath, { mcp: {} });
    const rawServers = rawConfig.mcp || rawConfig.mcpServers || {};
    const servers = {};

    for (const [name, cfg] of Object.entries(rawServers)) {
      const server = cfg || {};
      const command = Array.isArray(server.command)
        ? server.command.filter((part) => typeof part === 'string')
        : (typeof server.command === 'string' ? server.command.split(/\s+/).filter(Boolean) : []);
      const url = typeof server.url === 'string' ? server.url : '';
      const isDisabled = server.enabled === false || server.disabled === true;
      // 白名單輸出：不展開原始物件，避免把 headers／environment 帶進 UI
      servers[name] = {
        name,
        rawName: name,
        sourceType: 'kilo',
        source: 'kilo',
        scope: 'global',
        type: typeof server.type === 'string' ? server.type : '',
        serverUrl: url,
        command: command[0] || '',
        args: command.slice(1),
        description: typeof server.description === 'string' ? server.description : '',
        enabled: !isDisabled,
        disabled: isDisabled,
        effectiveDisabled: isDisabled,
      };
    }

    return {
      path: configPath,
      config: rawConfig,
      servers,
      stats: this.calculateStats(servers),
    };
  }
}

module.exports = KiloMcpService;
