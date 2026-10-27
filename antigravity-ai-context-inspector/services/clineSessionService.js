// ==============================================================================
// 檔案名稱：services/clineSessionService.js
// 功能說明：Cline 對話來源服務（與宿主 IDE 無關，只看 ~/.cline/data）
//   - 資料來源：~/.cline/data/sessions/<sessionId>/{<id>.json, <id>.messages.json}
//     （user 層級，Antigravity / Cursor / VS Code 共用同一份）
//   - 清單只讀 meta（1~3 KB），messages.json 僅在「選取對話」時才讀
//   - > 20 MB 的 messages.json 走串流正則掃描（不做整份 JSON.parse），避免 OOM
//   - 隱私紅線：不讀 secrets.json；globalState.json 只取白名單欄位
//   - 「快照」語意：Cline 足跡還原（實際調用的技能 / MCP / 讀過的規範），
//     不是 Antigravity 那種 session prompt 注入快照
// ==============================================================================

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const ContextScannerService = require('./contextScannerService');

// 超過此大小改用串流掃描（本機最大 messages.json 約 71 MB）
const MAX_PARSE_BYTES = 20 * 1024 * 1024;
// 清單 / 開關狀態快取，避免側邊欄高頻 pushData 反覆掃 300 個資料夾
const CACHE_TTL_MS = 3000;
// 工具輸入中代表「檔案路徑」的欄位名
const PATH_KEYS = new Set([
  'path',
  'filePath',
  'file_path',
  'absolutePath',
  'target_file',
  'directoryPath',
  'cwd'
]);
// Cline 的 skill 工具名稱（新舊版都納入）
const SKILL_TOOL_NAMES = new Set(['skills', 'skill', 'use_skill']);

class ClineSessionService {
  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  /**
   * Cline 資料根目錄。優先序：呼叫端指定（VS Code 設定）> 環境變數（測試）> ~/.cline/data
   */
  static getDataRoot(override) {
    if (typeof override === 'string' && override.trim()) return override.trim();
    const env = process.env.CLINE_DATA_DIR;
    if (typeof env === 'string' && env.trim()) return env.trim();
    return path.join(this.getUserHome(), '.cline', 'data');
  }

  static getSessionsDir(override) {
    return path.join(this.getDataRoot(override), 'sessions');
  }

  /** 只要 sessions 目錄存在，就代表這台機器有 Cline 對話可用（與宿主 IDE 無關） */
  static isAvailable(override) {
    try {
      return fs.existsSync(this.getSessionsDir(override));
    } catch {
      return false;
    }
  }

  /** Windows 上 PowerShell 5.1 等工具可能寫入 UTF-8 BOM，JSON.parse 不接受 */
  static parseJsonText(content) {
    const text = typeof content === 'string' ? content.replace(/^\uFEFF/, '') : content;
    return JSON.parse(text);
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

  /** 對話標題：去標籤、壓空白、截長度；沒有標題時給可辨識的短 ID */
  static _cleanTitle(raw, sessionId) {
    let title = String(raw || '')
      .replace(/<user_input[^>]*>/gi, ' ')
      .replace(/<\/user_input>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) title = `Cline 對話 (${String(sessionId || '').slice(-8)})`;
    return title.length > 90 ? `${title.slice(0, 90)}…` : title;
  }

  static _buildListItem(meta, stat, sessionId, sessionDir, workspaceRoot) {
    const metadata = meta.metadata || {};
    const usage = metadata.usage || metadata.aggregateUsage || {};
    const started = Date.parse(meta.started_at || '') || 0;
    const ended = Date.parse(meta.ended_at || '') || 0;
    const mtime = ended || started || stat.mtimeMs;

    return {
      id: sessionId,
      source: 'cline',
      title: this._cleanTitle(metadata.title || meta.prompt, sessionId),
      workspace: workspaceRoot ? ContextScannerService.formatWorkspaceName(workspaceRoot) : '',
      workspaceRoot,
      mtime,
      mtimeStr: mtime ? new Date(mtime).toLocaleString() : '',
      metaPath: path.join(sessionDir, `${sessionId}.json`),
      messagesPath: path.join(sessionDir, `${sessionId}.messages.json`),
      model: meta.model || metadata.modelId || '',
      provider: meta.provider || '',
      status: meta.status || '',
      host: meta.source || '',
      usage: {
        tokensIn: Number(metadata.tokensIn || usage.inputTokens || 0),
        tokensOut: Number(metadata.tokensOut || usage.outputTokens || 0),
        cacheReads: Number(metadata.cacheReads || usage.cacheReadTokens || 0),
        totalCost: Number(metadata.totalCost || usage.totalCost || 0)
      }
    };
  }

  /**
   * 列出 Cline 歷史對話（只讀 meta）。
   * @param {Array} workspaceFolders 目前開啟的工作區資料夾
   * @param {Object} options { scope: 'workspace'|'all', clineDataDir }
   */
  static async getConversationsList(workspaceFolders = [], options = {}) {
    const sessionsDir = this.getSessionsDir(options.clineDataDir);
    if (!fs.existsSync(sessionsDir)) return [];

    const scope = options.scope === 'all' ? 'all' : 'workspace';
    const wsKeys = scope === 'all' ? new Set() : this._workspaceKeySet(workspaceFolders);
    const cacheKey = `${sessionsDir.toLowerCase()}|${scope}|${[...wsKeys].sort().join(';')}`;
    const cached = this._listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.items;

    let entries = [];
    try {
      entries = await fsPromises.readdir(sessionsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionId = entry.name;
      const sessionDir = path.join(sessionsDir, sessionId);
      const metaPath = path.join(sessionDir, `${sessionId}.json`);

      let stat = null;
      try {
        stat = await fsPromises.stat(metaPath);
      } catch {
        continue; // 沒有 meta 的半成品 session 直接略過（絕不改讀 messages.json）
      }

      const metaCacheKey = metaPath.toLowerCase();
      const metaCached = this._metaCache.get(metaCacheKey);
      let meta = null;
      if (metaCached && metaCached.mtimeMs === stat.mtimeMs) {
        meta = metaCached.meta;
      } else {
        try {
          meta = this.parseJsonText(await fsPromises.readFile(metaPath, 'utf-8'));
        } catch {
          meta = null;
        }
        this._metaCache.set(metaCacheKey, { mtimeMs: stat.mtimeMs, meta });
      }
      if (!meta || typeof meta !== 'object') continue;

      const workspaceRoot = String(meta.workspace_root || meta.cwd || '');
      // workspaceFolders 為空時不篩選，避免「空視窗 → 清單全空」
      if (wsKeys.size > 0 && !wsKeys.has(this._normPath(workspaceRoot))) continue;

      items.push(this._buildListItem(meta, stat, sessionId, sessionDir, workspaceRoot));
    }

    items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    if (this._listCache.size > 8) this._listCache.clear();
    this._listCache.set(cacheKey, { at: Date.now(), items });
    return items;
  }

  /**
   * 讀取 Cline 開關狀態（rules / skills / workflows 的 enabled map）。
   * 全部 key 都是絕對檔案路徑，因此不必知道 workspaceState 目錄與工作區的對應關係。
   */
  static readToggles(options = {}) {
    const dataRoot = this.getDataRoot(options.clineDataDir);
    const cacheKey = dataRoot.toLowerCase();
    const cached = this._toggleCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const pathMap = new Map();
    const apply = (toggles) => {
      if (!toggles || typeof toggles !== 'object') return;
      for (const [rawPath, enabled] of Object.entries(toggles)) {
        if (typeof enabled !== 'boolean') continue;
        const key = this._normPath(rawPath);
        if (key) pathMap.set(key, enabled);
      }
    };

    const globalState = this._readJsonSync(path.join(dataRoot, 'globalState.json')) || {};
    // 全域先套，再由各工作區覆蓋（local 優先）
    apply(globalState.globalClineRulesToggles);
    apply(globalState.globalSkillsToggles);
    apply(globalState.globalWorkflowToggles);
    apply(globalState.remoteRulesToggles);
    apply(globalState.remoteSkillsToggles);
    apply(globalState.remoteWorkflowToggles);

    const workspacesDir = path.join(dataRoot, 'workspaces');
    let entries = [];
    try {
      entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = this._readJsonSync(path.join(workspacesDir, entry.name, 'workspaceState.json'));
      if (!state) continue;
      apply(state.localClineRulesToggles);
      apply(state.localAgentsRulesToggles);
      apply(state.localCursorRulesToggles);
      apply(state.localWindsurfRulesToggles);
      apply(state.localSkillsToggles);
      apply(state.workflowToggles);
    }

    const value = { pathMap, globalState };
    if (this._toggleCache.size > 4) this._toggleCache.clear();
    this._toggleCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  static _readJsonSync(filePath) {
    try {
      return this.parseJsonText(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 將開關狀態標注到掃描結果（isEnabled），並回傳統計。
   * 未出現在開關表中的項目視為啟用（Cline 預設全開）。
   */
  static applyToggleState(env, toggles) {
    const pathMap = toggles?.pathMap || new Map();
    const stats = { enabledRules: 0, disabledRules: 0, enabledSkills: 0, disabledSkills: 0 };
    if (!env) return stats;

    const annotate = (item, kind) => {
      if (!item) return;
      const key = this._normPath(item.filePath);
      const enabled = key && pathMap.has(key) ? pathMap.get(key) : true;
      item.isEnabled = enabled;
      if (kind === 'rules') {
        if (enabled) stats.enabledRules += 1;
        else stats.disabledRules += 1;
      } else if (enabled) {
        stats.enabledSkills += 1;
      } else {
        stats.disabledSkills += 1;
      }
    };

    for (const rule of env.rules?.alwaysActive || []) annotate(rule, 'rules');
    for (const rule of env.rules?.conditional || []) annotate(rule, 'rules');
    for (const group of ['workspace', 'global', 'extension', 'builtin']) {
      for (const skill of env.skills?.[group] || []) annotate(skill, 'skills');
    }
    return stats;
  }

  /**
   * 快照掃描用的工作區根目錄：以「該對話自己的工作區」為準。
   * ⚠️ 不可直接用目前開著的 workspaceFolders：Cline 的常駐規範 / 技能是依 session
   * 的 cwd 準備的，開著 A 視窗看 B 對話時會列出完全無關的規範；多根視窗更會把
   * 每一根的 AGENTS.md / .clinerules 全部列進來。
   * 只有在 meta 沒有 workspace_root / cwd 時（極舊格式）才退回目前工作區。
   */
  static _snapshotRoots(workspaceRoot, workspaceFolders = []) {
    const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
    if (!root) return workspaceFolders;
    return [{ uri: { fsPath: root }, name: ContextScannerService.formatWorkspaceName(root) }];
  }

  /**
   * 解析單一對話的「Cline 足跡」
   * @param {string|null} conversationId Cline session id（不含來源前綴）
   */
  static async parseConversationSnapshot(conversationId = null, workspaceFolders = [], options = {}) {
    const list = await this.getConversationsList(workspaceFolders, options);
    const scanOptions = {
      isVsCode: true,
      isCursor: false,
      cline: true,
      clineDataDir: options.clineDataDir,
      appRoot: options.appRoot,
      extensionSkillDirs: options.extensionSkillDirs || []
    };

    if (list.length === 0) {
      const empty = await ContextScannerService.scanLiveEnvironment(workspaceFolders, scanOptions);
      const stats = this.applyToggleState(empty, this.readToggles(options));
      return {
        ...empty,
        mode: 'snapshot',
        sourceId: 'cline',
        conversationId: null,
        conversationTitle: '',
        model: null,
        rules: { alwaysActive: [], conditional: [] },
        skills: { workspace: [], global: [], builtin: [], extension: [] },
        mcpServers: [],
        clineSettings: this._buildSettings(options, stats),
        error: '找不到任何 Cline 對話紀錄'
      };
    }

    const target = (conversationId && list.find((item) => item.id === conversationId)) || list[0];
    const footprint = await this._readFootprint(target);
    const toggles = this.readToggles(options);
    // 環境一律以「該對話自己的工作區」掃描（見 _snapshotRoots 的說明）
    const baseEnv = await ContextScannerService.scanLiveEnvironment(
      this._snapshotRoots(target.workspaceRoot, workspaceFolders),
      scanOptions
    );
    const stats = this.applyToggleState(baseEnv, toggles);

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

    // 1. 常駐規範：Cline 目前「啟用中」的規範就是每次對話的固定輸入（關閉者不列入）
    const alwaysActive = [];
    const conditional = [];
    for (const rule of baseEnv.rules?.alwaysActive || []) {
      if (rule.isEnabled === false) continue;
      alwaysActive.push({ ...rule, isInvoked: isPathInvoked(rule.filePath) });
    }
    // 2. 條件式規範：只有對話中實際被讀取的才算觸發
    for (const rule of baseEnv.rules?.conditional || []) {
      if (!isPathInvoked(rule.filePath)) continue;
      conditional.push({ ...rule, isInvoked: true });
    }

    // 3. 技能：以 skills 工具呼叫名或 SKILL.md 被讀取為準
    const pickInvokedSkills = (group) => (baseEnv.skills?.[group] || [])
      .filter((skill) => skill.isEnabled !== false && isSkillInvoked(skill))
      .map((skill) => ({ ...skill, isInvoked: true }));
    const skills = {
      workspace: pickInvokedSkills('workspace'),
      global: pickInvokedSkills('global'),
      extension: pickInvokedSkills('extension'),
      builtin: pickInvokedSkills('builtin')
    };

    // 4. MCP：以 <server>__<tool> 前綴比對，只保留實際被呼叫的伺服器與工具
    const invokedServerKeys = new Set([...footprint.mcpServers].map((name) => this._serverKey(name)));
    const mcpServers = (baseEnv.mcpServers || []).map((server) => {
      const invoked = invokedServerKeys.has(this._serverKey(server.name));
      if (!invoked) return { ...server, isInvoked: false, tools: [] };
      const calledTools = this._findCalledTools(footprint, server.name);
      return {
        ...server,
        isInvoked: true,
        toolCount: calledTools.length || server.toolCount || 0,
        tools: calledTools
      };
    });

    // 4b. 設定檔中已被移除、但對話中確實呼叫過的伺服器仍需呈現（足跡才誠實）
    const knownServerKeys = new Set(mcpServers.map((server) => this._serverKey(server.name)));
    for (const [serverName, toolIds] of footprint.mcpTools) {
      const key = this._serverKey(serverName);
      if (!key || knownServerKeys.has(key)) continue;
      knownServerKeys.add(key);
      const toolNames = [];
      for (const toolId of toolIds) {
        const index = toolId.indexOf('__');
        const shortName = index >= 0 ? toolId.slice(index + 2) : toolId;
        if (shortName && !toolNames.includes(shortName)) toolNames.push(shortName);
      }
      mcpServers.push({
        name: serverName,
        scope: 'Cline',
        path: '',
        toolCount: toolNames.length,
        tools: toolNames.map((name) => ({ name, description: '', isInvoked: true })),
        hasInstructions: false,
        instructionsPath: null,
        transport: '',
        command: '',
        args: [],
        url: '',
        isInvoked: true
      });
    }

    return {
      mode: 'snapshot',
      sourceId: 'cline',
      conversationId: target.id,
      conversationTitle: target.title,
      timestamp: new Date(target.mtime).toISOString(),
      model: target.model || null,
      provider: target.provider || '',
      status: target.status || '',
      host: target.host || '',
      usage: target.usage,
      footprint: {
        degraded: footprint.degraded,
        messageCount: footprint.messages,
        toolCount: footprint.tools.size
      },
      clineSettings: this._buildSettings(options, stats, toggles),
      rules: { alwaysActive, conditional },
      skills,
      mcpServers,
      workspaces: baseEnv.workspaces || []
    };
  }

  static _buildSettings(options = {}, stats = {}, toggles = null) {
    const state = (toggles || this.readToggles(options)).globalState || {};
    return {
      ...stats,
      clineVersion: state.clineVersion || '',
      mode: state.mode || '',
      planProvider: state.planModeApiProvider || '',
      actProvider: state.actModeApiProvider || '',
      planModel: state.planModeClinePassModelId || state.planModeClineModelId
        || state.planModeOpenAiModelId || state.planModeOpenRouterModelId
        || state.planModeApiModelId || '',
      actModel: state.actModeClinePassModelId || state.actModeClineModelId
        || state.actModeOpenAiModelId || state.actModeOpenRouterModelId
        || state.actModeApiModelId || '',
      autoCondense: state.useAutoCondense === true,
      checkpoints: state.enableCheckpointsSetting === true,
      hooks: state.hooksEnabled === true
    };
  }

  // ── messages.json 足跡抽取 ─────────────────────────────────────────────────

  static async _readFootprint(target) {
    const result = {
      tools: new Set(),
      skills: new Set(),
      paths: new Set(),
      mcpServers: new Set(),
      mcpTools: new Map(),
      messages: 0,
      degraded: false
    };
    const filePath = target?.messagesPath;
    if (!filePath || !fs.existsSync(filePath)) return result;

    let stat = null;
    try {
      stat = await fsPromises.stat(filePath);
    } catch {
      return result;
    }

    if (stat.size <= MAX_PARSE_BYTES) {
      try {
        const parsed = this.parseJsonText(await fsPromises.readFile(filePath, 'utf-8'));
        this._consumeMessages(parsed, result);
        return result;
      } catch {
        // JSON 壞掉或被截斷 → 退回串流掃描
      }
    }

    result.degraded = true;
    await this._scanMessagesStream(filePath, result);
    return result;
  }

  static _consumeMessages(parsed, result) {
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    result.messages = messages.length;
    for (const message of messages) {
      const blocks = Array.isArray(message?.content) ? message.content : [];
      for (const block of blocks) {
        if (!block || block.type !== 'tool_use') continue;
        const toolName = String(block.name || '');
        if (!toolName) continue;
        this._consumeToolUse(toolName, block.input || {}, result);
      }
    }
  }

  static _consumeToolUse(toolName, input, result) {
    result.tools.add(toolName);

    const mcp = this._splitMcpToolName(toolName);
    if (mcp) {
      result.mcpServers.add(mcp.server);
      this._registerMcpTool(result, mcp.server, toolName);
    }

    // 舊版 Cline 的通用 MCP 呼叫工具
    if (toolName === 'use_mcp_tool') {
      const server = typeof input.server_name === 'string' ? input.server_name.trim() : '';
      const tool = typeof input.tool_name === 'string' ? input.tool_name.trim() : '';
      if (server) {
        result.mcpServers.add(server);
        this._registerMcpTool(result, server, tool ? `${server}__${tool}` : server);
      }
    }

    if (SKILL_TOOL_NAMES.has(toolName)) {
      const names = [];
      for (const key of ['skill', 'skill_name', 'name']) {
        if (typeof input[key] === 'string') names.push(input[key]);
      }
      if (Array.isArray(input.skills)) {
        for (const item of input.skills) {
          if (typeof item === 'string') names.push(item);
          else if (item && typeof item.name === 'string') names.push(item.name);
        }
      }
      for (const name of names) {
        const trimmed = String(name).trim().toLowerCase();
        if (trimmed) result.skills.add(trimmed);
      }
    }

    this._collectPaths(input, result.paths, 0);
  }

  static _registerMcpTool(result, server, toolId) {
    if (!result.mcpTools.has(server)) result.mcpTools.set(server, new Set());
    result.mcpTools.get(server).add(toolId);
  }

  static _splitMcpToolName(toolName) {
    const index = toolName.indexOf('__');
    if (index <= 0 || index >= toolName.length - 2) return null;
    return { server: toolName.slice(0, index), tool: toolName.slice(index + 2) };
  }

  static _collectPaths(node, target, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) this._collectPaths(item, target, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        if (PATH_KEYS.has(key) && value.trim()) target.add(value.trim());
        continue;
      }
      if (value && typeof value === 'object') this._collectPaths(value, target, depth + 1);
    }
  }

  /**
   * > 20 MB 的 messages.json：逐行串流掃描，記憶體用量與檔案大小無關。
   * 只取「工具名 / skill 名 / 路徑」三類足跡，容許少量誤判。
   */
  static async _scanMessagesStream(filePath, result) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const pathRegex = /"(path|filePath|file_path|absolutePath|target_file|directoryPath)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const skillRegex = /"(?:skill|skill_name)"\s*:\s*"([^"]+)"/;
    let blockType = '';
    let currentTool = '';

    try {
      for await (const line of rl) {
        const typeMatch = line.match(/^\s*"type"\s*:\s*"([^"]+)"/);
        if (typeMatch) {
          blockType = typeMatch[1];
          currentTool = '';
          if (blockType !== 'tool_use') continue;
        }
        if (blockType !== 'tool_use') continue;

        const nameMatch = line.match(/^\s*"name"\s*:\s*"([^"]+)"/);
        if (nameMatch && !currentTool) {
          currentTool = nameMatch[1];
          this._consumeToolUse(currentTool, {}, result);
          continue;
        }

        const skillMatch = line.match(skillRegex);
        if (skillMatch && currentTool) {
          const skillName = skillMatch[1].trim().toLowerCase();
          if (skillName) result.skills.add(skillName);
        }

        pathRegex.lastIndex = 0;
        let pathMatch;
        while ((pathMatch = pathRegex.exec(line)) !== null) {
          const value = this._unescapeJsonString(pathMatch[2]);
          if (value) result.paths.add(value);
        }
      }
    } catch {
      // 串流中斷時保留已取得的足跡
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  static _unescapeJsonString(raw) {
    try {
      return JSON.parse(`"${raw}"`);
    } catch {
      return raw.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    }
  }

  /** MCP 伺服器名稱正規化：忽略大小寫、符號與結尾的 mcp 字樣 */
  static _serverKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/mcp$/, '');
  }

  static _findCalledTools(footprint, serverName) {
    const key = this._serverKey(serverName);
    const tools = [];
    const seen = new Set();
    for (const [server, toolIds] of footprint.mcpTools) {
      if (this._serverKey(server) !== key) continue;
      for (const toolId of toolIds) {
        const index = toolId.indexOf('__');
        const shortName = index >= 0 ? toolId.slice(index + 2) : toolId;
        const lower = shortName.toLowerCase();
        if (!shortName || seen.has(lower)) continue;
        seen.add(lower);
        tools.push({ name: shortName, description: '', isInvoked: true });
      }
    }
    return tools;
  }
}

ClineSessionService._listCache = new Map();
ClineSessionService._metaCache = new Map();
ClineSessionService._toggleCache = new Map();

module.exports = ClineSessionService;
