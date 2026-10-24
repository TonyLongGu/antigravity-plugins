const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

class McpDetectorService {
  /**
   * 取得使用者 Home 目錄
   */
  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  static naturalCompare(a, b) {
    return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
  }

  /**
   * Windows 上 PowerShell 5.1 與部分編輯器會寫入 UTF-8 BOM。
   * Node 的 JSON.parse 不接受 BOM，會整份設定被當成空清單。
   */
  static parseJsonText(content) {
    const text = typeof content === 'string' ? content.replace(/^\uFEFF/, '') : content;
    return JSON.parse(text);
  }

  /**
   * 掃描本機已安裝的 MCP Servers 與工具清單
   */
  static async scanMcpServers(workspaceFolders = []) {
    const userHome = this.getUserHome();
    const mcpRootDir = path.join(userHome, '.gemini', 'antigravity-ide', 'mcp');
    const servers = [];

    // 1. 掃描 Antigravity IDE 內建 MCP 目錄
    if (fs.existsSync(mcpRootDir)) {
      try {
        const entries = await fsPromises.readdir(mcpRootDir, { withFileTypes: true });
        const dirEntries = entries
          .filter(e => e.isDirectory())
          .sort((a, b) => this.naturalCompare(a.name, b.name));

        for (const entry of dirEntries) {
          const serverName = entry.name;
          const serverPath = path.join(mcpRootDir, serverName);
          const tools = await this._scanServerTools(serverPath);
          const instructionsPath = path.join(serverPath, 'instructions.md');
          const hasInstructions = fs.existsSync(instructionsPath);

          servers.push({
            name: serverName,
            scope: 'Global',
            path: serverPath,
            toolCount: tools.length,
            tools: tools,
            hasInstructions: hasInstructions,
            instructionsPath: hasInstructions ? instructionsPath : null
          });
        }
      } catch (err) {
        console.error('Error scanning MCP root dir:', err);
      }
    }

    // 2. 依工作區順序檢查各 Workspace 的 mcp_config.json
    for (let wsIdx = 0; wsIdx < workspaceFolders.length; wsIdx++) {
      const folder = workspaceFolders[wsIdx];
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      const configCandidates = [
        path.join(folderPath, 'mcp_config.json'),
        path.join(folderPath, '.agents', 'mcp_config.json'),
        path.join(folderPath, '.mcp', 'config.json')
      ];

      for (const configPath of configCandidates) {
        if (fs.existsSync(configPath)) {
          try {
            const content = await fsPromises.readFile(configPath, 'utf-8');
            const parsed = this.parseJsonText(content);
            const mcpServers = parsed.mcpServers || {};
            const serverKeys = Object.keys(mcpServers).sort((a, b) => this.naturalCompare(a, b));

            for (const sName of serverKeys) {
              const sCfg = mcpServers[sName];
              if (!servers.some(s => s.name.toLowerCase() === sName.toLowerCase())) {
                servers.push({
                  name: sName,
                  scope: `Workspace (${path.basename(folderPath)})`,
                  path: configPath,
                  toolCount: sCfg.tools ? sCfg.tools.length : 0,
                  tools: sCfg.tools || [],
                  hasInstructions: false,
                  instructionsPath: null
                });
              }
            }
          } catch (err) {
            console.error(`Error reading MCP config at ${configPath}:`, err);
          }
        }
      }
    }

    return servers;
  }

  /**
   * VS Code 使用者設定目錄（%APPDATA%/Code/User，不寫死本機磁碟路徑）
   */
  static getVsCodeUserDir() {
    if (process.env.APPDATA) {
      return path.join(process.env.APPDATA, 'Code', 'User');
    }
    if (process.platform === 'darwin') {
      return path.join(this.getUserHome(), 'Library', 'Application Support', 'Code', 'User');
    }
    return path.join(this.getUserHome(), '.config', 'Code', 'User');
  }

  /**
   * Copilot CLI 家目錄（COPILOT_HOME 可覆寫；空字串視為未設定）
   */
  static getCopilotHomeDir() {
    const override = process.env.COPILOT_HOME;
    if (typeof override === 'string' && override.trim()) return override.trim();
    return path.join(this.getUserHome(), '.copilot');
  }

  /**
   * Copilot CLI 的 MCP 設定檔；VS Code 啟用 `chat.mcp.discovery.enabled.copilot` 後，
   * 這就是 VS Code 實際載入的那一份（不再是 <User>/mcp.json）
   */
  static getCopilotCliConfigPath() {
    return path.join(this.getCopilotHomeDir(), 'mcp-config.json');
  }

  /**
   * 掃描 Cursor 使用者與工作區 MCP 設定（~/.cursor/mcp.json、{workspace}/.cursor/mcp.json）
   * 僅解析伺服器清單與啟動方式，不讀取 env / headers，避免把權杖帶進 UI。
   */
  static async scanCursorMcpServers(workspaceFolders = []) {
    return this._scanJsonMcpServers(
      path.join(this.getUserHome(), '.cursor', 'mcp.json'),
      ['.cursor', 'mcp.json'],
      workspaceFolders
    );
  }

  /**
   * 掃描 VS Code「實際會載入」的 MCP 伺服器
   * VS Code 會依 `chat.mcp.discovery.enabled` 讀取外部工具的設定檔；本機已啟用 copilot，
   * 也就是 VS Code 的 MCP 來源其實是 Copilot CLI 的 `~/.copilot/mcp-config.json`，
   * `<User>/mcp.json` 反而不存在——只讀後者會讓清單整片空白。
   * 故三處併列（<User>/mcp.json、{workspace}/.vscode/mcp.json、Copilot CLI），
   * 同名時以 VS Code 自身來源優先（與 VS Code 內部的來源優先序一致）。
   */
  static async scanVsCodeMcpServers(workspaceFolders = []) {
    const own = await this._scanJsonMcpServers(
      path.join(this.getVsCodeUserDir(), 'mcp.json'),
      ['.vscode', 'mcp.json'],
      workspaceFolders
    );
    const copilotCli = await this.scanCopilotCliMcpServers();
    return this._mergeMcpServers([own, copilotCli]);
  }

  /** 跨來源合併：同名（不分大小寫）時以先出現者為準 */
  static mergeMcpServers(lists) {
    return this._mergeMcpServers(lists);
  }

  static _mergeMcpServers(lists) {
    const servers = [];
    const seen = new Set();
    for (const list of lists) {
      for (const server of list || []) {
        const key = (server.name || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        servers.push(server);
      }
    }
    return servers;
  }

  /**
   * 掃描 Copilot CLI 的 MCP 設定（VS Code 啟用 discovery 後實際載入的那一份）
   * 純檢視：只列名稱、範圍與啟動方式，不讀 env / headers（本功能不標注啟停狀態）。
   */
  static async scanCopilotCliMcpServers() {
    const configPath = this.getCopilotCliConfigPath();
    if (!fs.existsSync(configPath)) return [];

    const servers = [];

    try {
      const content = await fsPromises.readFile(configPath, 'utf-8');
      const parsed = this.parseJsonText(content);
      const mcpServers = parsed.mcpServers || parsed.servers || {};
      const serverKeys = Object.keys(mcpServers).sort((a, b) => this.naturalCompare(a, b));

      for (const sName of serverKeys) {
        const sCfg = mcpServers[sName] || {};
        const url = typeof sCfg.url === 'string' ? sCfg.url : '';
        const command = typeof sCfg.command === 'string' ? sCfg.command : '';
        const args = Array.isArray(sCfg.args) ? sCfg.args.filter(a => typeof a === 'string') : [];
        const type = typeof sCfg.type === 'string' ? sCfg.type.toLowerCase() : '';
        const transport = (type === 'http' || type === 'sse' || url) ? 'http' : 'stdio';
        // 設定檔的 tools 是白名單（通常 ["*"]）而非工具清單，故不計數也不列出
        servers.push({
          name: sName,
          scope: 'Copilot CLI',
          path: configPath,
          toolCount: 0,
          tools: [],
          hasInstructions: false,
          instructionsPath: null,
          transport,
          command,
          args,
          url,
        });
      }
    } catch (err) {
      console.error(`Error reading MCP config at ${configPath}:`, err);
    }

    return servers;
  }

  /**
   * Cline 資料根目錄。優先序：呼叫端指定（VS Code 設定）> 環境變數（測試）> ~/.cline/data
   */
  static getClineDataDir(override) {
    if (typeof override === 'string' && override.trim()) return override.trim();
    const env = process.env.CLINE_DATA_DIR;
    if (typeof env === 'string' && env.trim()) return env.trim();
    return path.join(this.getUserHome(), '.cline', 'data');
  }

  /**
   * Cline MCP 設定檔（中央檔優先，其後為各 IDE 的舊版鏡像）。
   * Cline 4.x 已把設定集中到 ~/.cline/data/settings，但舊安裝仍可能只存在 globalStorage。
   */
  static getClineMcpConfigPaths(override) {
    const paths = [path.join(this.getClineDataDir(override), 'settings', 'cline_mcp_settings.json')];
    const appData = process.env.APPDATA;
    if (appData) {
      for (const ideDir of ['Code', 'Code - Insiders', 'Cursor', 'Antigravity', 'Antigravity IDE', 'Windsurf']) {
        paths.push(path.join(appData, ideDir, 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
      }
    }
    return paths;
  }

  /**
   * 掃描 Cline 已註冊的 MCP 伺服器（與宿主 IDE 無關）。
   * 純檢視：只讀 command / args / url / disabled，**不讀 env**（避免把權杖帶進 UI）。
   * Cline 的 `tools` 欄位是自動核准白名單（多為 ["*"]），不是工具清單，故不計數。
   */
  static async scanClineMcpServers(workspaceFolders = [], options = {}) {
    const configPaths = this.getClineMcpConfigPaths(options?.clineDataDir);
    const lists = [];

    for (const configPath of configPaths) {
      if (!fs.existsSync(configPath)) continue;
      let parsed = null;
      try {
        parsed = this.parseJsonText(await fsPromises.readFile(configPath, 'utf-8'));
      } catch (err) {
        console.error(`Error reading Cline MCP config at ${configPath}:`, err);
        continue;
      }

      const mcpServers = parsed?.mcpServers || {};
      const serverKeys = Object.keys(mcpServers).sort((a, b) => this.naturalCompare(a, b));
      const servers = [];
      for (const sName of serverKeys) {
        const sCfg = mcpServers[sName] || {};
        const url = typeof sCfg.url === 'string' ? sCfg.url : '';
        const command = typeof sCfg.command === 'string' ? sCfg.command : '';
        const args = Array.isArray(sCfg.args) ? sCfg.args.filter(a => typeof a === 'string') : [];
        const type = typeof sCfg.type === 'string' ? sCfg.type.toLowerCase() : '';
        servers.push({
          name: sName,
          scope: 'Cline',
          path: configPath,
          toolCount: 0,
          tools: [],
          hasInstructions: false,
          instructionsPath: null,
          transport: (type === 'http' || type === 'sse' || url) ? 'http' : 'stdio',
          command,
          args,
          url,
          // 只保留「已關閉」旗標供足跡標注；欄位名與 VS Code 的 disabled 區隔
          isDisabled: sCfg.disabled === true,
        });
      }
      lists.push(servers);
    }

    return this.mergeMcpServers(lists);
  }

  static async _scanJsonMcpServers(userConfigPath, workspaceRelParts, workspaceFolders = []) {
    const servers = [];
    const seen = new Set();

    const pushUnique = (list) => {
      for (const server of list) {
        const key = `${(server.name || '').toLowerCase()}|${(server.path || '').toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        servers.push(server);
      }
    };

    pushUnique(await this._parseMcpJsonConfig(userConfigPath, 'Global'));

    for (const folder of workspaceFolders) {
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      if (!folderPath) continue;
      pushUnique(await this._parseMcpJsonConfig(
        path.join(folderPath, ...workspaceRelParts),
        `Workspace (${path.basename(folderPath)})`
      ));
    }

    return servers;
  }

  /**
   * 解析 mcp.json：Cursor 用 mcpServers，VS Code 用 servers。不讀取 env / headers。
   */
  static async _parseMcpJsonConfig(configPath, scope) {
    const servers = [];
    if (!fs.existsSync(configPath)) return servers;

    try {
      const content = await fsPromises.readFile(configPath, 'utf-8');
      const parsed = this.parseJsonText(content);
      const mcpServers = parsed.servers || parsed.mcpServers || {};
      const serverKeys = Object.keys(mcpServers).sort((a, b) => this.naturalCompare(a, b));

      for (const sName of serverKeys) {
        const sCfg = mcpServers[sName] || {};
        const url = typeof sCfg.url === 'string' ? sCfg.url : '';
        const command = typeof sCfg.command === 'string' ? sCfg.command : '';
        const args = Array.isArray(sCfg.args) ? sCfg.args.filter(a => typeof a === 'string') : [];
        const tools = Array.isArray(sCfg.tools) ? sCfg.tools : [];
        const type = typeof sCfg.type === 'string' ? sCfg.type.toLowerCase() : '';
        const transport = (type === 'http' || type === 'sse' || url) ? 'http' : 'stdio';
        servers.push({
          name: sName,
          scope,
          path: configPath,
          toolCount: tools.length,
          tools,
          hasInstructions: false,
          instructionsPath: null,
          transport,
          command,
          args,
          url,
        });
      }
    } catch (err) {
      console.error(`Error reading MCP config at ${configPath}:`, err);
    }

    return servers;
  }

  static async _scanServerTools(serverPath) {
    const tools = [];
    try {
      const entries = await fsPromises.readdir(serverPath, { withFileTypes: true });
      const jsonFiles = entries
        .filter(f => f.isFile() && f.name.endsWith('.json'))
        .sort((a, b) => this.naturalCompare(a.name, b.name));

      for (const file of jsonFiles) {
        const toolName = path.basename(file.name, '.json');
        const filePath = path.join(serverPath, file.name);
        let toolDescription = '';
        try {
          const content = await fsPromises.readFile(filePath, 'utf-8');
          const parsed = this.parseJsonText(content);
          toolDescription = parsed.description || parsed.name || '';
        } catch (e) {}

        tools.push({
          name: toolName,
          description: toolDescription,
          filePath: filePath
        });
      }
    } catch (e) {
      console.error(`Error scanning tools in ${serverPath}:`, e);
    }
    return tools;
  }
}

module.exports = McpDetectorService;
