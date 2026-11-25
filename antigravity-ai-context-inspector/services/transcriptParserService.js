const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const ContextScannerService = require('./contextScannerService');
const AntigravityDataRoots = require('./antigravityDataRoots');

class TranscriptParserService {
  static _convCache = new Map(); // convDir -> { id, title, workspace, mtime, mtimeStr, dirPath, summaryTitle }
  static _summariesCache = { key: '', map: new Map() };

  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  /**
   * Antigravity 於 2026-10-29 把對話資料搬到 `~/.gemini/antigravity`，
   * 舊的 `~/.gemini/antigravity-ide` 從此凍結。這裡一律「兩邊合併、新根優先」，
   * 只換路徑會讓 500 筆舊歷史整批消失，只讀舊路徑則看不到搬遷後的新對話。
   */
  static getBrainDirs() {
    return AntigravityDataRoots.resolveBrainDirs(this.getUserHome());
  }

  static getConversationsDirs() {
    return AntigravityDataRoots.resolveConversationsDirs(this.getUserHome());
  }

  /** 相容入口：主要 brain 目錄 */
  static getBrainDir() {
    return this.getBrainDirs()[0] || path.join(AntigravityDataRoots.getPrimaryRootDir(this.getUserHome()), 'brain');
  }

  /** 相容入口：主要 conversations 目錄 */
  static getConversationsDir() {
    return this.getConversationsDirs()[0] || path.join(AntigravityDataRoots.getPrimaryRootDir(this.getUserHome()), 'conversations');
  }

  static isAvailable() {
    return this.getBrainDirs().length > 0;
  }

  /**
   * 讀取官方對話摘要庫（`conversation_summaries.db`）的標題與最後修改時間。
   * 新格式對話的 `.db` 已不含標題字串，標題只存在這張表；排序也以它的
   * `last_modified_time` 為準（brain 資料夾的 mtime 會被空檔案碰觸而失真）。
   * 只在 node:sqlite 可用時讀；讀不到就整段降級回舊行為（不影響其他來源）。
   */
  static _loadConversationSummaries() {
    const dbPaths = AntigravityDataRoots.resolveFiles('conversation_summaries.db', this.getUserHome());
    const cacheKey = dbPaths.map((dbPath) => {
      try {
        const stat = fs.statSync(dbPath);
        return `${dbPath}:${stat.mtimeMs}:${stat.size}`;
      } catch (e) {
        return `${dbPath}:missing`;
      }
    }).join('|');
    if (cacheKey === this._summariesCache.key) return this._summariesCache.map;

    const map = new Map(); // convId(小寫) -> { title, mtime }
    let DatabaseSync = null;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch (e) {
      DatabaseSync = null;
    }

    if (DatabaseSync) {
      for (const dbPath of dbPaths) {
        let db = null;
        try {
          db = new DatabaseSync(dbPath, { readOnly: true });
          const rows = db.prepare('SELECT conversation_id, title, last_modified_time FROM conversation_summaries').all();
          for (const row of rows) {
            const id = String(row.conversation_id || '').trim().toLowerCase();
            if (!id) continue;
            const title = typeof row.title === 'string' ? row.title.trim() : '';
            const mtime = this._parseSummaryTime(row.last_modified_time);
            const existing = map.get(id);
            if (!existing) {
              map.set(id, { title, mtime });
              continue;
            }
            // 新根優先：先到先贏，只補空值與較新的時間
            if (!existing.title && title) existing.title = title;
            if (mtime > existing.mtime) existing.mtime = mtime;
          }
        } catch (e) {
          // 資料庫被鎖住或格式不同 ⇒ 靜默降級（不讓清單整個失敗）
        } finally {
          if (db) {
            try { db.close(); } catch (e) {}
          }
        }
      }
    }

    this._summariesCache = { key: cacheKey, map };
    return map;
  }

  /** `last_modified_time` 形如 `2026-11-24 12:02:35.7637336+00:00`（UTC，7 位小數秒） */
  static _parseSummaryTime(value) {
    if (!value) return 0;
    const raw = value instanceof Date ? value.toISOString() : String(value).trim();
    const parsed = Date.parse(raw.replace(' ', 'T'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * 直接讀取 Antigravity IDE 官方對話數據庫中的原生 Session 命名與工作區（100% 還原 IDE 內建標題與專案標籤）
   * 採輕量分區讀取（首部 64KB 取 Workspace，尾部 256KB 取最新 Session 標題），避免大型 .db 檔案佔用記憶體
   */
  static async _extractOfficialMetadata(convId) {
    const dbPath = this._resolveConversationDbPath(convId);
    if (!dbPath) return { title: null, workspace: null };

    let title = null;
    let fileHandle = null;

    try {
      const stat = await fsPromises.stat(dbPath);
      const fileSize = stat.size;
      fileHandle = await fsPromises.open(dbPath, 'r');

      // 1. 輕量讀取檔案尾部 (最多 256KB) 提取最新 Session 官方標題
      const tailReadSize = Math.min(fileSize, 262144);
      const tailOffset = Math.max(0, fileSize - tailReadSize);
      const tailBuf = Buffer.alloc(tailReadSize);
      await fileHandle.read(tailBuf, 0, tailReadSize, tailOffset);

      title = this._scanTitleInBuf(tailBuf);

      // 2. 若尾部未命中且檔案大於尾部讀取區塊，回退讀取頭部 (最多 512KB)
      if (!title && fileSize > tailReadSize) {
        const fallbackSize = Math.min(fileSize, 524288);
        const fallbackBuf = Buffer.alloc(fallbackSize);
        await fileHandle.read(fallbackBuf, 0, fallbackSize, 0);
        title = this._scanTitleInBuf(fallbackBuf);
      }
    } catch (e) {
    } finally {
      if (fileHandle !== null) {
        try { await fileHandle.close(); } catch (e) {}
      }
    }

    return { title, workspace: '' };
  }

  /**
   * 在二進制 Buffer 中逆向搜尋 Protobuf 格式的官方 Session 標題 (tag 0x22 -> len -> title -> tag 0x48)
   */
  static _scanTitleInBuf(buf) {
    const sessionIdBuf = Buffer.from('sessionID');
    let sIdx = 0;
    const sessionPositions = [];
    while ((sIdx = buf.indexOf(sessionIdBuf, sIdx)) !== -1) {
      sessionPositions.push(sIdx);
      sIdx += sessionIdBuf.length;
    }

    // 由後往前尋找最新一筆 session 標題
    for (let i = sessionPositions.length - 1; i >= 0; i--) {
      const pos = sessionPositions[i];
      const slice = buf.slice(pos, Math.min(buf.length, pos + 350));
      for (let j = 0; j < slice.length - 10; j++) {
        if (slice[j] === 0x22) {
          const len = slice[j + 1];
          if (len >= 2 && len <= 80 && (j + 2 + len) < slice.length) {
            if (slice[j + 2 + len] === 0x48) {
              const str = slice.slice(j + 2, j + 2 + len).toString('utf8');
              if (!str.includes('\n') && !str.includes('\r') && !str.includes('{') && !str.includes('}') && !str.includes('"') && !str.includes('file:')) {
                if (/^[\u4e00-\u9fa5a-zA-Z0-9_\-\s\(\)\:\,\.\!\?\'\/\+\#]+$/.test(str.trim())) {
                  return str.trim();
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * 極速解析單一對話的標題與工作區（只讀取前 32KB 輕量前導區塊，避免讀取幾十 MB 日誌）
   */
  static async _parseSingleConvMetadata(convId, convDir, mtimeMs, summary = null) {
    const summaryTitle = summary && summary.title ? summary.title : '';
    const cached = this._convCache.get(convDir);
    if (cached && cached.mtime === mtimeMs && cached.summaryTitle === summaryTitle) {
      return cached;
    }

    const transcriptPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
    const fullTranscriptPath = path.join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl');
    const targetLog = fs.existsSync(transcriptPath) ? transcriptPath : (fs.existsSync(fullTranscriptPath) ? fullTranscriptPath : null);

    let title = '';
    let firstCleanedReq = '';

    // 1. 最高優先：官方摘要庫的標題（新格式對話的 .db 已不含標題字串，只有這張表有）
    if (summaryTitle) {
      title = summaryTitle;
    }

    // 2. 舊格式：從官方對話資料庫 .db 內嵌的 Protobuf 標題還原
    if (!title) {
      const officialMeta = await this._extractOfficialMetadata(convId);
      if (officialMeta.title) {
        title = officialMeta.title;
      }
    }

    if (targetLog) {
      let fileHandle = null;
      try {
        // 讀取檔案前段（涵蓋 CHECKPOINT、首個 USER_INPUT 與初期規劃）
        fileHandle = await fsPromises.open(targetLog, 'r');
        const buffer = Buffer.alloc(65536);
        const { bytesRead } = await fileHandle.read(buffer, 0, 65536, 0);

        const logSnippet = buffer.toString('utf-8', 0, bytesRead);
        const logLines = logSnippet.split(/\r?\n/);

        for (const line of logLines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            // 重要：必須過濾系統自動注入的歷史對話摘要，避免誤抓上一場對話的標題
            if (parsed.type === 'CONVERSATION_HISTORY') {
              continue;
            }

            // 2. 完全比照 IDE 原生規則：首句使用者真實請求提取（保留 @[路徑]，壓縮換行與空白，不濾除任何原生文字）
            if (!firstCleanedReq && parsed.type === 'USER_INPUT' && parsed.content) {
              const reqMatch = parsed.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
              if (reqMatch) {
                const rawReq = reqMatch[1];
                const cleanedText = rawReq
                  .replace(/[\r\n\t]+/g, ' ')
                  .replace(/\s{2,}/g, ' ')
                  .trim();
                if (cleanedText.length > 0) {
                  firstCleanedReq = cleanedText.slice(0, 100);
                }
              }
            }

            // 3. 次選官方任務主題 (USER Objective，排除歷史摘要後)
            if (!title && parsed.content && parsed.content.includes('USER Objective:')) {
              const mObj = parsed.content.match(/#\s*USER Objective:\s*([^\r\n]+)/);
              if (mObj && mObj[1].trim()) {
                title = mObj[1].trim();
              }
            }

            if (title && firstCleanedReq) break;
          } catch (e) {}
        }
      } catch (err) {
      } finally {
        if (fileHandle !== null) {
          try { await fileHandle.close(); } catch(e){}
        }
      }
    }

    // 若無官方標題，完全比照 IDE 原生展示第一句使用者請求
    if (!title && firstCleanedReq) {
      title = firstCleanedReq;
    }

    // 後備方案：從 implementation_plan.md 或 walkthrough.md 提取標題
    if (!title) {
      const planCandidates = [
        path.join(convDir, 'implementation_plan.md'),
        path.join(convDir, 'walkthrough.md')
      ];
      for (const p of planCandidates) {
        if (fs.existsSync(p)) {
          try {
            const planContent = await fsPromises.readFile(p, 'utf-8');
            const m = planContent.match(/^#\s*(.+)$/m);
            if (m) {
              const cleanedPlanTitle = m[1].replace(/實作計畫|實施方案|開發完成|成果報告|Implementation Plan|Walkthrough/gi, '').trim();
              if (cleanedPlanTitle) {
                title = cleanedPlanTitle;
                break;
              }
            }
          } catch (e) {}
        }
      }
    }

    const result = {
      id: convId,
      title: title || `對話任務 (${convId.slice(0, 8)})`,
      workspace: '',
      mtime: mtimeMs,
      mtimeStr: new Date(mtimeMs).toLocaleString(),
      dirPath: convDir,
      summaryTitle
    };

    this._convCache.set(convDir, result);
    return result;
  }

  /** 對話資料庫 .db 的實際位置（新根優先；兩邊都有時內容相同） */
  static _resolveConversationDbPath(convId) {
    for (const conversationsDir of this.getConversationsDirs()) {
      const candidate = path.join(conversationsDir, `${convId}.db`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** brain 目錄底下的項目是不是一個對話（排除暫存資料夾與隱藏項目） */
  static _isConversationDirName(name) {
    return Boolean(name) && !name.startsWith('.') && name !== 'scratch' && name !== 'tempmediaStorage';
  }

  /**
   * 檢視單一對話資料夾：新根的 brain 目錄可能只有 `.user_uploaded`（搬遷時同步的殘留），
   * 真正的日誌還留在舊根，所以要逐資料夾判斷「有沒有可用的 transcript」。
   */
  static async _inspectConversationDir(convDir) {
    const info = { convDir, hasTranscript: false, hasFullTranscript: false, transcriptMs: 0, dirMs: 0 };
    try {
      const stat = await fsPromises.stat(convDir);
      info.dirMs = stat.mtimeMs;
    } catch (e) {
      return null;
    }

    const logDir = path.join(convDir, '.system_generated', 'logs');
    for (const [fileName, key] of [['transcript.jsonl', 'hasTranscript'], ['transcript_full.jsonl', 'hasFullTranscript']]) {
      if (info.hasTranscript) break; // 輕量版優先
      try {
        const logStat = await fsPromises.stat(path.join(logDir, fileName));
        info[key] = true;
        if (logStat.mtimeMs > info.transcriptMs) info.transcriptMs = logStat.mtimeMs;
      } catch (e) {}
    }
    return info;
  }

  /**
   * 取得所有歷史對話任務清單（依最後活躍時間降冪排列，支援記憶體極速快取）
   * 新舊兩個資料根合併、同 id 只留一份，並優先選「有 transcript 的那一份」資料夾。
   */
  static async getConversationsList() {
    const brainDirs = this.getBrainDirs();
    if (brainDirs.length === 0) return [];

    try {
      const summaries = this._loadConversationSummaries();
      const conversationsDirs = this.getConversationsDirs();

      // 1. 收集所有資料根的對話資料夾（同 id 可能兩邊都有）
      const grouped = new Map(); // convId(小寫) -> { convId, dirs: [] }
      for (const brainDir of brainDirs) {
        let entries = [];
        try {
          entries = await fsPromises.readdir(brainDir, { withFileTypes: true });
        } catch (e) {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || !this._isConversationDirName(entry.name)) continue;
          const key = entry.name.toLowerCase();
          if (!grouped.has(key)) grouped.set(key, { convId: entry.name, dirs: [] });
          grouped.get(key).dirs.push(path.join(brainDir, entry.name));
        }
      }

      // 2. 每個對話只留一份資料夾，並算出真正的最後活躍時間
      const validEntries = [];
      await Promise.all(Array.from(grouped.values()).map(async ({ convId, dirs }) => {
        const infos = (await Promise.all(dirs.map(dir => this._inspectConversationDir(dir)))).filter(Boolean);
        if (infos.length === 0) return;

        const score = (info) => (info.hasTranscript ? 2 : (info.hasFullTranscript ? 1 : 0));
        const picked = infos.reduce((best, info) => (score(info) > score(best) ? info : best));
        const summary = summaries.get(convId.toLowerCase()) || null;

        // 對話資料庫 .db 的最後寫入時間（舊對話被重新啟用時會更新）
        let dbMtime = 0;
        for (const conversationsDir of conversationsDirs) {
          try {
            const dbStat = await fsPromises.stat(path.join(conversationsDir, `${convId}.db`));
            if (dbStat.mtimeMs > dbMtime) dbMtime = dbStat.mtimeMs;
          } catch (e) {}
        }

        // 官方摘要庫的時間才是真的「最後活躍」；brain 資料夾 mtime 會被零星檔案碰觸而失真，
        // 只有完全查不到摘要時才退回資料夾 mtime（舊行為）。
        let lastActiveTime = Math.max(picked.transcriptMs, dbMtime, summary ? summary.mtime : 0);
        if (!summary || !summary.mtime) lastActiveTime = Math.max(lastActiveTime, picked.dirMs);

        validEntries.push({ convId, convDir: picked.convDir, mtime: lastActiveTime, summary });
      }));

      // 3. 依真正最後活躍時間排序由新到舊
      validEntries.sort((a, b) => b.mtime - a.mtime);

      return await Promise.all(validEntries.map(e => this._parseSingleConvMetadata(e.convId, e.convDir, e.mtime, e.summary)));
    } catch (err) {
      console.error('Error reading conversations list:', err);
      return [];
    }
  }

  /**
   * 從對話資料庫 .db 中精準提取該 Session 建立時由 Antigravity IDE 靜態注入的全部常駐規範、條件式規範與可用技能
   */
  static async _extractSessionMetadataFromDb(convId) {
    const dbPath = this._resolveConversationDbPath(convId);
    if (!dbPath) {
      return { hasSessionPrompt: false, alwaysActiveRules: [], conditionalRules: [], availableSkills: [], workspaces: [] };
    }

    try {
      const buf = await fsPromises.readFile(dbPath);
      const str = buf.toString('utf8');

      const alwaysActiveRules = new Set();
      const conditionalRules = new Set();
      const availableSkills = new Set();
      const workspaces = new Set();

      // 1. 提取靜態注入之常駐規範 <RULE[路徑]>
      const ruleTagMatches = str.matchAll(/<RULE\[([a-zA-Z]:[\\/][^\]\r\n]+)\]>/gi);
      for (const rm of ruleTagMatches) {
        const rPath = ContextScannerService.normalizeFsPath(rm[1]);
        if (rPath && fs.existsSync(rPath)) {
          alwaysActiveRules.add(rPath);
          const ws = ContextScannerService.findWorkspaceRoot(rPath);
          if (ws) workspaces.add(ws);
        }
      }

      // 2. 提取靜態注入之條件式規範 - file:///D:/.../.agents/rules/...
      const condRuleMatches = str.matchAll(/-\s+file:\/\/\/([a-zA-Z]:[^\r\n:]+\.agents[\\/]rules[\\/][^\r\n:]+\.md)/gi);
      for (const crm of condRuleMatches) {
        const rPath = ContextScannerService.normalizeFsPath(crm[1]);
        if (rPath && fs.existsSync(rPath)) {
          conditionalRules.add(rPath);
          const ws = ContextScannerService.findWorkspaceRoot(rPath);
          if (ws) workspaces.add(ws);
        }
      }

      // 3. 提取靜態注入之可用技能清單 - skill-name (D:\.../SKILL.md)
      const skillMatches = str.matchAll(/-\s+([a-zA-Z0-9_\-]+)\s+\(([a-zA-Z]:[^\r\n\)]+SKILL\.md)\)/gi);
      for (const sm of skillMatches) {
        const sPath = ContextScannerService.normalizeFsPath(sm[2]);
        if (sPath && fs.existsSync(sPath)) {
          availableSkills.add(sPath);
          const ws = ContextScannerService.findWorkspaceRoot(sPath);
          if (ws) workspaces.add(ws);
        }
      }

      // 4. 提取對話中涉及的工作區路徑
      const wsMatches = str.matchAll(/file:\/\/\/([a-zA-Z]:[\\/][^`"'\r\n\t\<\>\(\)\*\,\?\:\;]+)/gi);
      for (const wm of wsMatches) {
        const raw = wm[1].replace(/\\/g, '/');
        if (!raw.includes('.agents') && !raw.includes('.gemini') && !raw.includes('AppData') && !raw.includes('node_modules')) {
          const ws = ContextScannerService.findWorkspaceRoot(raw);
          if (ws) workspaces.add(ws);
        }
      }

      const hasSessionPrompt = str.includes('<user_rules>') || 
                               str.includes('Available skills:') || 
                               str.includes('<customizations>') || 
                               availableSkills.size > 0 || 
                               alwaysActiveRules.size > 0;

      return {
        hasSessionPrompt: hasSessionPrompt,
        alwaysActiveRules: Array.from(alwaysActiveRules),
        conditionalRules: Array.from(conditionalRules),
        availableSkills: Array.from(availableSkills),
        workspaces: Array.from(workspaces)
      };
    } catch (err) {
      return { hasSessionPrompt: false, alwaysActiveRules: [], conditionalRules: [], availableSkills: [], workspaces: [] };
    }
  }

  /**
   * 解析指定對話任務的上下文與日誌足跡（支援跨專案工作區自動溯源、DB 原生 System Prompt 逆向還原與日誌足跡即時補全）
   */
  static async parseConversationSnapshot(conversationId = null, workspaceFolders = []) {
    const convList = await this.getConversationsList();
    if (convList.length === 0) {
      return { error: '找不到任何對話任務記錄' };
    }

    let targetConv = convList[0];
    if (conversationId) {
      const found = convList.find(c => c.id === conversationId);
      if (found) targetConv = found;
    }

    // 1. 最高優先：從官方 Session .db 中提取該對話當初由 Antigravity IDE 靜態注入的全部規範與技能清單
    const dbSessionMeta = await this._extractSessionMetadataFromDb(targetConv.id);

    // 優先讀取輕量版 transcript.jsonl，秒級響應
    const logCandidates = [
      path.join(targetConv.dirPath, '.system_generated', 'logs', 'transcript.jsonl'),
      path.join(targetConv.dirPath, '.system_generated', 'logs', 'transcript_full.jsonl')
    ];

    let targetLogPath = null;
    for (const p of logCandidates) {
      if (fs.existsSync(p)) {
        targetLogPath = p;
        break;
      }
    }

    // 2. 分析對話日誌動態足跡
    const invokedSkills = new Set();
    const invokedRules = new Set();
    const invokedTools = new Set();
    const invokedMcpServers = new Set();
    const invokedMcpTools = new Set();
    const discoveredSkillPaths = new Map(); // dirName.toLowerCase() -> fullFilePath
    const discoveredRulePaths = new Map();  // fileName.toLowerCase() -> fullFilePath
    const discoveredWorkspaceRoots = new Set(dbSessionMeta.workspaces);
    let activeDoc = '';
    let currentModel = '';
    let stepCount = 0;

    if (targetLogPath) {
      try {
        const fileStream = fs.createReadStream(targetLogPath, { encoding: 'utf-8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        
        for await (const line of rl) {
          if (!line.trim()) continue;
          stepCount++;
          const obj = JSON.parse(line);

          // 提取元數據 (Active Doc, Model)
          if (obj.content) {
            if (!activeDoc) {
              const docMatch = obj.content.match(/Active Document:\s*([^\r\n(]+)/);
              if (docMatch) {
                activeDoc = docMatch[1].trim();
                const wsRoot = ContextScannerService.findWorkspaceRoot(activeDoc);
                if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
              }
            }
            if (!currentModel) {
              const modelMatch = obj.content.match(/Model Selection` from (?:None|\w+) to (.+?)\./);
              if (modelMatch) currentModel = modelMatch[1].trim();
            }

            // 從內容中掃描提及的檔案與專案路徑（長度防禦：避免巨型日誌或 tool output 引發正則回溯卡頓）
            const scanTarget = (obj.type === 'USER_INPUT' || obj.type === 'MODEL')
              ? obj.content
              : (obj.content.length > 8192 ? obj.content.slice(0, 8192) : obj.content);
            const fileMatches = scanTarget.matchAll(/(?:file:\/\/\/?|[a-zA-Z]:[\\/])(?:PJ[\\/]|Users[\\/])?[^`"'\r\n\t\<\>\(\)]+/gi);
            for (const fm of fileMatches) {
              const rawP = fm[0];
              if (!rawP.includes('AppData') && !rawP.includes('Temp') && !rawP.includes('node_modules')) {
                const wsRoot = ContextScannerService.findWorkspaceRoot(rawP);
                if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
              }
            }
          }

          // 提取 tool calls
          if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
            for (const tc of obj.tool_calls) {
              const tName = tc.name || tc.toolAction;
              if (tName) {
                invokedTools.add(tName.toLowerCase());
                if (tc.name) invokedTools.add(tc.name.toLowerCase());
              }

              // 檢查 Cwd 或 DirectoryPath 是否指向專案
              if (tc.args?.Cwd && typeof tc.args.Cwd === 'string') {
                const wsRoot = ContextScannerService.findWorkspaceRoot(tc.args.Cwd) || (path.isAbsolute(tc.args.Cwd) && fs.existsSync(tc.args.Cwd) ? path.normalize(tc.args.Cwd) : null);
                if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
              }
              if (tc.args?.DirectoryPath && typeof tc.args.DirectoryPath === 'string') {
                const wsRoot = ContextScannerService.findWorkspaceRoot(tc.args.DirectoryPath) || (path.isAbsolute(tc.args.DirectoryPath) && fs.existsSync(tc.args.DirectoryPath) ? path.normalize(tc.args.DirectoryPath) : null);
                if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
              }

              // 1. 支援 Lazy MCP 工具調用 (call_mcp_tool)
              if (tc.name === 'call_mcp_tool' && tc.args) {
                let sName = tc.args.ServerName || '';
                let tTool = tc.args.ToolName || '';
                if (typeof sName === 'string') sName = sName.replace(/^["']|["']$/g, '').trim().toLowerCase();
                if (typeof tTool === 'string') tTool = tTool.replace(/^["']|["']$/g, '').trim().toLowerCase();
                
                if (sName) {
                  const sNorm = sName.replace(/[-_]mcp$/i, '');
                  invokedMcpServers.add(sName);
                  invokedMcpServers.add(sNorm);
                  invokedTools.add(sName);
                  invokedTools.add(sNorm);

                  if (tTool) {
                    // 強制加入命名空間保護，避免全域純工具名稱污染其他同名工具之 MCP 伺服器
                    invokedMcpTools.add(`mcp_${sName}_${tTool}`);
                    invokedMcpTools.add(`mcp_${sNorm}_${tTool}`);
                    invokedMcpTools.add(`${sName}.${tTool}`);
                    invokedMcpTools.add(`${sNorm}.${tTool}`);
                    invokedMcpTools.add(`${sName}_${tTool}`);
                    invokedMcpTools.add(`${sNorm}_${tTool}`);
                    invokedMcpTools.add(`${sName}:${tTool}`);
                    invokedMcpTools.add(`${sNorm}:${tTool}`);
                    invokedTools.add(`mcp_${sName}_${tTool}`);
                    invokedTools.add(`${sName}.${tTool}`);
                  }
                }
              }

              // 2. 支援 Eager MCP 工具調用 (例如 mcp_github_create_repository / mcp_photopea_open_doc)
              if (tc.name && tc.name.toLowerCase().startsWith('mcp_')) {
                const raw = tc.name.toLowerCase();
                const parts = raw.split('_');
                if (parts.length >= 3) {
                  const sName = parts[1];
                  const sNorm = sName.replace(/[-_]mcp$/i, '');
                  const tTool = parts.slice(2).join('_');
                  invokedMcpServers.add(sName);
                  invokedMcpServers.add(sNorm);
                  invokedMcpTools.add(raw);
                  invokedMcpTools.add(`mcp_${sName}_${tTool}`);
                  invokedMcpTools.add(`mcp_${sNorm}_${tTool}`);
                  invokedMcpTools.add(`${sName}.${tTool}`);
                  invokedMcpTools.add(`${sNorm}.${tTool}`);
                  invokedMcpTools.add(`${sName}_${tTool}`);
                  invokedMcpTools.add(`${sNorm}_${tTool}`);
                  invokedMcpTools.add(`${sName}:${tTool}`);
                  invokedMcpTools.add(`${sNorm}:${tTool}`);
                  invokedTools.add(raw);
                  invokedTools.add(`${sName}.${tTool}`);
                } else if (parts.length === 2) {
                  invokedMcpServers.add(parts[1]);
                  invokedTools.add(parts[1]);
                }
              }

              let fp = tc.args?.AbsolutePath || tc.args?.TargetFile || tc.args?.SearchPath;
              if (fp && typeof fp === 'string') {
                const cleanFp = ContextScannerService.normalizeFsPath(fp);
                if (cleanFp && fs.existsSync(cleanFp)) {
                  const lowerFp = cleanFp.toLowerCase();
                  if (lowerFp.includes('skill.md')) {
                    const skillDir = path.basename(path.dirname(cleanFp));
                    const skillKey = skillDir.toLowerCase();
                    invokedSkills.add(skillKey);
                    discoveredSkillPaths.set(skillKey, cleanFp);
                    const wsRoot = ContextScannerService.findWorkspaceRoot(cleanFp);
                    if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                  }
                  const baseName = path.basename(cleanFp).toLowerCase();
                  const isStandaloneRule = baseName === 'agents.md' || baseName === 'gemini.md';
                  const isRulesDirFile = lowerFp.includes('.agents\\rules') || lowerFp.includes('/.agents/rules') || lowerFp.includes('.gemini\\config\\rules') || lowerFp.includes('/.gemini/config/rules');

                  if (isRulesDirFile || isStandaloneRule) {
                    const ruleKey = baseName;
                    invokedRules.add(ruleKey);
                    discoveredRulePaths.set(ruleKey, cleanFp);
                    const wsRoot = ContextScannerService.findWorkspaceRoot(cleanFp);
                    if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                  } else {
                    const wsRoot = ContextScannerService.findWorkspaceRoot(cleanFp);
                    if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                  }
                }
              }
            }
          }

          // 提取 VIEW_FILE 等 step
          if (obj.type === 'VIEW_FILE' && obj.content) {
            const matchPath = obj.content.match(/File Path:\s*`file:\/\/\/?([^`]+)`/);
            if (matchPath) {
              const cleanFp = ContextScannerService.normalizeFsPath(matchPath[1]);
              if (cleanFp && fs.existsSync(cleanFp)) {
                const lowerFp = cleanFp.toLowerCase();
                if (lowerFp.includes('skill.md')) {
                  const skillDir = path.basename(path.dirname(cleanFp));
                  const skillKey = skillDir.toLowerCase();
                  invokedSkills.add(skillKey);
                  discoveredSkillPaths.set(skillKey, cleanFp);
                  const wsRoot = ContextScannerService.findWorkspaceRoot(cleanFp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                }
                const baseName = path.basename(cleanFp).toLowerCase();
                const isStandaloneRule = baseName === 'agents.md' || baseName === 'gemini.md';
                const isRulesDirFile = lowerFp.includes('.agents\\rules') || lowerFp.includes('/.agents/rules') || lowerFp.includes('.gemini\\config\\rules') || lowerFp.includes('/.gemini/config/rules');

                if (isRulesDirFile || isStandaloneRule) {
                  const ruleKey = baseName;
                  invokedRules.add(ruleKey);
                  discoveredRulePaths.set(ruleKey, cleanFp);
                  const wsRoot = ContextScannerService.findWorkspaceRoot(cleanFp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                } else {
                  const wsRoot = ContextScannerService.findWorkspaceRoot(cleanFp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error parsing log file ${targetLogPath}:`, err);
      }
    }

    // 3. 從 targetConv.workspace 補充工作區
    if (targetConv.workspace) {
      const wsNorm = targetConv.workspace.replace(/\\/g, '/');
      const candidatePaths = [
        `D:/PJ/${wsNorm}`,
        `D:/PJ/${wsNorm.replace(/^PJ\//i, '')}`,
        `C:/PJ/${wsNorm}`,
        `D:/${wsNorm}`,
        `C:/${wsNorm}`
      ];
      for (const cp of candidatePaths) {
        if (fs.existsSync(cp)) {
          discoveredWorkspaceRoots.add(path.normalize(cp));
          break;
        }
      }
    }

    // 4. 建構對話快照專屬的工作區掃描清單
    const effectiveWsPaths = [];
    const seenWsPaths = new Set();

    for (const wsRoot of discoveredWorkspaceRoots) {
      if (!wsRoot || typeof wsRoot !== 'string' || !path.isAbsolute(wsRoot)) continue;
      const lower = wsRoot.toLowerCase();
      if (!seenWsPaths.has(lower) && fs.existsSync(wsRoot)) {
        try {
          if (fs.statSync(wsRoot).isDirectory()) {
            seenWsPaths.add(lower);
            effectiveWsPaths.push(wsRoot);
          }
        } catch (e) {}
      }
    }

    if (effectiveWsPaths.length === 0) {
      for (const ws of workspaceFolders) {
        const wsPath = typeof ws === 'string' ? ws : (ws.uri ? ws.uri.fsPath : (ws.path || ws));
        if (wsPath && fs.existsSync(wsPath)) {
          const lower = wsPath.toLowerCase();
          if (!seenWsPaths.has(lower)) {
            seenWsPaths.add(lower);
            effectiveWsPaths.push(path.normalize(wsPath));
          }
        }
      }
    }

    const effectiveWorkspaceObjects = effectiveWsPaths.map((p, idx) => ({
      name: ContextScannerService.formatWorkspaceName(p),
      path: p,
      index: idx
    }));

    // 5. 透過 ContextScanner 取得環境基準
    const baseEnv = await ContextScannerService.scanLiveEnvironment(effectiveWorkspaceObjects);

    // 6. DB 原生 System Prompt 逆向還原與日誌足跡歷史對齊（消除時空矛盾，嚴格還原歷史現場）
    const hasSessionDb = Boolean(dbSessionMeta && dbSessionMeta.hasSessionPrompt);
    const normDbAlwaysActive = new Set((dbSessionMeta.alwaysActiveRules || []).map(p => ContextScannerService.normalizeFsPath(p).toLowerCase()));
    const normDbConditional = new Set((dbSessionMeta.conditionalRules || []).map(p => ContextScannerService.normalizeFsPath(p).toLowerCase()));
    const normDbSkills = new Set((dbSessionMeta.availableSkills || []).map(p => ContextScannerService.normalizeFsPath(p).toLowerCase()));

    // 輔助函式：檢查實體檔案建立時間是否早於該對話活躍時間（時空防護：防範未來新增的檔案倒灌）
    const isFileCreatedBeforeConv = (filePath) => {
      if (!filePath) return false;
      try {
        const cleanFp = ContextScannerService.normalizeFsPath(filePath);
        if (!cleanFp || !fs.existsSync(cleanFp)) return false;
        const stat = fs.statSync(cleanFp);
        const birthMs = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs;
        return birthMs <= (targetConv.mtime + 60000);
      } catch (e) {
        return false;
      }
    };

    // 6.1 嚴格時光機還原：Always-Active Rules
    const finalAlwaysActive = [];
    if (hasSessionDb) {
      // 具備 DB System Prompt 紀錄：以此對話建立時真正注入之 <RULE[...]> 為唯一依據
      for (const rulePath of dbSessionMeta.alwaysActiveRules) {
        const cleanP = ContextScannerService.normalizeFsPath(rulePath);
        const lowerP = cleanP.toLowerCase();
        let ruleObj = baseEnv.rules.alwaysActive.find(r => ContextScannerService.normalizeFsPath(r.filePath).toLowerCase() === lowerP);
        if (!ruleObj) {
          ruleObj = await ContextScannerService.parseSingleRuleFile(cleanP);
        }
        if (ruleObj) {
          finalAlwaysActive.push({
            ...ruleObj,
            isAlwaysActive: true,
            isInvoked: true
          });
        }
      }
    } else {
      // 無 DB 紀錄時：過濾掉該對話結束之後才建立的未來檔案
      for (const r of baseEnv.rules.alwaysActive) {
        if (isFileCreatedBeforeConv(r.filePath)) {
          finalAlwaysActive.push({
            ...r,
            isAlwaysActive: true,
            isInvoked: true
          });
        }
      }
    }

    // 6.2 嚴格時光機還原：Conditional Rules
    const finalConditional = [];
    if (hasSessionDb) {
      for (const rulePath of dbSessionMeta.conditionalRules) {
        const cleanP = ContextScannerService.normalizeFsPath(rulePath);
        const lowerP = cleanP.toLowerCase();
        let ruleObj = baseEnv.rules.conditional.find(r => ContextScannerService.normalizeFsPath(r.filePath).toLowerCase() === lowerP);
        if (!ruleObj) {
          ruleObj = await ContextScannerService.parseSingleRuleFile(cleanP);
        }
        if (ruleObj) {
          const isInvoked = invokedRules.has(path.basename(cleanP).toLowerCase());
          finalConditional.push({
            ...ruleObj,
            isAlwaysActive: false,
            isInvoked: isInvoked
          });
        }
      }
    } else {
      for (const r of baseEnv.rules.conditional) {
        if (isFileCreatedBeforeConv(r.filePath)) {
          const isInvoked = invokedRules.has(r.name.toLowerCase());
          finalConditional.push({
            ...r,
            isAlwaysActive: false,
            isInvoked: isInvoked
          });
        }
      }
    }

    // 6.3 補充動態日誌中調用、且在當前環境中存在的 Rules（去重保護）
    for (const [ruleKey, rulePath] of discoveredRulePaths.entries()) {
      const cleanRulePath = ContextScannerService.normalizeFsPath(rulePath);
      if (!cleanRulePath || !fs.existsSync(cleanRulePath)) continue;
      const lowerCleanP = cleanRulePath.toLowerCase();

      const inAlways = finalAlwaysActive.some(r => ContextScannerService.normalizeFsPath(r.filePath).toLowerCase() === lowerCleanP);
      const inCond = finalConditional.some(r => ContextScannerService.normalizeFsPath(r.filePath).toLowerCase() === lowerCleanP);

      if (!inAlways && !inCond) {
        const parsedRule = await ContextScannerService.parseSingleRuleFile(cleanRulePath);
        if (parsedRule) {
          parsedRule.isInvoked = true;
          if (parsedRule.isAlwaysActive) {
            finalAlwaysActive.push(parsedRule);
          } else {
            finalConditional.push(parsedRule);
          }
        }
      }
    }

    // 6.4 嚴格時光機還原：Skills
    const filterAndAnnotateSkills = (skillsList) => {
      const result = [];
      for (const s of (skillsList || [])) {
        const cleanP = ContextScannerService.normalizeFsPath(s.filePath);
        const lowerP = cleanP.toLowerCase();
        const skillKey = (s.name || s.dirName || '').toLowerCase();
        const isInvoked = invokedSkills.has(skillKey) || (s.dirName && invokedSkills.has(s.dirName.toLowerCase()));

        if (hasSessionDb) {
          const inDb = normDbSkills.has(lowerP) || normDbSkills.has(skillKey);
          if (inDb || isInvoked) {
            result.push({ ...s, isInvoked: isInvoked });
          }
        } else {
          if (isFileCreatedBeforeConv(s.filePath) || isInvoked) {
            result.push({ ...s, isInvoked: isInvoked });
          }
        }
      }
      return result;
    };

    const finalSkillsWorkspace = filterAndAnnotateSkills(baseEnv.skills.workspace);
    const finalSkillsGlobal = filterAndAnnotateSkills(baseEnv.skills.global);
    const finalSkillsBuiltin = filterAndAnnotateSkills(baseEnv.skills.builtin);

    // 6.5 補充動態日誌中調用的 Skills（去重保護）
    for (const [skillKey, skillPath] of discoveredSkillPaths.entries()) {
      const cleanSkillPath = ContextScannerService.normalizeFsPath(skillPath);
      if (!cleanSkillPath || !fs.existsSync(cleanSkillPath)) continue;
      const lowerCleanP = cleanSkillPath.toLowerCase();

      const alreadyExists = [
        ...finalSkillsWorkspace,
        ...finalSkillsGlobal,
        ...finalSkillsBuiltin
      ].some(s => ContextScannerService.normalizeFsPath(s.filePath).toLowerCase() === lowerCleanP ||
                  (s.dirName && s.dirName.toLowerCase() === skillKey) ||
                  (s.name && s.name.toLowerCase() === skillKey));

      if (!alreadyExists) {
        const parsedSkill = await ContextScannerService.parseSingleSkillFile(cleanSkillPath);
        if (parsedSkill) {
          parsedSkill.isInvoked = true;
          finalSkillsWorkspace.push(parsedSkill);
        }
      }
    }

    // 7. 彙整最終 Rules 與 Skills 清單
    const annotatedRules = {
      alwaysActive: finalAlwaysActive,
      conditional: finalConditional
    };

    const annotatedSkills = {
      workspace: finalSkillsWorkspace,
      global: finalSkillsGlobal,
      builtin: finalSkillsBuiltin
    };

    // 9. 精準標註 MCP 伺服器與其個別子工具的調用狀態
    const annotatedMcp = (baseEnv.mcpServers || []).map(server => {
      const sRawName = server.name.toLowerCase();
      const sNormName = sRawName.replace(/[-_]mcp$/i, '');

      const isServerInvokedDirectly = invokedMcpServers.has(sRawName) || 
                                     invokedMcpServers.has(sNormName) || 
                                     invokedTools.has(sRawName) || 
                                     invokedTools.has(sNormName);

      const serverTools = (server.tools || []).map(t => {
        const tName = (typeof t === 'string' ? t : t.name).toLowerCase();
        const isToolInvoked = 
          invokedMcpTools.has(`mcp_${sRawName}_${tName}`) ||
          invokedMcpTools.has(`mcp_${sNormName}_${tName}`) ||
          invokedMcpTools.has(`${sRawName}.${tName}`) ||
          invokedMcpTools.has(`${sNormName}.${tName}`) ||
          invokedMcpTools.has(`${sRawName}_${tName}`) ||
          invokedMcpTools.has(`${sNormName}_${tName}`) ||
          invokedMcpTools.has(`${sRawName}:${tName}`) ||
          invokedMcpTools.has(`${sNormName}:${tName}`);

        return {
          ...(typeof t === 'string' ? { name: t } : t),
          isInvoked: isToolInvoked
        };
      });

      const serverHasInvokedTools = serverTools.some(t => t.isInvoked);
      const finalServerIsInvoked = serverHasInvokedTools || isServerInvokedDirectly;

      return {
        ...server,
        tools: serverTools,
        isInvoked: finalServerIsInvoked
      };
    });

    // 10. 全域過濾防線：徹底排除本機磁碟上已不存在的規範與技能檔案（採用統一 normalizeFsPath）
    const fileExistsFilter = (item) => {
      if (!item || !item.filePath) return false;
      const cleanFp = ContextScannerService.normalizeFsPath(item.filePath);
      return Boolean(cleanFp && fs.existsSync(cleanFp));
    };

    const finalRules = {
      alwaysActive: annotatedRules.alwaysActive.filter(fileExistsFilter),
      conditional: annotatedRules.conditional.filter(fileExistsFilter)
    };

    const finalSkills = {
      workspace: annotatedSkills.workspace.filter(fileExistsFilter),
      global: annotatedSkills.global.filter(fileExistsFilter),
      builtin: annotatedSkills.builtin.filter(fileExistsFilter)
    };

    return {
      mode: 'snapshot',
      conversationId: targetConv.id,
      conversationTitle: targetConv.title,
      timestamp: new Date(targetConv.mtime).toISOString(),
      activeDoc: activeDoc || null,
      model: currentModel || null,
      stepCount: stepCount,
      invokedSkillsCount: invokedSkills.size,
      invokedRulesCount: invokedRules.size,
      invokedTools: Array.from(invokedTools),
      rules: finalRules,
      skills: finalSkills,
      mcpServers: annotatedMcp,
      workspaces: effectiveWorkspaceObjects
    };
  }
}

module.exports = TranscriptParserService;
