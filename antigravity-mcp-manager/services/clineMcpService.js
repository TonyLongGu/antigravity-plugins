// ==============================================================================
// 檔案名稱：services/clineMcpService.js
// 功能說明：Cline 延伸模組 (Claude Dev) MCP 設定檔「唯讀」服務（路徑推導、讀取與統計）
// 設計定位：本服務不提供任何寫入 API。Cline 的 MCP 開關一律由 Cline 自身面板管理；
//           第三方直接改寫 cline_mcp_settings.json 可能與 Cline 記憶體中的設定衝突，
//           與 VS Code 端移除寫入模式的理由相同（詳見 README「Cline 整合」）。
// 遵循規範：可遷移性優先（自推導路徑，嚴禁寫死本機使用者名稱與特定機器路徑）
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
const I18n = require('./i18nService');

class ClineMcpService {
  static _context = null;
  static _cachedConfigPath = null;

  static init(context) {
    this._context = context;
    this._cachedConfigPath = null;
  }

  /**
   * 檢查當前 IDE 是否安裝 Cline (Claude Dev) 延伸模組
   */
  static isInstalled() {
    // 1. 優先檢查 VS Code 延伸模組註冊表
    try {
      const ext = vscode.extensions?.getExtension('saoudrizwan.claude-dev');
      if (ext) return true;
    } catch (_) {}

    // 2. 備援檢查：檢查 Cline 設定檔是否存在
    const configPath = this.getConfigPath();
    if (configPath && fs.existsSync(configPath)) {
      return true;
    }

    return false;
  }

  /**
   * 動態自推導 Cline 的 MCP 設定檔路徑 (可遷移性優先，嚴禁寫死本機路徑)
   * 優先順序：
   * 1. Cline 官方/獨立儲存目錄：~/.cline/data/settings/cline_mcp_settings.json 與 ~/.cline/settings/cline_mcp_settings.json
   * 2. 當前擴充套件之 globalStorage 同層 saoudrizwan.claude-dev/settings/cline_mcp_settings.json
   * 3. 系統 AppData/Config 內各 IDE (Antigravity, Code, Cursor 等) 之 globalStorage
   */
  static getConfigPath() {
    if (this._cachedConfigPath && fs.existsSync(this._cachedConfigPath)) {
      return this._cachedConfigPath;
    }

    const homeDir = os.homedir();

    // 1. 最高優先：Cline 本體獨立資料目錄（真實活躍設定檔）
    const primaryClinePath = path.join(homeDir, '.cline', 'data', 'settings', 'cline_mcp_settings.json');
    if (fs.existsSync(primaryClinePath)) {
      try {
        const raw = fs.readFileSync(primaryClinePath, 'utf-8');
        const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
        if (parsed.mcpServers && Object.keys(parsed.mcpServers).length > 0) {
          this._cachedConfigPath = primaryClinePath;
          return primaryClinePath;
        }
      } catch (_) {}
    }

    const secondaryClinePath = path.join(homeDir, '.cline', 'settings', 'cline_mcp_settings.json');
    if (fs.existsSync(secondaryClinePath)) {
      try {
        const raw = fs.readFileSync(secondaryClinePath, 'utf-8');
        const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
        if (parsed.mcpServers && Object.keys(parsed.mcpServers).length > 0) {
          this._cachedConfigPath = secondaryClinePath;
          return secondaryClinePath;
        }
      } catch (_) {}
    }

    const candidates = [];
    if (fs.existsSync(primaryClinePath)) candidates.push(primaryClinePath);
    if (fs.existsSync(secondaryClinePath)) candidates.push(secondaryClinePath);

    // 2. 透過當前擴充套件 globalStorageUri 自行推導同層 saoudrizwan.claude-dev
    if (this._context?.globalStorageUri?.fsPath) {
      const userGlobalStorageDir = path.dirname(this._context.globalStorageUri.fsPath);
      candidates.push(path.join(userGlobalStorageDir, 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    }

    // 3. 依照各作業系統標準 AppData / Config 目錄與可能之 IDE 名稱推導
    const appData = process.env.APPDATA || (
      process.platform === 'darwin'
        ? path.join(homeDir, 'Library', 'Application Support')
        : path.join(homeDir, '.config')
    );

    if (appData) {
      const ideNames = ['Antigravity IDE', 'Code', 'Cursor', 'Code - Insiders', 'VSCodium'];
      for (const ide of ideNames) {
        candidates.push(path.join(appData, ide, 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
      }
    }

    // 4. 智慧評估存在的候選路徑：優先選擇包含啟用伺服器（enabled > 0）的有效設定檔
    const existingCandidates = candidates.filter((c) => fs.existsSync(c));
    if (existingCandidates.length === 1) {
      this._cachedConfigPath = existingCandidates[0];
      return this._cachedConfigPath;
    }

    if (existingCandidates.length > 1) {
      let bestPath = existingCandidates[0];
      let bestScore = -1;

      for (const cand of existingCandidates) {
        try {
          const raw = fs.readFileSync(cand, 'utf-8');
          const clean = raw.replace(/^\uFEFF/, '');
          const parsed = JSON.parse(clean);
          const servers = parsed.mcpServers || {};
          const serverCount = Object.keys(servers).length;
          let enabledCount = 0;
          for (const s of Object.values(servers)) {
            if (s && s.disabled !== true) enabledCount++;
          }

          // 評分標準：有啟用項者大幅加分 (例如 supermemory 啟用中)，其次為伺服器總數
          const isDotCline = cand.includes('.cline');
          const score = (enabledCount * 100) + (isDotCline ? 50 : 0) + serverCount;

          if (score > bestScore) {
            bestPath = cand;
            bestScore = score;
          }
        } catch (_) {}
      }

      this._cachedConfigPath = bestPath;
      return bestPath;
    }

    const fallback = candidates[0] || '';
    this._cachedConfigPath = fallback;
    return fallback;
  }

  /**
   * 取得 Cline 獨立備註檔案路徑
   */
  static getNotesPath() {
    const configPath = this.getConfigPath();
    if (!configPath) return '';
    return path.join(path.dirname(configPath), 'cline_mcp_notes.json');
  }

  /**
   * 安全讀取 JSON (去除 BOM，保護解析失敗時不崩潰)
   */
  static async safeReadJson(filePath, fallback = {}) {
    let content;
    try {
      content = await fsPromises.readFile(filePath, 'utf-8');
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      console.warn(`[ClineMcpService] 讀取 JSON 失敗 [${filePath}]:`, e.message);
      return fallback;
    }

    try {
      const text = typeof content === 'string' ? content.replace(/^\uFEFF/, '') : content;
      return JSON.parse(text);
    } catch (e) {
      console.warn(`[ClineMcpService] 解析 JSON 失敗 [${filePath}]:`, e.message);
      return fallback;
    }
  }

  /**
   * 讀取 Cline 備註
   */
  static async getNotes() {
    const notesPath = this.getNotesPath();
    if (!notesPath) return {};
    return await this.safeReadJson(notesPath, {});
  }

  /**
   * 計算伺服器統計資訊
   */
  static calculateStats(servers = {}) {
    const keys = Object.keys(servers);
    let enabled = 0;
    let disabled = 0;
    for (const key of keys) {
      if (servers[key].disabled === true) {
        disabled++;
      } else {
        enabled++;
      }
    }
    return { total: keys.length, enabled, disabled };
  }

  /**
   * 讀取 Cline 的 MCP 伺服器列表並正規化
   */
  static async getServers() {
    const configPath = this.getConfigPath();
    if (!configPath || !fs.existsSync(configPath)) {
      return { config: { mcpServers: {} }, servers: {}, stats: { total: 0, enabled: 0, disabled: 0 } };
    }

    const rawConfig = await this.safeReadJson(configPath, { mcpServers: {} });
    const rawServers = rawConfig.mcpServers || {};
    const notes = await this.getNotes();
    const normalizedServers = {};

    for (const [name, server] of Object.entries(rawServers)) {
      const note = notes[name] || {};
      const desc = note.description || server.description || '';
      const isDisabled = server.disabled === true;

      normalizedServers[name] = {
        ...server,
        name,
        rawName: name,
        sourceType: 'cline',
        serverUrl: server.serverUrl || server.url,
        description: desc,
        disabled: isDisabled,
        effectiveDisabled: isDisabled,
        source: 'cline',
        scope: 'global',
      };
    }

    return {
      path: configPath,
      config: rawConfig,
      servers: normalizedServers,
      stats: this.calculateStats(normalizedServers),
    };
  }

}

module.exports = ClineMcpService;
