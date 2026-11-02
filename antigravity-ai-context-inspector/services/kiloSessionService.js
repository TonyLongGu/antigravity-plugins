// ==============================================================================
// 檔案名稱：services/kiloSessionService.js
// 功能說明：Kilo Code 對話來源服務（與宿主 IDE 無關，只看 ~/.local/share/kilo）
//   - 資料來源：`kilo.db`（SQLite）的 session / message / part 三張表
//     （Kilo Code 7.x 起改用 opencode 架構，對話不再是「一資料夾＝一對話」）
//   - 清單只查 session 表；足跡（讀過的路徑／技能／MCP 工具）才讀 part 表
//   - 只用 node:sqlite 以 **唯讀** 開啟；宿主 Node 不支援時 isAvailable() 回 false
//   - 隱私紅線：不讀 auth.json／mcp-auth.json，也不輸出工具輸入的完整內容
//   - 「快照」語意與 Cline 相同：還原該對話實際調用的技能／MCP／讀過的規範
// ==============================================================================

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ContextScannerService = require('./contextScannerService');

// 清單快取，避免側邊欄高頻刷新時反覆查 DB
const CACHE_TTL_MS = 3000;
// 工具輸入中代表「檔案路徑」的欄位名（與 ClineSessionService 對齊）
const PATH_KEYS = new Set([
  'path',
  'filePath',
  'file_path',
  'absolutePath',
  'target_file',
  'directoryPath',
  'cwd'
]);
// Kilo 的技能工具名稱
const SKILL_TOOL_NAMES = new Set(['skills', 'skill', 'use_skill']);

class KiloSessionService {
  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  /** Kilo 資料家目錄（XDG data；kilo.db 與 storage/ 都在這裡） */
  static getDataHome() {
    const xdgDataHome = process.env.XDG_DATA_HOME || path.join(this.getUserHome(), '.local', 'share');
    return path.join(xdgDataHome, 'kilo');
  }

  static getDbPath() {
    return path.join(this.getDataHome(), 'kilo.db');
  }

  /** node:sqlite 只在 Node 22.13+ 無旗標可用；拿不到就視為不支援 */
  static _loadSqlite() {
    try {
      return require('node:sqlite').DatabaseSync;
    } catch {
      return null;
    }
  }

  /** 只要 kilo.db 存在且執行環境能讀 SQLite，就代表這台機器有 Kilo 對話可用 */
  static isAvailable() {
    try {
      return Boolean(this._loadSqlite()) && fs.existsSync(this.getDbPath());
    } catch {
      return false;
    }
  }

  /**
   * 以唯讀模式開啟 DB 執行查詢；任何錯誤都回 null（呼叫端據此降級，不可讓側邊欄壞掉）
   * @param {(db:any)=>any} fn
   */
  static _withDb(fn) {
    const DatabaseSync = this._loadSqlite();
    if (!DatabaseSync) return null;
    let db = null;
    try {
      db = new DatabaseSync(this.getDbPath(), { readOnly: true });
      return fn(db);
    } catch (err) {
      console.error('Kilo DB error:', err.message);
      return null;
    } finally {
      try {
        if (db) db.close();
      } catch {}
    }
  }

  static _normPath(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
    } catch {
      return value.replace(/[\\/]+$/, '').toLowerCase();
    }
  }

  static _workspaceKeySet(workspaceFolders = []) {
    const keys = new Set();
    for (const folder of workspaceFolders || []) {
      const folderPath = typeof folder === 'string'
        ? folder
        : (folder?.uri?.fsPath || folder?.path || '');
      const key = this._normPath(folderPath);
      if (key) keys.add(key);
    }
    return keys;
  }

  static _cleanTitle(raw, session) {
    let title = String(raw || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      const slug = String(session?.slug || '').trim();
      const shortId = String(session?.id || '').slice(-8);
      title = `Kilo 對話 (${slug || shortId})`;
    }
    return title.length > 90 ? `${title.slice(0, 90)}…` : title;
  }

  /**
   * Kilo 的 model 欄位是 JSON 字串（`{"id":"…","providerID":"…","variant":"…"}`），
   * UI 只該顯示模型名稱，因此一律正規化成 `{ model, provider }`。
   */
  static _parseModel(raw) {
    if (!raw) return { model: '', provider: '' };
    if (typeof raw === 'object') {
      return {
        model: String(raw.id || raw.modelID || raw.name || raw.model || ''),
        provider: String(raw.providerID || raw.provider || '')
      };
    }
    const text = String(raw).trim();
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        return {
          model: String(parsed.id || parsed.modelID || parsed.name || parsed.model || ''),
          provider: String(parsed.providerID || parsed.provider || '')
        };
      } catch {}
    }
    return { model: text, provider: '' };
  }

  /**
   * session.model 可能為空（早期對話或 CLI 未寫入），此時退回第一則帶模型的訊息。
   * 一次掃完 message 表（本機僅數百列），避免每筆對話各查一次。
   */
  static _collectMessageModels(db) {
    const map = new Map();
    try {
      const rows = db.prepare(`
        SELECT session_id,
               json_extract(data, '$.modelID') AS mid,
               json_extract(data, '$.model.modelID') AS mid2,
               json_extract(data, '$.model.id') AS mid3,
               json_extract(data, '$.providerID') AS pid,
               json_extract(data, '$.model.providerID') AS pid2,
               time_created
        FROM message
        ORDER BY time_created ASC
      `).all();
      for (const row of rows) {
        if (map.has(row.session_id)) continue;
        const model = row.mid || row.mid2 || row.mid3 || '';
        const provider = row.pid || row.pid2 || '';
        if (model || provider) map.set(row.session_id, { model, provider });
      }
    } catch {}
    return map;
  }

  static _buildListItem(row, fallbackModel = null) {
    const mtime = Number(row.time_updated || row.time_created || 0);
    const workspaceRoot = String(row.directory || '');
    const parsed = this._parseModel(row.model);
    return {
      id: String(row.id),
      source: 'kilo',
      title: this._cleanTitle(row.title, row),
      workspace: workspaceRoot ? ContextScannerService.formatWorkspaceName(workspaceRoot) : '',
      workspaceRoot,
      mtime,
      mtimeStr: mtime ? new Date(mtime).toLocaleString() : '',
      model: parsed.model || fallbackModel?.model || '',
      provider: parsed.provider || fallbackModel?.provider || '',
      status: '',
      usage: {
        tokensIn: Number(row.tokens_input || 0),
        tokensOut: Number(row.tokens_output || 0),
        cacheReads: Number(row.tokens_cache_read || 0),
        totalCost: Number(row.cost || 0)
      }
    };
  }

  /**
   * 列出 Kilo 歷史對話（只查 session 表）。
   * @param {Array} workspaceFolders 目前開啟的工作區資料夾
   * @param {Object} options { scope: 'workspace'|'all' }
   */
  static async getConversationsList(workspaceFolders = [], options = {}) {
    const scope = options.scope === 'all' ? 'all' : 'workspace';
    const folderKey = (workspaceFolders || [])
      .map((folder) => (typeof folder === 'string' ? folder : (folder?.uri?.fsPath || folder?.path || '')))
      .join(';');
    const cacheKey = `kilo|${scope}|${folderKey}`;
    const cached = this._listCache?.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.items;

    const data = this._withDb((db) => {
      const rows = db.prepare(`
        SELECT id, directory, title, slug, model, cost,
               tokens_input, tokens_output, tokens_cache_read,
               time_created, time_updated
        FROM session
        ORDER BY time_updated DESC
        LIMIT 500
      `).all();
      return { rows, messageModels: this._collectMessageModels(db) };
    });
    if (!data) return [];

    const wsKeys = this._workspaceKeySet(workspaceFolders);
    const items = data.rows
      .filter((row) => scope === 'all' || wsKeys.has(this._normPath(row.directory)))
      .map((row) => this._buildListItem(row, data.messageModels.get(row.id)));

    if (!this._listCache) this._listCache = new Map();
    if (this._listCache.size > 12) this._listCache.clear();
    this._listCache.set(cacheKey, { at: Date.now(), items });
    return items;
  }

  /**
   * 讀取單一對話的足跡：工具輸入中的路徑、技能呼叫、MCP 工具呼叫、patch 檔案。
   * 只挑 tool／patch 兩種 part，避免把 base64 圖片等大型資料載入記憶體。
   */
  static _readFootprint(sessionId) {
    const footprint = {
      paths: new Set(),
      skills: new Set(),
      mcpTools: new Map(),
      tools: new Set(),
      messages: 0,
      degraded: false
    };

    const data = this._withDb((db) => {
      const countRow = db.prepare('SELECT COUNT(*) AS count FROM message WHERE session_id = ?').get(sessionId);
      const parts = db.prepare(`
        SELECT data FROM part
        WHERE session_id = ? AND json_extract(data, '$.type') IN ('tool', 'patch')
      `).all(sessionId);
      return { messages: Number(countRow && countRow.count) || 0, parts };
    });

    if (!data) {
      footprint.degraded = true;
      return footprint;
    }
    footprint.messages = data.messages;

    for (const row of data.parts) {
      let part = null;
      try {
        part = JSON.parse(row.data);
      } catch {
        continue;
      }
      if (!part || typeof part !== 'object') continue;

      if (part.type === 'patch' && Array.isArray(part.files)) {
        for (const file of part.files) {
          if (typeof file === 'string') footprint.paths.add(file);
        }
        continue;
      }

      if (part.type !== 'tool') continue;
      const toolName = String(part.tool || '');
      if (!toolName) continue;
      footprint.tools.add(toolName);

      const input = part.state?.input || {};
      this._collectPaths(input, footprint.paths);

      if (SKILL_TOOL_NAMES.has(toolName)) {
        const skill = input.name || input.skill || input.skill_name || input.id;
        if (skill) footprint.skills.add(String(skill).toLowerCase());
      }

      // Kilo 的 MCP 工具命名為 `<server>_<tool>`（伺服器名稱本身可能含底線），
      // 因此不自行切字，改由呼叫端用已知伺服器名稱做前綴比對。
      const existing = footprint.mcpTools.get(toolName) || new Set();
      existing.add(toolName);
      footprint.mcpTools.set(toolName, existing);
    }

    return footprint;
  }

  static _collectPaths(node, target, depth = 0) {
    if (node == null || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) this._collectPaths(item, target, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (PATH_KEYS.has(key)) {
        if (typeof value === 'string') target.add(value);
        else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string') target.add(item);
          }
        }
      } else if (value && typeof value === 'object') {
        this._collectPaths(value, target, depth + 1);
      }
    }
  }

  /** 伺服器名稱正規化（比對 `<server>_<tool>` 前綴用） */
  static _serverKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  static _toolBelongsToServer(toolName, serverKey) {
    if (!serverKey) return false;
    const key = this._serverKey(toolName);
    return key === serverKey || key.startsWith(serverKey);
  }

  /** 快照掃描範圍：一律用「該對話自己的工作區」，不要用目前開著的視窗 */
  static _snapshotRoots(workspaceRoot, workspaceFolders = []) {
    const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
    if (!root) return workspaceFolders;
    return [{ uri: { fsPath: root }, name: ContextScannerService.formatWorkspaceName(root) }];
  }

  /**
   * 解析單一 Kilo 對話的足跡。
   * @param {string|null} conversationId Kilo session id（ses_…）
   */
  static async parseConversationSnapshot(conversationId = null, workspaceFolders = [], options = {}) {
    const scanOptions = {
      isVsCode: false,
      isCursor: false,
      kilo: true,
      appRoot: options.appRoot,
      extensionSkillDirs: options.extensionSkillDirs || []
    };
    const list = await this.getConversationsList(workspaceFolders, options);

    if (list.length === 0) {
      const empty = await ContextScannerService.scanLiveEnvironment(workspaceFolders, scanOptions);
      return {
        ...empty,
        mode: 'snapshot',
        sourceId: 'kilo',
        conversationId: null,
        conversationTitle: '',
        model: null,
        rules: { alwaysActive: [], conditional: [] },
        skills: { workspace: [], global: [], builtin: [], extension: [] },
        mcpServers: [],
        error: '找不到任何 Kilo 對話紀錄'
      };
    }

    const target = (conversationId && list.find((item) => item.id === conversationId)) || list[0];
    const footprint = this._readFootprint(target.id);
    const baseEnv = await ContextScannerService.scanLiveEnvironment(
      this._snapshotRoots(target.workspaceRoot, workspaceFolders),
      scanOptions
    );

    const isPathInvoked = (filePath) => {
      const key = this._normPath(filePath);
      if (!key) return false;
      for (const touched of footprint.paths) {
        if (this._normPath(touched) === key) return true;
      }
      return false;
    };
    const isSkillInvoked = (skill) => {
      const names = [skill.name, skill.dirName]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (names.some((name) => footprint.skills.has(name))) return true;
      return isPathInvoked(skill.filePath);
    };

    const alwaysActive = [];
    const conditional = [];
    for (const rule of baseEnv.rules?.alwaysActive || []) {
      if (rule.isEnabled === false) continue;
      alwaysActive.push({ ...rule, isInvoked: isPathInvoked(rule.filePath) });
    }
    for (const rule of baseEnv.rules?.conditional || []) {
      if (!isPathInvoked(rule.filePath)) continue;
      conditional.push({ ...rule, isInvoked: true });
    }

    const pickInvokedSkills = (group) => (baseEnv.skills?.[group] || [])
      .filter((skill) => skill.isEnabled !== false && isSkillInvoked(skill))
      .map((skill) => ({ ...skill, isInvoked: true }));
    const skills = {
      workspace: pickInvokedSkills('workspace'),
      global: pickInvokedSkills('global'),
      extension: pickInvokedSkills('extension'),
      builtin: pickInvokedSkills('builtin')
    };

    const mcpServers = (baseEnv.mcpServers || []).map((server) => {
      const key = this._serverKey(server.name);
      const calledTools = [];
      for (const [toolName] of footprint.mcpTools) {
        if (!this._toolBelongsToServer(toolName, key)) continue;
        if (!calledTools.some((tool) => tool.name === toolName)) {
          calledTools.push({ name: toolName, description: '', isInvoked: true });
        }
      }
      if (calledTools.length === 0) return { ...server, isInvoked: false, tools: [] };
      return {
        ...server,
        isInvoked: true,
        toolCount: calledTools.length,
        tools: calledTools
      };
    });

    return {
      mode: 'snapshot',
      sourceId: 'kilo',
      conversationId: target.id,
      conversationTitle: target.title,
      timestamp: new Date(target.mtime).toISOString(),
      model: target.model || null,
      provider: target.provider || '',
      status: target.status || '',
      usage: target.usage,
      footprint: {
        degraded: footprint.degraded,
        messageCount: footprint.messages,
        toolCount: footprint.tools.size
      },
      rules: { alwaysActive, conditional },
      skills,
      mcpServers,
      workspaces: baseEnv.workspaces || []
    };
  }
}

module.exports = KiloSessionService;
