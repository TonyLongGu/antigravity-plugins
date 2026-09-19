const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const ContextScannerService = require('./contextScannerService');

class CursorTranscriptService {
  static _convCache = new Map();
  static _titleMapCache = { stamp: 0, map: new Map() };

  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  static getCursorUserDir() {
    const roaming = process.env.APPDATA || path.join(this.getUserHome(), 'AppData', 'Roaming');
    return path.join(roaming, 'Cursor', 'User');
  }

  static getProjectsDir() {
    return path.join(this.getUserHome(), '.cursor', 'projects');
  }

  /**
   * 將工作區路徑轉成 Cursor projects 資料夾名稱（d:\PJ\Ai\ai -> d-PJ-Ai-ai）
   */
  static toProjectSlug(fsPath) {
    if (!fsPath || typeof fsPath !== 'string') return '';
    return fsPath
      .replace(/\\/g, '/')
      .replace(/^([A-Za-z]):/, (_, drive) => drive.toLowerCase())
      .replace(/^\//, '')
      .replace(/[:/]+/g, '-');
  }

  static isIgnoredProjectName(name) {
    if (!name) return true;
    if (/^\d+$/.test(name)) return true;
    if (name === 'empty-window') return true;
    if (/^C-Users-.*-AppData-Local-Temp-/i.test(name)) return true;
    if (/^c-Users-.*-AppData-Roaming-/i.test(name)) return true;
    return false;
  }

  static async resolveProjectDirs(workspaceFolders = []) {
    const projectsRoot = this.getProjectsDir();
    if (!fs.existsSync(projectsRoot)) return [];

    const wanted = new Set();
    for (const folder of workspaceFolders) {
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      if (folderPath) wanted.add(this.toProjectSlug(folderPath).toLowerCase());
    }

    let entries = [];
    try {
      entries = await fsPromises.readdir(projectsRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    const matched = [];
    const fallback = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || this.isIgnoredProjectName(entry.name)) continue;
      const transcriptsDir = path.join(projectsRoot, entry.name, 'agent-transcripts');
      if (!fs.existsSync(transcriptsDir)) continue;
      const item = { name: entry.name, transcriptsDir };
      if (wanted.has(entry.name.toLowerCase())) {
        matched.push(item);
      } else {
        fallback.push(item);
      }
    }

    return matched.length > 0 ? matched : fallback;
  }

  static workspaceLabel(projectName, workspaceFolders = []) {
    for (const folder of workspaceFolders) {
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      if (folderPath && this.toProjectSlug(folderPath).toLowerCase() === projectName.toLowerCase()) {
        return ContextScannerService.formatWorkspaceName(folderPath);
      }
    }
    return projectName || '';
  }

  static extractUserQuery(text) {
    if (!text) return '';
    const unescaped = String(text).replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ');
    const queryMatch = unescaped.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
    let raw = queryMatch ? queryMatch[1] : unescaped;
    raw = raw.replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, '');
    raw = raw.replace(/<manually_attached_skills>[\s\S]*?<\/manually_attached_skills>/gi, '');
    raw = raw.replace(/<[^>]+>/g, ' ');
    return raw.replace(/\s+/g, ' ').trim();
  }

  static shortenTitle(text, convId) {
    if (!text) return `對話 (${String(convId || '').slice(0, 8)})`;
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }

  static unescapeJsonString(text) {
    if (!text) return '';
    try {
      return JSON.parse(`"${text}"`);
    } catch {
      return String(text).replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    }
  }

  static isPlaceholderTitle(title) {
    const t = String(title || '').trim();
    return !t || /^new chat$/i.test(t) || /^untitled$/i.test(t);
  }

  static pickDisplayTitle(official, fallback) {
    if (!this.isPlaceholderTitle(official)) return official.trim();
    return fallback;
  }

  static _ingestComposerJson(text, map) {
    if (!text || typeof text !== 'string') return;
    const add = (id, name) => {
      if (!id || this.isPlaceholderTitle(name)) return;
      map.set(String(id).toLowerCase(), String(name).trim());
    };

    const ingestParsed = (parsed) => {
      if (!parsed || typeof parsed !== 'object') return false;
      const lists = [];
      if (Array.isArray(parsed.allComposers)) lists.push(parsed.allComposers);
      if (Array.isArray(parsed.composers)) lists.push(parsed.composers);
      if (parsed.composerId && parsed.name) add(parsed.composerId, parsed.name);
      let found = false;
      for (const list of lists) {
        for (const item of list) {
          if (item && item.composerId && item.name) {
            add(item.composerId, item.name);
            found = true;
          }
        }
      }
      return found;
    };

    try {
      if (ingestParsed(JSON.parse(text))) return;
    } catch {}

    const keyIdx = Math.max(text.indexOf('"allComposers"'), text.indexOf('"composerHeaders"'));
    if (keyIdx >= 0) {
      const bracket = text.indexOf('[', keyIdx);
      if (bracket >= 0) {
        const slice = this._extractBalanced(text, bracket, '[', ']');
        if (slice) {
          try {
            if (ingestParsed({ allComposers: JSON.parse(slice) })) return;
          } catch {}
        }
      }
    }
  }

  static _extractBalanced(text, start, openChar, closeChar) {
    if (!text || text[start] !== openChar) return '';
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return '';
  }

  static _tryReadSqliteTitles(dbPath, map) {
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      return false;
    }
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
          .map((row) => String(row.name || row.NAME || ''));

        if (tables.includes('composerHeaders')) {
          const rows = db.prepare('SELECT composerId, value FROM composerHeaders').all();
          for (const row of rows) {
            const raw = row.value ?? row.VALUE;
            const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
            if (!text) continue;
            try {
              const parsed = JSON.parse(text);
              const id = parsed.composerId || row.composerId || row.COMPOSERID;
              const name = parsed.name;
              if (id && !this.isPlaceholderTitle(name)) {
                map.set(String(id).toLowerCase(), String(name).trim());
              }
            } catch {
              this._ingestComposerJson(text, map);
            }
          }
        }

        if (tables.includes('ItemTable')) {
          const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
          for (const key of ['composer.composerHeaders', 'composer.composerData']) {
            const row = stmt.get(key);
            const value = row && (row.value ?? row.VALUE);
            if (value) this._ingestComposerJson(Buffer.isBuffer(value) ? value.toString('utf8') : String(value), map);
          }
        }
      } finally {
        db.close();
      }
      return true;
    } catch {
      return false;
    }
  }

  static async _listComposerStateFiles(workspaceFolders = []) {
    const files = [];
    const seen = new Set();
    const push = (filePath) => {
      if (!filePath || seen.has(filePath) || !fs.existsSync(filePath)) return;
      seen.add(filePath);
      files.push(filePath);
    };

    const userDir = this.getCursorUserDir();
    push(path.join(userDir, 'globalStorage', 'state.vscdb'));
    push(path.join(userDir, 'globalStorage', 'state.vscdb-wal'));

    const wanted = new Set();
    for (const folder of workspaceFolders) {
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      if (!folderPath) continue;
      wanted.add(path.normalize(folderPath).toLowerCase());
      wanted.add(path.normalize(folderPath).replace(/\\/g, '/').toLowerCase());
    }

    const wsRoot = path.join(userDir, 'workspaceStorage');
    if (!fs.existsSync(wsRoot)) return files;

    let dirs = [];
    try {
      dirs = await fsPromises.readdir(wsRoot, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(wsRoot, entry.name);
      let meta = null;
      try {
        meta = JSON.parse(await fsPromises.readFile(path.join(dir, 'workspace.json'), 'utf8'));
      } catch {}
      const rawUri = meta?.workspace || meta?.folder || '';
      let decoded = '';
      try {
        decoded = decodeURIComponent(String(rawUri).replace(/^file:\/\/\/?/i, ''));
      } catch {
        decoded = String(rawUri);
      }
      const norm = decoded.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, path.sep);
      const normLower = path.normalize(norm).toLowerCase();
      const matched = !wanted.size || [...wanted].some(w => normLower.includes(w) || w.includes(normLower));
      if (!matched) continue;
      push(path.join(dir, 'state.vscdb'));
      push(path.join(dir, 'state.vscdb-wal'));
    }

    return files;
  }

  static async getOfficialTitleMap(workspaceFolders = []) {
    const files = await this._listComposerStateFiles(workspaceFolders);
    let stamp = 0;
    for (const filePath of files) {
      try {
        stamp = Math.max(stamp, fs.statSync(filePath).mtimeMs);
      } catch {}
    }
    if (this._titleMapCache.map && this._titleMapCache.stamp === stamp && stamp > 0) {
      return this._titleMapCache.map;
    }

    const map = new Map();
    for (const filePath of files) {
      if (filePath.endsWith('.vscdb') && !filePath.endsWith('-wal')) {
        if (this._tryReadSqliteTitles(filePath, map)) continue;
      }
      try {
        const buf = await fsPromises.readFile(filePath);
        this._ingestComposerJson(buf.toString('utf8'), map);
      } catch {}
    }

    this._titleMapCache = { stamp, map };
    return map;
  }

  static collectText(message) {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(part => (part && part.text) || '').filter(Boolean).join('\n');
  }

  static collectToolUses(message) {
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    return content.filter(part => part && (part.type === 'tool_use' || part.name));
  }

  static async _readTitle(jsonlPath, convId) {
    const handle = await fsPromises.open(jsonlPath, 'r');
    try {
      const buf = Buffer.alloc(16384);
      const { bytesRead } = await handle.read(buf, 0, 16384, 0);
      const chunk = buf.slice(0, bytesRead).toString('utf8');
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.role !== 'user') continue;
          const query = this.extractUserQuery(this.collectText(obj.message));
          if (query) return this.shortenTitle(query, convId);
        } catch {}
      }
      return this.shortenTitle(this.extractUserQuery(chunk), convId);
    } finally {
      await handle.close();
    }
  }

  static async getConversationsList(workspaceFolders = []) {
    const projects = await this.resolveProjectDirs(workspaceFolders);
    const officialTitles = await this.getOfficialTitleMap(workspaceFolders);
    const conversations = [];
    const seen = new Set();

    for (const project of projects) {
      let entries = [];
      try {
        entries = await fsPromises.readdir(project.transcriptsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const convId = entry.name;
        if (seen.has(convId)) continue;
        const filePath = path.join(project.transcriptsDir, convId, `${convId}.jsonl`);
        if (!fs.existsSync(filePath)) continue;
        seen.add(convId);

        try {
          const stat = await fsPromises.stat(filePath);
          const official = officialTitles.get(convId.toLowerCase());
          const cached = this._convCache.get(convId);
          if (cached && cached.mtime === stat.mtimeMs) {
            cached.title = this.pickDisplayTitle(official, cached.title);
            conversations.push(cached);
            continue;
          }

          const item = {
            id: convId,
            title: this.pickDisplayTitle(official, await this._readTitle(filePath, convId)),
            workspace: this.workspaceLabel(project.name, workspaceFolders),
            mtime: stat.mtimeMs,
            mtimeStr: new Date(stat.mtimeMs).toLocaleString(),
            filePath,
            projectName: project.name
          };
          this._convCache.set(convId, item);
          conversations.push(item);
        } catch {}
      }
    }

    conversations.sort((a, b) => b.mtime - a.mtime);
    return conversations;
  }

  static async _forEachJsonl(filePath, onObj) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        onObj(JSON.parse(line));
      } catch {}
    }
  }

  static rememberPath(filePath, invokedSkills, invokedRules, skillPaths, rulePaths) {
    const clean = ContextScannerService.normalizeFsPath(filePath);
    if (!clean) return;
    const lower = clean.toLowerCase();
    const base = path.basename(clean).toLowerCase();

    if (base === 'skill.md') {
      const key = path.basename(path.dirname(clean)).toLowerCase();
      invokedSkills.add(key);
      skillPaths.set(key, clean);
    }

    const isStandalone = base === 'agents.md' || base === 'gemini.md' || base === '.cursorrules';
    const isRulesDir = lower.includes(`${path.sep}.agents${path.sep}rules${path.sep}`) ||
      lower.includes('/.agents/rules/') ||
      lower.includes(`${path.sep}.cursor${path.sep}rules${path.sep}`) ||
      lower.includes('/.cursor/rules/') ||
      lower.includes(`${path.sep}.gemini${path.sep}config${path.sep}rules${path.sep}`);

    if (isStandalone || isRulesDir) {
      invokedRules.add(base);
      rulePaths.set(base, clean);
    }
  }

  static extractAttachedSkills(text, invokedSkills, skillPaths) {
    if (!text || !text.includes('manually_attached_skills')) return;
    const matches = text.matchAll(/Skill Name:\s*([^\r\n]+)\s*[\r\n]+Path:\s*([^\r\n]+)/gi);
    for (const match of matches) {
      const name = (match[1] || '').trim();
      const skillPath = ContextScannerService.normalizeFsPath((match[2] || '').trim());
      const key = (name || (skillPath ? path.basename(path.dirname(skillPath)) : '')).toLowerCase();
      if (!key) continue;
      invokedSkills.add(key);
      if (skillPath) skillPaths.set(key, skillPath);
    }
  }

  static rememberMcp(name, invokedMcp) {
    if (!name || typeof name !== 'string') return;
    const raw = name.toLowerCase();
    if (raw === 'cursor') return;
    invokedMcp.add(raw);
    invokedMcp.add(raw.replace(/^user-/, ''));
    invokedMcp.add(raw.replace(/[-_]mcp$/i, ''));
    invokedMcp.add(raw.replace(/^user-/, '').replace(/[-_]mcp$/i, ''));
  }

  static async parseConversationSnapshot(conversationId = null, workspaceFolders = []) {
    const convList = await this.getConversationsList(workspaceFolders);
    if (convList.length === 0) {
      const empty = await ContextScannerService.scanLiveEnvironment(workspaceFolders, { isVsCode: true, isCursor: true });
      return {
        ...empty,
        mode: 'snapshot',
        conversationId: null,
        conversationTitle: '',
        rules: { alwaysActive: [], conditional: [] },
        skills: { workspace: [], global: [], builtin: [] },
        mcpServers: [],
        error: '找不到任何 Cursor 對話紀錄'
      };
    }

    let target = convList[0];
    if (conversationId) {
      const found = convList.find(c => c.id === conversationId);
      if (found) target = found;
    }

    const invokedSkills = new Set();
    const invokedRules = new Set();
    const invokedMcp = new Set();
    const skillPaths = new Map();
    const rulePaths = new Map();

    const consume = (obj) => {
      if (obj.role === 'user') {
        this.extractAttachedSkills(this.collectText(obj.message), invokedSkills, skillPaths);
      }
      const tools = this.collectToolUses(obj.message);
      for (const tool of tools) {
        const name = tool.name || '';
        const input = tool.input || {};
        if (name === 'CallDynamicTool') {
          this.rememberMcp(input.namespace, invokedMcp);
          this.rememberMcp(input.toolName, invokedMcp);
        } else {
          this.rememberMcp(name, invokedMcp);
        }
        const filePath = input.path || input.filePath || input.targetPath;
        if (typeof filePath === 'string') {
          this.rememberPath(filePath, invokedSkills, invokedRules, skillPaths, rulePaths);
        }
      }
    };

    await this._forEachJsonl(target.filePath, consume);

    const subDir = path.join(path.dirname(target.filePath), 'subagents');
    if (fs.existsSync(subDir)) {
      try {
        const subFiles = await fsPromises.readdir(subDir);
        for (const name of subFiles) {
          if (!name.endsWith('.jsonl')) continue;
          await this._forEachJsonl(path.join(subDir, name), consume);
        }
      } catch {}
    }

    const baseEnv = await ContextScannerService.scanLiveEnvironment(workspaceFolders, {
      isVsCode: true,
      isCursor: true
    });

    const pickInvokedRules = (list) => (list || []).filter((rule) => {
      const base = (rule.name || '').toLowerCase();
      const fp = ContextScannerService.normalizeFsPath(rule.filePath).toLowerCase();
      return invokedRules.has(base) || [...rulePaths.values()].some(p => ContextScannerService.normalizeFsPath(p).toLowerCase() === fp);
    }).map(rule => ({ ...rule, isInvoked: true }));

    const alwaysActive = pickInvokedRules(baseEnv.rules.alwaysActive);
    const conditional = pickInvokedRules(baseEnv.rules.conditional);

    // Cursor 會把工作區 AGENTS.md / GEMINI.md 直接注入系統提示，transcript 不會出現 Read
    for (const rule of baseEnv.rules.alwaysActive || []) {
      const fileName = (rule.name || path.basename(rule.filePath || '')).toLowerCase();
      if (fileName !== 'agents.md' && fileName !== 'gemini.md') continue;
      const clean = ContextScannerService.normalizeFsPath(rule.filePath);
      if (!clean || !fs.existsSync(clean)) continue;
      if (!ContextScannerService.existedBeforeConversation(clean, target.mtime)) continue;
      const lower = clean.toLowerCase();
      if (alwaysActive.some(r => ContextScannerService.normalizeFsPath(r.filePath).toLowerCase() === lower)) continue;
      alwaysActive.push({ ...rule, isInvoked: true });
    }

    for (const [, rulePath] of rulePaths) {
      const clean = ContextScannerService.normalizeFsPath(rulePath);
      if (!clean || !fs.existsSync(clean)) continue;
      const lower = clean.toLowerCase();
      const exists = [...alwaysActive, ...conditional].some(r => ContextScannerService.normalizeFsPath(r.filePath).toLowerCase() === lower);
      if (exists) continue;
      const parsed = await ContextScannerService.parseSingleRuleFile(clean);
      if (!parsed) continue;
      parsed.isInvoked = true;
      if (parsed.isAlwaysActive) alwaysActive.push(parsed);
      else conditional.push(parsed);
    }

    const pickInvokedSkills = (list) => (list || []).filter((skill) => {
      const keys = [skill.name, skill.dirName].filter(Boolean).map(v => v.toLowerCase());
      return keys.some(k => invokedSkills.has(k));
    }).map(skill => ({ ...skill, isInvoked: true }));

    const skillsWorkspace = pickInvokedSkills(baseEnv.skills.workspace);
    const skillsGlobal = pickInvokedSkills(baseEnv.skills.global);
    const skillsBuiltin = pickInvokedSkills(baseEnv.skills.builtin);

    for (const [key, skillPath] of skillPaths) {
      const clean = ContextScannerService.normalizeFsPath(skillPath);
      if (!clean || !fs.existsSync(clean)) continue;
      const exists = [...skillsWorkspace, ...skillsGlobal, ...skillsBuiltin].some(s =>
        (s.dirName && s.dirName.toLowerCase() === key) ||
        (s.name && s.name.toLowerCase() === key) ||
        ContextScannerService.normalizeFsPath(s.filePath).toLowerCase() === clean.toLowerCase()
      );
      if (exists) continue;
      const isCursorBuiltin = /[\\/]skills-cursor[\\/]/i.test(clean);
      const parsed = await ContextScannerService.parseSingleSkillFile(
        clean,
        isCursorBuiltin ? 'Cursor 內建' : '',
        isCursorBuiltin ? 'builtin' : 'workspace'
      );
      if (!parsed) continue;
      parsed.isInvoked = true;
      if (isCursorBuiltin) skillsBuiltin.push(parsed);
      else skillsWorkspace.push(parsed);
    }

    const mcpServers = (baseEnv.mcpServers || []).map((server) => {
      const raw = (server.name || '').toLowerCase();
      const norm = raw.replace(/[-_]mcp$/i, '');
      const isInvoked = invokedMcp.has(raw) || invokedMcp.has(norm);
      return { ...server, isInvoked };
    });

    return {
      mode: 'snapshot',
      conversationId: target.id,
      conversationTitle: target.title,
      timestamp: new Date(target.mtime).toISOString(),
      model: null,
      rules: { alwaysActive, conditional },
      skills: { workspace: skillsWorkspace, global: skillsGlobal, builtin: skillsBuiltin },
      mcpServers,
      workspaces: baseEnv.workspaces || []
    };
  }
}

module.exports = CursorTranscriptService;
