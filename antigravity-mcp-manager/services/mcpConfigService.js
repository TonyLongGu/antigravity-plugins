// ==============================================================================
// 檔案名稱：services/mcpConfigService.js
// 功能說明：MCP 配置檔與獨立備註管理服務 (支援 Antigravity IDE 與 VS Code 雙環境獨立分檔與原生資料庫同步)
// 規格遵循：
//   - Antigravity 備註：獨立存於 antigravity_mcp_notes.json，開關直接寫入 mcp_config.json
//   - VS Code 備註：獨立存於 vscode_mcp_notes.json (保證 mcp.json 零污染且 100% 官方合規)
//   - VS Code 開關：原生同步至 state.vscdb 中的 mcp.enablement (徹底解決 VS Code 原生開關無效問題)
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
let nodeSqlite;
try {
  nodeSqlite = require('node:sqlite');
} catch (e) {}
let childProcess;
try {
  childProcess = require('node:child_process');
} catch (e) {}

class McpConfigService {
  /**
   * 判斷是否運行於 VS Code 環境 (否則為 Antigravity IDE)
   */
  static get isVsCode() {
    return !/antigravity/i.test(vscode?.env?.appName || '');
  }

  /**
   * 當前 IDE 執行環境名稱
   */
  static get envName() {
    return this.isVsCode ? 'VS Code' : 'Antigravity IDE';
  }

  /**
   * 取得當前 IDE 所讀取之 MCP 設定檔路徑
   */
  static get globalConfigPath() {
    if (this.isVsCode) {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const isInsiders = /insiders/i.test(vscode?.env?.appName || '');
      const folder = isInsiders ? 'Code - Insiders' : 'Code';
      return path.join(appData, folder, 'User', 'mcp.json');
    }
    return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  }

  /**
   * 取得 VS Code 全域 Storage 資料庫 (state.vscdb) 路徑
   */
  static get vsCodeStateDbPath() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const isInsiders = /insiders/i.test(vscode?.env?.appName || '');
    const folder = isInsiders ? 'Code - Insiders' : 'Code';
    return path.join(appData, folder, 'User', 'globalStorage', 'state.vscdb');
  }

  /**
   * 取得當前 IDE 所屬之全域獨立備註檔路徑
   * - Google Antigravity: ~/.gemini/config/antigravity_mcp_notes.json
   * - Visual Studio Code: %APPDATA%/Code/User/vscode_mcp_notes.json
   */
  static get notesFilePath() {
    const filename = this.isVsCode ? 'vscode_mcp_notes.json' : 'antigravity_mcp_notes.json';
    if (this.isVsCode) {
      return path.join(path.dirname(this.globalConfigPath), filename);
    }
    return path.join(os.homedir(), '.gemini', 'config', filename);
  }

  /**
   * 安全讀取並解析 JSON 檔案
   */
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

  /**
   * 安全儲存 JSON 檔案（含格式驗證、自動備份與原子性寫入防護）
   */
  static async safeSaveJson(filePath, dataObj) {
    const dir = path.dirname(filePath);
    try {
      await fsPromises.mkdir(dir, { recursive: true });
    } catch (e) {}

    const jsonContent = JSON.stringify(dataObj, null, 2) + '\n';
    JSON.parse(jsonContent); // 格式驗證 (確保寫入內容為 100% 合法 JSON)

    // 1. 若原始檔案已存在，建立同目錄下 .bak 備份，避免極端異常損毀
    try {
      await fsPromises.copyFile(filePath, `${filePath}.bak`);
    } catch (e) {}

    // 2. 原子性寫入：先寫入 .tmp 暫存檔
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      await fsPromises.writeFile(tempPath, jsonContent, 'utf-8');

      // 3. 原子覆蓋目標檔案
      try {
        await fsPromises.rename(tempPath, filePath);
      } catch (err) {
        // Windows 上若目標檔被暫時鎖定導致 rename 失敗，回退至 copyFile
        await fsPromises.copyFile(tempPath, filePath);
      }
      return true;
    } finally {
      // 確保無論寫入成功或異常失敗，皆銷毀 .tmp 暫存檔，杜絕磁碟垃圾殘留
      await fsPromises.unlink(tempPath).catch(() => {});
    }
  }

  /**
   * 取得當前獨立備註檔所有內容 (自全域配置目錄讀取)
   */
  static async getNotes() {
    return await this.safeReadJson(this.notesFilePath, {});
  }

  /**
   * 儲存備註至獨立備註檔 (儲存至全域配置目錄)
   */
  static async saveNotes(notesObj) {
    await this.safeSaveJson(this.notesFilePath, notesObj);
    return notesObj;
  }

  /**
   * 非同步調用 Python 執行命令 (杜絕同步阻塞 Extension Host 主執行緒)
   */
  static async runPythonAsync(script, args = [], timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!childProcess || !childProcess.execFile) {
        return reject(new Error('child_process 不可用'));
      }
      childProcess.execFile(
        'python',
        ['-c', script, ...args],
        { encoding: 'utf-8', timeout, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            return reject(err);
          }
          resolve(stdout ? stdout.trim() : '');
        }
      );
    });
  }

  /**
   * 讀取 VS Code 原生 MCP 伺服器啟用狀態 (從 state.vscdb 讀取 mcp.enablement)
   * @returns {Promise<Map<string, boolean>>} Map: serverName -> isEnabled
   */
  static async readVsCodeEnablement() {
    const result = new Map();
    const dbPath = this.vsCodeStateDbPath;

    // 1. 優先使用 Node.js 22+ 內建 node:sqlite (原生極速、零相依)
    try {
      if (nodeSqlite && nodeSqlite.DatabaseSync) {
        const db = new nodeSqlite.DatabaseSync(dbPath, { readOnly: true });
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('mcp.enablement');
        db.close();

        if (row && row.value) {
          const arr = JSON.parse(row.value);
          if (Array.isArray(arr)) {
            for (const [key, val] of arr) {
              const prefix = 'mcp.config.usrlocal.';
              if (typeof key === 'string' && key.startsWith(prefix)) {
                const sName = key.substring(prefix.length);
                result.set(sName, val !== false);
              }
            }
          }
        }
        return result;
      }
    } catch (err) {
      console.warn('透過 node:sqlite 讀取 VS Code state.vscdb 失敗，嘗試後備方案:', err.message);
    }

    // 2. 後備方案：非同步調用本機 Python 讀取 SQLite (非阻塞)
    try {
      const pyScript = `import sqlite3, json, sys\ntry:\n conn = sqlite3.connect(sys.argv[1])\n cur = conn.cursor()\n cur.execute("SELECT value FROM ItemTable WHERE key = 'mcp.enablement'")\n row = cur.fetchone()\n print(row[0] if row else "[]")\n conn.close()\nexcept: print("[]")`;
      const out = await this.runPythonAsync(pyScript, [dbPath], 3000);
      const arr = JSON.parse(out || '[]');
      if (Array.isArray(arr)) {
        for (const [key, val] of arr) {
          const prefix = 'mcp.config.usrlocal.';
          if (typeof key === 'string' && key.startsWith(prefix)) {
            result.set(key.substring(prefix.length), val !== false);
          }
        }
      }
      return result;
    } catch (e) {}

    return result;
  }

  /**
   * 寫入 VS Code 原生 MCP 伺服器啟用狀態 (同步寫入 state.vscdb 的 mcp.enablement)
   * @param {Record<string, boolean>} updatesMap - { serverName: isEnabled (true=啟用, false=停用) }
   */
  static async writeVsCodeEnablement(updatesMap) {
    const dbPath = this.vsCodeStateDbPath;

    // 1. 優先使用 node:sqlite 寫入
    try {
      if (nodeSqlite && nodeSqlite.DatabaseSync) {
        const db = new nodeSqlite.DatabaseSync(dbPath);
        const getStmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
        const row = getStmt.get('mcp.enablement');
        let list = (row && row.value) ? JSON.parse(row.value) : [];

        for (const [serverName, isEnabled] of Object.entries(updatesMap)) {
          const fullKey = `mcp.config.usrlocal.${serverName}`;
          // 移除原有紀錄
          list = list.filter(item => item[0] !== fullKey);
          // 若為停用，寫入 false；若為啟用，VS Code 原生預設未在清單中即為啟用 (或可存 true)
          if (!isEnabled) {
            list.push([fullKey, false]);
          }
        }

        const setStmt = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
        setStmt.run('mcp.enablement', JSON.stringify(list));
        db.close();
        return true;
      }
    } catch (err) {
      console.warn('透過 node:sqlite 寫入 VS Code state.vscdb 失敗，嘗試後備方案:', err.message);
    }

    // 2. 後備方案：非同步透過 Python 寫入 (非阻塞)
    try {
      const pyScript = `import sqlite3, json, sys\ntry:\n db_path = sys.argv[1]\n updates = json.loads(sys.argv[2])\n conn = sqlite3.connect(db_path)\n cur = conn.cursor()\n cur.execute("SELECT value FROM ItemTable WHERE key = 'mcp.enablement'")\n row = cur.fetchone()\n data = json.loads(row[0]) if row and row[0] else []\n for name, enabled in updates.items():\n  k = 'mcp.config.usrlocal.' + name\n  data = [x for x in data if x[0] != k]\n  if not enabled: data.append([k, False])\n cur.execute("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('mcp.enablement', ?)", (json.dumps(data),))\n conn.commit()\n conn.close()\n print("OK")\nexcept Exception as e: print("ERR:" + str(e))`;
      const out = await this.runPythonAsync(pyScript, [dbPath, JSON.stringify(updatesMap)], 5000);
      if (out && out.includes('OK')) return true;
    } catch (e) {
      console.error('後備非同步寫入 VS Code state.vscdb 亦失敗:', e.message);
    }

    return false;
  }

  /**
   * 計算伺服器統計數據 (Total, Enabled, Disabled)
   */
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

  /**
   * 取得全域 MCP 配置、統計資訊與外部備註 (純唯讀冪等操作，無寫入副作用)
   */
  static async getGlobalData() {
    const configPath = this.globalConfigPath;
    const notesPath = this.notesFilePath;
    const isVs = this.isVsCode;

    // 1. 讀取原生配置檔與獨立備註檔 (融合外掛目錄原有說明)
    const rawConfig = await this.safeReadJson(configPath, isVs ? { servers: {} } : { mcpServers: {} });
    const notes = await this.getNotes();

    let normalizedServers = {};

    if (isVs) {
      // VS Code: 伺服器定義在 rawConfig.servers，開關狀態自 state.vscdb 讀取
      const servers = rawConfig.servers || {};
      const vsEnablement = await this.readVsCodeEnablement();

      for (const [name, server] of Object.entries(servers)) {
        const note = notes[name] || {};
        // 若 state.vscdb 有紀錄則以資料庫為準，否則以 note 為準，預設為 false (即啟用)
        const isDisabled = vsEnablement.has(name)
          ? !vsEnablement.get(name)
          : (note.disabled === true);

        normalizedServers[name] = {
          ...server,
          serverUrl: server.serverUrl || server.url, // 統一供前端探針測試
          description: note.description || '',
          disabled: isDisabled,
        };
      }
    } else {
      // Antigravity: 伺服器與開關皆直接儲存於 rawConfig.mcpServers
      const servers = rawConfig.mcpServers || {};
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
    }

    const unifiedConfig = {
      ...rawConfig,
      mcpServers: normalizedServers,
    };

    const stats = this.calculateStats(normalizedServers);

    return {
      path: configPath,
      notesPath,
      isVsCode: isVs,
      envName: this.envName,
      config: unifiedConfig,
      stats,
    };
  }

  /**
   * 切換單一伺服器啟用/停用狀態
   */
  static async toggleServer(serverName, disabled) {
    const isVs = this.isVsCode;
    const configPath = this.globalConfigPath;

    if (isVs) {
      // 1. 同步寫入 VS Code 原生資料庫 state.vscdb (mcp.enablement)
      await this.writeVsCodeEnablement({ [serverName]: !disabled });

      // 2. 記錄於 vscode_mcp_notes.json
      const notes = await this.getNotes();
      notes[serverName] = { ...(notes[serverName] || {}), disabled: !!disabled };
      await this.saveNotes(notes);
    } else {
      // Antigravity: 寫入 mcp_config.json
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
    }
  }

  /**
   * 更新單一伺服器的用途說明 (更新至對應的獨立 notes 檔案)
   */
  static async updateServerDescription(serverName, description) {
    const notes = await this.getNotes();
    const trimmed = typeof description === 'string' ? description.trim() : '';

    if (trimmed) {
      notes[serverName] = { ...(notes[serverName] || {}), description: trimmed };
    } else {
      if (notes[serverName]) {
        delete notes[serverName].description;
        if (Object.keys(notes[serverName]).length === 0) {
          delete notes[serverName];
        }
      }
    }

    await this.saveNotes(notes);

    // 若在 Antigravity，也同步順手更新 mcp_config.json 的 description
    if (!this.isVsCode) {
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
  }

  /**
   * 批次切換伺服器狀態 (enableAll / disableAll / invert)
   */
  static async batchToggle(action) {
    const isVs = this.isVsCode;
    const configPath = this.globalConfigPath;

    const isEnable = action === 'enableAll' || action === 'enable_all';
    const isDisable = action === 'disableAll' || action === 'disable_all';
    const isInvert = action === 'invert';

    if (isVs) {
      const rawConfig = await this.safeReadJson(configPath, { servers: {} });
      const serverNames = Object.keys(rawConfig.servers || {});
      const notes = await this.getNotes();
      const vsEnablement = await this.readVsCodeEnablement();
      const updates = {};

      for (const name of serverNames) {
        const currentDisabled = vsEnablement.has(name)
          ? !vsEnablement.get(name)
          : (notes[name]?.disabled === true);

        let newDisabled = currentDisabled;
        if (isEnable) {
          newDisabled = false;
        } else if (isDisable) {
          newDisabled = true;
        } else if (isInvert) {
          newDisabled = !currentDisabled;
        }
        updates[name] = !newDisabled;
        notes[name] = { ...(notes[name] || {}), disabled: newDisabled };
      }

      // 1. 同步寫入 VS Code 原生資料庫 state.vscdb
      await this.writeVsCodeEnablement(updates);
      // 2. 儲存至 notes
      await this.saveNotes(notes);
    } else {
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
    }
  }
}

module.exports = McpConfigService;
