const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const ContextScannerService = require('./contextScannerService');
const CursorTranscriptService = require('./cursorTranscriptService');
const McpDetectorService = require('./mcpDetectorService');

class VsCodeChatSessionService {
  static _convCache = new Map();

  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  static getVsCodeUserDir() {
    return McpDetectorService.getVsCodeUserDir();
  }

  static decodeFileUri(rawUri) {
    if (!rawUri) return '';
    let decoded = String(rawUri);
    try {
      decoded = decodeURIComponent(String(rawUri).replace(/^file:\/\/\/?/i, ''));
    } catch {
      decoded = String(rawUri);
    }
    return decoded.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, path.sep);
  }

  static toFsPath(raw) {
    if (!raw || typeof raw !== 'string') return '';
    if (/^(output|untitled|vscode-|http|https|terminal):/i.test(raw)) return '';
    let text = raw;
    if (text.startsWith('file:')) {
      text = this.decodeFileUri(text);
    } else if (/^\/[A-Za-z]:/.test(text)) {
      text = text.slice(1);
    }
    return ContextScannerService.normalizeFsPath(text);
  }

  static shortenTitle(text, convId) {
    if (!text) return `對話 (${String(convId || '').slice(0, 8)})`;
    const oneLine = String(text).replace(/\s+/g, ' ').trim();
    return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
  }

  static pickDisplayTitle(official, fallback) {
    return CursorTranscriptService.pickDisplayTitle(official, fallback);
  }

  static normalizePath(value) {
    return path.normalize(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
  }

  static pathsEqual(a, b) {
    return this.normalizePath(a) === this.normalizePath(b);
  }

  static async resolveSessionDirs(workspaceFolders = [], extraUris = []) {
    const workspaceFiles = [];
    const folderPaths = [];
    for (const extra of extraUris) {
      const extraPath = typeof extra === 'string' ? extra : (extra.fsPath || extra.path || '');
      if (extraPath && /\.code-workspace$/i.test(extraPath)) workspaceFiles.push(extraPath);
    }
    for (const folder of workspaceFolders) {
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      if (folderPath) folderPaths.push(folderPath);
    }

    const wsRoot = path.join(this.getVsCodeUserDir(), 'workspaceStorage');
    if (!fs.existsSync(wsRoot)) return [];

    let dirs = [];
    try {
      dirs = await fsPromises.readdir(wsRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    const matched = [];
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(wsRoot, entry.name);
      let meta = null;
      try {
        meta = JSON.parse(await fsPromises.readFile(path.join(dir, 'workspace.json'), 'utf8'));
      } catch {}
      const workspaceUri = this.decodeFileUri(meta?.workspace || '');
      const folderUri = this.decodeFileUri(meta?.folder || '');
      const isHit = workspaceFiles.length
        ? workspaceFiles.some((item) => this.pathsEqual(workspaceUri, item))
        : folderPaths.some((item) => this.pathsEqual(folderUri, item));
      if (!isHit) continue;
      matched.push({
        id: entry.name,
        storageDir: dir,
        sessionsDir: path.join(dir, 'chatSessions'),
        label: ContextScannerService.formatWorkspaceName(workspaceUri || folderUri || entry.name)
      });
    }
    return matched;
  }

  static _readOfficialIndex(storageDir) {
    const dbPath = path.join(storageDir, 'state.vscdb');
    if (!fs.existsSync(dbPath)) return [];
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      return [];
    }
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index'").get();
        const raw = row && (row.value ?? row.VALUE);
        if (!raw) return [];
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        const parsed = JSON.parse(text);
        return Object.values(parsed.entries || {}).filter((item) => item && item.sessionId && item.isEmpty === false && item.title);
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
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

  static async _readTitle(filePath, convId) {
    let official = '';
    let fallback = '';
    await this._forEachJsonl(filePath, (obj) => {
      if (obj.kind === 1 && Array.isArray(obj.k) && obj.k[0] === 'customTitle' && typeof obj.v === 'string') {
        official = obj.v.trim();
      }
      if (obj.kind === 0 && obj.v && typeof obj.v.customTitle === 'string') {
        official = obj.v.customTitle.trim() || official;
      }
      if (!fallback && obj.kind === 2 && Array.isArray(obj.k) && obj.k[0] === 'requests' && Array.isArray(obj.v)) {
        const text = obj.v[0] && obj.v[0].message && obj.v[0].message.text;
        if (typeof text === 'string' && text.trim()) fallback = text.trim().split(/\r?\n/)[0];
      }
    });
    return this.pickDisplayTitle(official, this.shortenTitle(fallback, convId));
  }

  static async getConversationsList(workspaceFolders = [], extraUris = []) {
    const dirs = await this.resolveSessionDirs(workspaceFolders, extraUris);
    const conversations = [];
    const seen = new Set();

    for (const dir of dirs) {
      const official = this._readOfficialIndex(dir.storageDir);
      if (official.length > 0) {
        for (const entry of official) {
          const convId = String(entry.sessionId);
          if (seen.has(convId)) continue;
          seen.add(convId);
          const chatJsonl = path.join(dir.sessionsDir, `${convId}.jsonl`);
          const mtime = Number(entry.lastMessageDate || entry.timing?.lastRequestEnded || 0);
          const created = Number(entry.timing?.created || mtime);
          const filePath = fs.existsSync(chatJsonl)
            ? chatJsonl
            : this.resolveCliEventsPath(convId, created, workspaceFolders, mtime);
          const item = {
            id: convId,
            title: String(entry.title).trim(),
            workspace: dir.label,
            mtime,
            mtimeStr: mtime ? new Date(mtime).toLocaleString() : '',
            filePath,
            projectName: dir.id
          };
          this._convCache.set(convId, item);
          conversations.push(item);
        }
        continue;
      }

      if (!fs.existsSync(dir.sessionsDir)) continue;
      let entries = [];
      try {
        entries = await fsPromises.readdir(dir.sessionsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const convId = path.basename(entry.name, '.jsonl');
        if (seen.has(convId)) continue;
        const filePath = path.join(dir.sessionsDir, entry.name);
        seen.add(convId);

        try {
          const stat = await fsPromises.stat(filePath);
          const cached = this._convCache.get(convId);
          if (cached && cached.mtime === stat.mtimeMs) {
            conversations.push(cached);
            continue;
          }
          const title = await this._readTitle(filePath, convId);
          if (CursorTranscriptService.isPlaceholderTitle(title) || /^對話 \(/.test(title)) continue;
          const item = {
            id: convId,
            title,
            workspace: dir.label,
            mtime: stat.mtimeMs,
            mtimeStr: new Date(stat.mtimeMs).toLocaleString(),
            filePath,
            projectName: dir.id
          };
          this._convCache.set(convId, item);
          conversations.push(item);
        } catch {}
      }
    }

    conversations.sort((a, b) => b.mtime - a.mtime);
    return conversations;
  }

  static walkNode(node, onVisit) {
    if (!node || typeof node !== 'object') return;
    onVisit(node);
    if (Array.isArray(node)) {
      for (const item of node) this.walkNode(item, onVisit);
      return;
    }
    for (const value of Object.values(node)) this.walkNode(value, onVisit);
  }

  static classifySkillPath(clean) {
    const lower = clean.toLowerCase();
    if (lower.includes(`${path.sep}skills-cursor${path.sep}`)) {
      return { type: 'builtin', source: 'Cursor 內建' };
    }
    if (/[\\/]copilot[\\/]assets[\\/]prompts[\\/]skills[\\/]/i.test(lower)) {
      return { type: 'builtin', source: 'VS Code 內建' };
    }
    if (lower.includes(`${path.sep}.vscode${path.sep}extensions${path.sep}`) && lower.includes(`${path.sep}skills${path.sep}`)) {
      return { type: 'extension', source: '擴充' };
    }
    if (lower.includes(`${path.sep}.claude${path.sep}skills${path.sep}`) || lower.includes(`${path.sep}.copilot${path.sep}skills${path.sep}`)) {
      return { type: 'global', source: '使用者' };
    }
    return { type: 'workspace', source: '' };
  }

  static getCopilotCliStateDir() {
    return path.join(this.getUserHome(), '.copilot', 'session-state');
  }

  static _parseCliWorkspaceYaml(text) {
    const pick = (key) => {
      const match = String(text || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      if (!match) return '';
      return match[1].trim().replace(/^["']|["']$/g, '');
    };
    return {
      id: pick('id'),
      cwd: pick('cwd'),
      createdAt: pick('created_at')
    };
  }

  static listCliSessions() {
    const root = this.getCopilotCliStateDir();
    const list = [];
    if (!fs.existsSync(root)) return list;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return list;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const eventsPath = path.join(dir, 'events.jsonl');
      if (!fs.existsSync(eventsPath)) continue;
      let meta = { id: entry.name, cwd: '', createdAt: '' };
      try {
        meta = {
          ...meta,
          ...this._parseCliWorkspaceYaml(fs.readFileSync(path.join(dir, 'workspace.yaml'), 'utf8'))
        };
      } catch {}
      list.push({
        id: meta.id || entry.name,
        cwd: meta.cwd,
        createdMs: Date.parse(meta.createdAt) || 0,
        eventsPath
      });
    }
    return list;
  }

  static resolveCliEventsPath(sessionId, createdMs, workspaceFolders = [], lastMs = 0) {
    const raw = String(sessionId || '');
    const uuid = raw.replace(/^agent-host-copilotcli:\/?/i, '').replace(/^untitled-/i, '');
    if (uuid) {
      const direct = path.join(this.getCopilotCliStateDir(), uuid, 'events.jsonl');
      if (fs.existsSync(direct)) return direct;
    }

    const wanted = [];
    for (const folder of workspaceFolders) {
      const folderPath = typeof folder === 'string' ? folder : (folder.uri ? folder.uri.fsPath : (folder.path || folder));
      if (folderPath) wanted.push(this.normalizePath(folderPath));
    }

    const created = Number(createdMs) || 0;
    const last = Number(lastMs) || created;
    let best = '';
    let bestScore = Number.POSITIVE_INFINITY;

    for (const session of this.listCliSessions()) {
      if (wanted.length) {
        const cwd = this.normalizePath(session.cwd);
        const cwdHit = wanted.some((item) => cwd === item || cwd.startsWith(`${item}${path.sep}`) || item.startsWith(`${cwd}${path.sep}`));
        if (!cwdHit) continue;
      }

      let endMs = session.createdMs;
      try {
        endMs = Math.max(endMs, fs.statSync(session.eventsPath).mtimeMs);
      } catch {}
      const startMs = session.createdMs || endMs;
      const delta = session.createdMs && created ? Math.abs(session.createdMs - created) : Number.POSITIVE_INFINITY;
      const inWindow = startMs && endMs && (
        (created && created >= startMs - 2000 && created <= endMs + 2000) ||
        (last && last >= startMs - 2000 && last <= endMs + 2000)
      );

      if (delta <= 15000) {
        if (delta < bestScore) {
          bestScore = delta;
          best = session.eventsPath;
        }
        continue;
      }
      if (inWindow && bestScore > 15000) {
        const score = 20000 + Math.min(
          created ? Math.abs(created - startMs) : 1e12,
          last ? Math.abs(last - endMs) : 1e12
        );
        if (score < bestScore) {
          bestScore = score;
          best = session.eventsPath;
        }
      }
    }
    return best;
  }

  static isMcpToolId(toolId) {
    return typeof toolId === 'string' && (
      /^mcp_/i.test(toolId) ||
      /[-_]mcp[-_]server[-_]/i.test(toolId) ||
      /^mcp[-_]/i.test(toolId)
    );
  }

  static matchInvokedMcp(serverName, invokedMcp, mcpToolIds) {
    const raw = String(serverName || '').toLowerCase();
    if (!raw) return false;
    const compact = raw.replace(/[-_]/g, '');
    if (invokedMcp.has(raw) || invokedMcp.has(raw.replace(/-/g, '_')) || invokedMcp.has(compact)) return true;
    if (compact.length < 3) return false;
    return [...mcpToolIds].some((id) => id.toLowerCase().replace(/^mcp_/, '').replace(/[-_]/g, '').includes(compact));
  }

  static consumeSessionObject(obj, invokedSkills, invokedRules, invokedMcp, skillPaths, rulePaths, mcpToolIds) {
    if (obj && typeof obj.type === 'string' && obj.data) {
      const data = obj.data;
      if (obj.type === 'skill.invoked' && typeof data.name === 'string') {
        invokedSkills.add(data.name.toLowerCase());
      }
      if (obj.type === 'tool.execution_start') {
        const toolName = data.toolName || '';
        const args = data.arguments || {};
        if (toolName === 'skill' && typeof args.skill === 'string') {
          invokedSkills.add(args.skill.toLowerCase());
        }
        if (this.isMcpToolId(toolName)) {
          mcpToolIds.add(toolName);
          CursorTranscriptService.rememberMcp(toolName.replace(/[-_]mcp[-_]server[-_].*$/i, ''), invokedMcp);
          CursorTranscriptService.rememberMcp(toolName, invokedMcp);
        }
      }
    }

    const visit = (node) => {
      this.walkNode(node, (item) => {
        if (this.isMcpToolId(item.toolId)) {
          mcpToolIds.add(item.toolId);
          CursorTranscriptService.rememberMcp(item.toolId.slice(4).replace(/_/g, '-'), invokedMcp);
        }
        if (typeof item.serverName === 'string') CursorTranscriptService.rememberMcp(item.serverName, invokedMcp);
        if (Array.isArray(item.didStartServerIds)) {
          for (const id of item.didStartServerIds) CursorTranscriptService.rememberMcp(String(id), invokedMcp);
        }

        const candidates = [item.path, item.filePath, item.targetPath, item.uri, item.fsPath];
        if (item.scheme === 'file') candidates.push(item.path, item.fsPath);
        for (const raw of candidates) {
          const clean = this.toFsPath(raw);
          if (clean) CursorTranscriptService.rememberPath(clean, invokedSkills, invokedRules, skillPaths, rulePaths);
        }
      });
    };

    if (obj && (obj.kind === 0 || obj.kind === 1 || obj.kind === 2)) visit(obj.v);
    else visit(obj);
  }

  static async parseConversationSnapshot(conversationId = null, workspaceFolders = [], options = {}) {
    const extraUris = options.extraUris || [];
    const convList = await this.getConversationsList(workspaceFolders, extraUris);
    const scanOptions = {
      isVsCode: true,
      isCursor: false,
      appRoot: options.appRoot,
      extensionSkillDirs: options.extensionSkillDirs || []
    };

    if (convList.length === 0) {
      const empty = await ContextScannerService.scanLiveEnvironment(workspaceFolders, scanOptions);
      return {
        ...empty,
        mode: 'snapshot',
        conversationId: null,
        conversationTitle: '',
        rules: { alwaysActive: [], conditional: [] },
        skills: { workspace: [], global: [], builtin: [], extension: [] },
        mcpServers: [],
        error: '找不到任何 VS Code Copilot 對話紀錄'
      };
    }

    let target = convList[0];
    if (conversationId) {
      const found = convList.find((item) => item.id === conversationId);
      if (found) target = found;
    }

    const invokedSkills = new Set();
    const invokedRules = new Set();
    const invokedMcp = new Set();
    const skillPaths = new Map();
    const rulePaths = new Map();
    const mcpToolIds = new Set();

    await this._forEachJsonl(target.filePath, (obj) => {
      this.consumeSessionObject(obj, invokedSkills, invokedRules, invokedMcp, skillPaths, rulePaths, mcpToolIds);
    });

    const baseEnv = await ContextScannerService.scanLiveEnvironment(workspaceFolders, scanOptions);

    const pickInvokedRules = (list) => (list || []).filter((rule) => {
      const base = (rule.name || '').toLowerCase();
      const fp = ContextScannerService.normalizeFsPath(rule.filePath).toLowerCase();
      return invokedRules.has(base) || [...rulePaths.values()].some((item) => ContextScannerService.normalizeFsPath(item).toLowerCase() === fp);
    }).map((rule) => ({ ...rule, isInvoked: true }));

    const alwaysActive = pickInvokedRules(baseEnv.rules.alwaysActive);
    const conditional = pickInvokedRules(baseEnv.rules.conditional);

    for (const rule of baseEnv.rules.alwaysActive || []) {
      const fileName = (rule.name || path.basename(rule.filePath || '')).toLowerCase();
      if (fileName !== 'agents.md' && fileName !== 'gemini.md' && fileName !== 'claude.md') continue;
      const clean = ContextScannerService.normalizeFsPath(rule.filePath);
      if (!clean || !fs.existsSync(clean)) continue;
      if (!ContextScannerService.existedBeforeConversation(clean, target.mtime)) continue;
      const lower = clean.toLowerCase();
      if (alwaysActive.some((item) => ContextScannerService.normalizeFsPath(item.filePath).toLowerCase() === lower)) continue;
      alwaysActive.push({ ...rule, isInvoked: true });
    }

    for (const [, rulePath] of rulePaths) {
      const clean = ContextScannerService.normalizeFsPath(rulePath);
      if (!clean || !fs.existsSync(clean)) continue;
      const lower = clean.toLowerCase();
      const exists = [...alwaysActive, ...conditional].some((item) => ContextScannerService.normalizeFsPath(item.filePath).toLowerCase() === lower);
      if (exists) continue;
      const parsed = await ContextScannerService.parseSingleRuleFile(clean);
      if (!parsed) continue;
      parsed.isInvoked = true;
      if (parsed.isAlwaysActive) alwaysActive.push(parsed);
      else conditional.push(parsed);
    }

    const pickInvokedSkills = (list) => (list || []).filter((skill) => {
      const keys = [skill.name, skill.dirName].filter(Boolean).map((value) => value.toLowerCase());
      return keys.some((key) => invokedSkills.has(key));
    }).map((skill) => ({ ...skill, isInvoked: true }));

    const skillsWorkspace = pickInvokedSkills(baseEnv.skills.workspace);
    const skillsGlobal = pickInvokedSkills(baseEnv.skills.global);
    const skillsExtension = pickInvokedSkills(baseEnv.skills.extension);
    const skillsBuiltin = pickInvokedSkills(baseEnv.skills.builtin);

    for (const [key, skillPath] of skillPaths) {
      const clean = ContextScannerService.normalizeFsPath(skillPath);
      if (!clean || !fs.existsSync(clean)) continue;
      const exists = [...skillsWorkspace, ...skillsGlobal, ...skillsExtension, ...skillsBuiltin].some((skill) =>
        (skill.dirName && skill.dirName.toLowerCase() === key) ||
        (skill.name && skill.name.toLowerCase() === key) ||
        ContextScannerService.normalizeFsPath(skill.filePath).toLowerCase() === clean.toLowerCase()
      );
      if (exists) continue;
      const classified = this.classifySkillPath(clean);
      const parsed = await ContextScannerService.parseSingleSkillFile(clean, classified.source, classified.type);
      if (!parsed) continue;
      parsed.isInvoked = true;
      if (classified.type === 'builtin') skillsBuiltin.push(parsed);
      else if (classified.type === 'extension') skillsExtension.push(parsed);
      else if (classified.type === 'global') skillsGlobal.push(parsed);
      else skillsWorkspace.push(parsed);
    }

    const mcpServers = (baseEnv.mcpServers || []).map((server) => ({
      ...server,
      isInvoked: this.matchInvokedMcp(server.name, invokedMcp, mcpToolIds)
    }));

    return {
      mode: 'snapshot',
      conversationId: target.id,
      conversationTitle: target.title,
      timestamp: new Date(target.mtime).toISOString(),
      model: null,
      rules: { alwaysActive, conditional },
      skills: {
        workspace: skillsWorkspace,
        global: skillsGlobal,
        extension: skillsExtension,
        builtin: skillsBuiltin
      },
      mcpServers,
      workspaces: baseEnv.workspaces || []
    };
  }
}

module.exports = VsCodeChatSessionService;
