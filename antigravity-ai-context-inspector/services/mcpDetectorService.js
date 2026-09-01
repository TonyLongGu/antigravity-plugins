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
            scope: 'Global MCP',
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
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : folder);
      const configCandidates = [
        path.join(folderPath, 'mcp_config.json'),
        path.join(folderPath, '.agents', 'mcp_config.json'),
        path.join(folderPath, '.mcp', 'config.json')
      ];

      for (const configPath of configCandidates) {
        if (fs.existsSync(configPath)) {
          try {
            const content = await fsPromises.readFile(configPath, 'utf-8');
            const parsed = JSON.parse(content);
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
   * 讀取特定 MCP Server 資料夾下的工具 JSON 定義
   */
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
          const parsed = JSON.parse(content);
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
