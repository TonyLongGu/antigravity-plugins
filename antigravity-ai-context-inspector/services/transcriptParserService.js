const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const ContextScannerService = require('./contextScannerService');

class TranscriptParserService {
  static _convCache = new Map(); // convId -> { id, title, workspace, mtime, mtimeStr, dirPath }

  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  static getBrainDir() {
    return path.join(this.getUserHome(), '.gemini', 'antigravity-ide', 'brain');
  }

  static getConversationsDir() {
    return path.join(this.getUserHome(), '.gemini', 'antigravity-ide', 'conversations');
  }

  /**
   * 直接讀取 Antigravity IDE 官方對話數據庫中的原生 Session 命名與工作區（100% 還原 IDE 內建標題與專案標籤）
   * 採輕量分區讀取（首部 64KB 取 Workspace，尾部 256KB 取最新 Session 標題），避免大型 .db 檔案佔用記憶體
   */
  static async _extractOfficialMetadata(convId) {
    const dbPath = path.join(this.getConversationsDir(), `${convId}.db`);
    if (!fs.existsSync(dbPath)) return { title: null, workspace: null };

    let title = null;
    let workspace = null;
    let fileHandle = null;

    try {
      const stat = await fsPromises.stat(dbPath);
      const fileSize = stat.size;
      fileHandle = await fsPromises.open(dbPath, 'r');

      // 1. 輕量讀取檔案開頭 (最多 64KB) 提取專案工作區 Workspace
      const headSize = Math.min(fileSize, 65536);
      const headBuf = Buffer.alloc(headSize);
      await fileHandle.read(headBuf, 0, headSize, 0);

      const headStr = headBuf.toString('utf8');

      // 1.1 優先在 trajectory_metadata_blob (包含 main 標籤的區塊) 尋找 IDE 原生工作區
      const mainIdx = headStr.indexOf('main');
      if (mainIdx !== -1) {
        const mainSlice = headStr.slice(mainIdx, Math.min(headStr.length, mainIdx + 2048));
        const pjMatch = mainSlice.match(/file:\/\/\/[a-zA-Z]:[\\/]+PJ[\\/]+([^\\/\r\n\x00-\x1f\"\'\<\>\:]+(?:[\\/]+[^\\/\r\n\x00-\x1f\"\'\<\>\:]+)?)/i);
        if (pjMatch) {
          workspace = pjMatch[1].replace(/\\/g, '/').replace(/\/+$/, '');
        } else {
          const anyMatch = mainSlice.match(/file:\/\/\/[a-zA-Z]:[\\/]+(?!Users[\\/]+[^\r\n\\/]+[\\/]+AppData)([^\\/\r\n\x00-\x1f\"\'\<\>\:]+(?:[\\/]+[^\\/\r\n\x00-\x1f\"\'\<\>\:]+)?)/i);
          if (anyMatch) {
            workspace = anyMatch[1].replace(/\\/g, '/').replace(/\/+$/, '');
          }
        }
      }

      // 1.2 若未命中，全域掃描排除 AppData/Temp/.gemini 的專案路徑
      if (!workspace) {
        const allMatches = headStr.matchAll(/file:\/\/\/[a-zA-Z]:[\\/]+(?:PJ[\\/]+)?([^\\/\r\n\x00-\x1f\"\'\<\>\:]+(?:[\\/]+[^\\/\r\n\x00-\x1f\"\'\<\>\:]+)?)/gi);
        for (const m of allMatches) {
          const p = m[0];
          if (!p.includes('AppData') && !p.includes('.gemini') && !p.includes('Temp') && !p.includes('node_modules')) {
            const ws = m[1].replace(/\\/g, '/').replace(/\/+$/, '');
            if (ws && !ws.toLowerCase().startsWith('users/')) {
              workspace = ws;
              break;
            }
          }
        }
      }

      // 2. 輕量讀取檔案尾部 (最多 256KB) 提取最新 Session 官方標題
      const tailReadSize = Math.min(fileSize, 262144);
      const tailOffset = Math.max(0, fileSize - tailReadSize);
      const tailBuf = Buffer.alloc(tailReadSize);
      await fileHandle.read(tailBuf, 0, tailReadSize, tailOffset);

      title = this._scanTitleInBuf(tailBuf);

      // 3. 若尾部未命中且檔案大於尾部讀取區塊，回退讀取頭部 (最多 512KB)
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

    return { title, workspace };
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
  static async _parseSingleConvMetadata(convId, convDir, mtimeMs) {
    const cached = this._convCache.get(convId);
    if (cached && cached.mtime === mtimeMs) {
      return cached;
    }

    const transcriptPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
    const fullTranscriptPath = path.join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl');
    const targetLog = fs.existsSync(transcriptPath) ? transcriptPath : (fs.existsSync(fullTranscriptPath) ? fullTranscriptPath : null);

    let title = '';
    let workspace = '';
    let firstCleanedReq = '';

    // 1. 最高優先：讀取 IDE 官方原生命名的會話主題與工作區（與 IDE 原生聊天記錄完全同步）
    const officialMeta = await this._extractOfficialMetadata(convId);
    if (officialMeta.title) {
      title = officialMeta.title;
    }
    if (officialMeta.workspace) {
      workspace = officialMeta.workspace;
    }

    // 2. 次選：從 implementation_plan.md 或 walkthrough.md 提取明確任務總標題
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
              const cleanedTitle = m[1].replace(/實作計畫|實施方案|開發完成|成果報告|Implementation Plan|Walkthrough/gi, '').trim();
              if (cleanedTitle) {
                title = cleanedTitle;
                break;
              }
            }
          } catch (e) {}
        }
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

            // 2. 首句使用者真實請求提取
            if (!firstCleanedReq && parsed.type === 'USER_INPUT' && parsed.content) {
              const reqMatch = parsed.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
              if (reqMatch) {
                const rawReq = reqMatch[1];
                let cleanedText = rawReq
                  .replace(/@\[[^\]]+\]/g, ' ')
                  .replace(/@[^\s]+/g, ' ')
                  .replace(/[\r\n\t]+/g, ' ')
                  .replace(/\s{2,}/g, ' ')
                  .trim();
                if (cleanedText.length > 0) {
                  firstCleanedReq = cleanedText.slice(0, 50);
                }
              }

              // 從使用者請求中的路徑或提及專案獲取工作區
              if (!workspace && parsed.content) {
                const wsUserMatch = parsed.content.match(/[a-zA-Z]:[\\/]+(?:PJ[\\/]+)?([^\\/\r\n]+[\\/]+[^\\/\r\n]+)/i);
                if (wsUserMatch) {
                  workspace = wsUserMatch[1].replace(/\\/g, '/');
                }
              }
            }

            // 3. 官方任務主題 (USER Objective，排除歷史摘要後)
            if (!title && parsed.content && parsed.content.includes('USER Objective:')) {
              const mObj = parsed.content.match(/#\s*USER Objective:\s*([^\r\n]+)/);
              if (mObj && mObj[1].trim()) {
                title = mObj[1].trim();
              }
            }

            // 4. 工作區資訊 (Workspace) 備用解析
            if (!workspace && parsed.content) {
              const docMatch = parsed.content.match(/(?:Active Document|open documents|file:\/\/+|@\[)[^\r\n]*?[a-zA-Z]:[\\/]+(?:PJ[\\/]+)?([^\\/\r\n]+[\\/]+[^\\/\r\n]+)/i);
              if (docMatch) {
                workspace = docMatch[1].replace(/\\/g, '/');
              } else {
                const pjMatch = parsed.content.match(/[a-zA-Z]:[\\/]+PJ[\\/]+([^\\/\r\n]+[\\/]+[^\\/\r\n]+)/i);
                if (pjMatch) {
                  workspace = pjMatch[1].replace(/\\/g, '/');
                } else {
                  const ruleMatch = parsed.content.match(/<RULE\[[a-zA-Z]:[\\/]+(?:PJ[\\/]+)?([^\\/\r\n]+[\\/]+[^\\/\r\n]+)/i);
                  if (ruleMatch) {
                    workspace = ruleMatch[1].replace(/\\/g, '/');
                  }
                }
              }
            }

            if (title && workspace) break;
          } catch (e) {}
        }
      } catch (err) {
      } finally {
        if (fileHandle !== null) {
          try { await fileHandle.close(); } catch(e){}
        }
      }
    }

    if (!title && firstCleanedReq) {
      title = firstCleanedReq;
    }

    const result = {
      id: convId,
      title: title || `對話任務 (${convId.slice(0, 8)})`,
      workspace: workspace || '',
      mtime: mtimeMs,
      mtimeStr: new Date(mtimeMs).toLocaleString(),
      dirPath: convDir
    };

    this._convCache.set(convId, result);
    return result;
  }

  /**
   * 取得所有歷史對話任務清單（依修改時間降冪排列，支援記憶體極速快取）
   */
  static async getConversationsList() {
    const brainDir = this.getBrainDir();
    if (!fs.existsSync(brainDir)) return [];

    try {
      const entries = await fsPromises.readdir(brainDir, { withFileTypes: true });
      const validEntries = [];

      await Promise.all(entries.map(async (entry) => {
        if (entry.isDirectory() && entry.name !== 'scratch' && entry.name !== 'tempmediaStorage' && !entry.name.startsWith('.')) {
          const convId = entry.name;
          const convDir = path.join(brainDir, convId);
          try {
            const stat = await fsPromises.stat(convDir);
            let lastActiveTime = stat.mtimeMs;

            // 1. 檢查對話資料庫 .db 的最後寫入時間 (舊對話被重新啟用時會更新 .db)
            const dbPath = path.join(this.getConversationsDir(), `${convId}.db`);
            if (fs.existsSync(dbPath)) {
              try {
                const dbStat = await fsPromises.stat(dbPath);
                if (dbStat.mtimeMs > lastActiveTime) {
                  lastActiveTime = dbStat.mtimeMs;
                }
              } catch (e) {}
            }

            // 2. 檢查日誌 transcript.jsonl 的最後修改時間
            const logPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(logPath)) {
              try {
                const logStat = await fsPromises.stat(logPath);
                if (logStat.mtimeMs > lastActiveTime) {
                  lastActiveTime = logStat.mtimeMs;
                }
              } catch (e) {}
            }

            validEntries.push({ convId, convDir, mtime: lastActiveTime });
          } catch (e) {}
        }
      }));

      // 依真正最後活躍時間排序由新到舊
      validEntries.sort((a, b) => b.mtime - a.mtime);

      const parsedResults = await Promise.all(validEntries.map(e => this._parseSingleConvMetadata(e.convId, e.convDir, e.mtime)));
      return parsedResults;
    } catch (err) {
      console.error('Error reading conversations list:', err);
      return [];
    }
  }

  /**
   * 從對話資料庫 .db 中精準提取該 Session 建立時由 Antigravity IDE 靜態注入的全部常駐規範、條件式規範與可用技能
   */
  static async _extractSessionMetadataFromDb(convId) {
    const dbPath = path.join(this.getConversationsDir(), `${convId}.db`);
    if (!fs.existsSync(dbPath)) {
      return { alwaysActiveRules: [], conditionalRules: [], availableSkills: [], workspaces: [] };
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
        const rPath = path.normalize(rm[1].trim());
        if (fs.existsSync(rPath)) {
          alwaysActiveRules.add(rPath);
          const ws = ContextScannerService.findWorkspaceRoot(rPath);
          if (ws) workspaces.add(ws);
        }
      }

      // 2. 提取靜態注入之條件式規範 - file:///D:/.../.agents/rules/...
      const condRuleMatches = str.matchAll(/-\s+file:\/\/\/([a-zA-Z]:[^\r\n:]+\.agents[\\/]rules[\\/][^\r\n:]+\.md)/gi);
      for (const crm of condRuleMatches) {
        const rPath = path.normalize(crm[1].trim());
        if (fs.existsSync(rPath)) {
          conditionalRules.add(rPath);
          const ws = ContextScannerService.findWorkspaceRoot(rPath);
          if (ws) workspaces.add(ws);
        }
      }

      // 3. 提取靜態注入之可用技能清單 - skill-name (D:\.../SKILL.md)
      const skillMatches = str.matchAll(/-\s+([a-zA-Z0-9_\-]+)\s+\(([a-zA-Z]:[^\r\n\)]+SKILL\.md)\)/gi);
      for (const sm of skillMatches) {
        const sPath = path.normalize(sm[2].trim());
        if (fs.existsSync(sPath)) {
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

      return {
        alwaysActiveRules: Array.from(alwaysActiveRules),
        conditionalRules: Array.from(conditionalRules),
        availableSkills: Array.from(availableSkills),
        workspaces: Array.from(workspaces)
      };
    } catch (err) {
      return { alwaysActiveRules: [], conditionalRules: [], availableSkills: [], workspaces: [] };
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
    const touchedFiles = new Set();
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

            // 從內容中掃描提及的檔案與專案路徑
            const fileMatches = obj.content.matchAll(/(?:file:\/\/\/?|[a-zA-Z]:[\\/])(?:PJ[\\/]|Users[\\/])?[^`"'\r\n\t\<\>\(\)]+/gi);
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
                const wsRoot = ContextScannerService.findWorkspaceRoot(tc.args.Cwd) || (fs.existsSync(tc.args.Cwd) ? path.normalize(tc.args.Cwd) : null);
                if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
              }
              if (tc.args?.DirectoryPath && typeof tc.args.DirectoryPath === 'string') {
                const wsRoot = ContextScannerService.findWorkspaceRoot(tc.args.DirectoryPath) || (fs.existsSync(tc.args.DirectoryPath) ? path.normalize(tc.args.DirectoryPath) : null);
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
                fp = fp.replace(/^["']|["']$/g, '').trim();
                const lowerFp = fp.toLowerCase();
                touchedFiles.add(lowerFp);
                if (lowerFp.includes('skill.md')) {
                  const skillDir = path.basename(path.dirname(fp));
                  const skillKey = skillDir.toLowerCase();
                  invokedSkills.add(skillKey);
                  discoveredSkillPaths.set(skillKey, fp);
                  const wsRoot = ContextScannerService.findWorkspaceRoot(fp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                }
                if (lowerFp.includes('.agents\\rules') || lowerFp.includes('/.agents/rules') || lowerFp.includes('.gemini\\config\\rules') || lowerFp.includes('/.gemini/config/rules')) {
                  const ruleKey = path.basename(fp).toLowerCase();
                  invokedRules.add(ruleKey);
                  discoveredRulePaths.set(ruleKey, fp);
                  const wsRoot = ContextScannerService.findWorkspaceRoot(fp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                } else {
                  const wsRoot = ContextScannerService.findWorkspaceRoot(fp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                }
              }
            }
          }

          // 提取 VIEW_FILE 等 step
          if (obj.type === 'VIEW_FILE' && obj.content) {
            const matchPath = obj.content.match(/File Path:\s*`file:\/\/\/?([^`]+)`/);
            if (matchPath) {
              let fp = matchPath[1];
              if (fp && typeof fp === 'string') {
                fp = fp.replace(/^["']|["']$/g, '').trim();
                const lowerFp = fp.toLowerCase();
                touchedFiles.add(lowerFp);
                if (lowerFp.includes('skill.md')) {
                  const skillDir = path.basename(path.dirname(fp));
                  const skillKey = skillDir.toLowerCase();
                  invokedSkills.add(skillKey);
                  discoveredSkillPaths.set(skillKey, fp);
                  const wsRoot = ContextScannerService.findWorkspaceRoot(fp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                }
                if (lowerFp.includes('.agents\\rules') || lowerFp.includes('/.agents/rules') || lowerFp.includes('.gemini\\config\\rules') || lowerFp.includes('/.gemini/config/rules')) {
                  const ruleKey = path.basename(fp).toLowerCase();
                  invokedRules.add(ruleKey);
                  discoveredRulePaths.set(ruleKey, fp);
                  const wsRoot = ContextScannerService.findWorkspaceRoot(fp);
                  if (wsRoot) discoveredWorkspaceRoots.add(wsRoot);
                } else {
                  const wsRoot = ContextScannerService.findWorkspaceRoot(fp);
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
      const lower = wsRoot.toLowerCase();
      if (!seenWsPaths.has(lower) && fs.existsSync(wsRoot)) {
        seenWsPaths.add(lower);
        effectiveWsPaths.push(wsRoot);
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

    // 6. DB 原生 System Prompt 逆向注入與日誌足跡直接補全
    // 6.1 補全 Always-Active Rules
    for (const rulePath of dbSessionMeta.alwaysActiveRules) {
      const exists = baseEnv.rules.alwaysActive.some(r => r.filePath && r.filePath.toLowerCase() === rulePath.toLowerCase());
      if (!exists) {
        const parsedRule = await ContextScannerService.parseSingleRuleFile(rulePath);
        if (parsedRule) {
          parsedRule.isAlwaysActive = true;
          baseEnv.rules.alwaysActive.push(parsedRule);
        }
      }
    }

    // 6.2 補全 Conditional Rules
    for (const rulePath of dbSessionMeta.conditionalRules) {
      const exists = [...baseEnv.rules.alwaysActive, ...baseEnv.rules.conditional].some(r => r.filePath && r.filePath.toLowerCase() === rulePath.toLowerCase());
      if (!exists) {
        const parsedRule = await ContextScannerService.parseSingleRuleFile(rulePath);
        if (parsedRule) {
          baseEnv.rules.conditional.push(parsedRule);
        }
      }
    }

    // 6.3 補全 Available Skills
    for (const skillPath of dbSessionMeta.availableSkills) {
      const exists = [
        ...(baseEnv.skills.workspace || []),
        ...(baseEnv.skills.global || []),
        ...(baseEnv.skills.builtin || [])
      ].some(s => s.filePath && s.filePath.toLowerCase() === skillPath.toLowerCase());
      if (!exists) {
        const parsedSkill = await ContextScannerService.parseSingleSkillFile(skillPath);
        if (parsedSkill) {
          baseEnv.skills.workspace.push(parsedSkill);
        }
      }
    }

    // 6.4 補全動態日誌中的 Skills
    for (const [skillKey, skillPath] of discoveredSkillPaths.entries()) {
      const alreadyExists = [
        ...(baseEnv.skills.workspace || []),
        ...(baseEnv.skills.global || []),
        ...(baseEnv.skills.builtin || [])
      ].some(s => (s.filePath && s.filePath.toLowerCase() === skillPath.toLowerCase()) || 
                  (s.dirName && s.dirName.toLowerCase() === skillKey) || 
                  (s.name && s.name.toLowerCase() === skillKey));

      if (!alreadyExists) {
        const parsedSkill = await ContextScannerService.parseSingleSkillFile(skillPath);
        if (parsedSkill) {
          parsedSkill.isInvoked = true;
          baseEnv.skills.workspace.push(parsedSkill);
        } else {
          baseEnv.skills.workspace.push({
            name: skillKey,
            displayName: skillKey,
            dirName: skillKey,
            description: '此對話調用之技能（檔案未在當前目錄中）',
            filePath: skillPath,
            dirPath: path.dirname(skillPath),
            source: ContextScannerService.formatWorkspaceName(path.resolve(path.dirname(skillPath), '../../..')),
            type: 'workspace',
            isInvoked: true,
            sizeBytes: 0
          });
        }
      }
    }

    // 6.5 補全動態日誌中的 Rules
    for (const [ruleKey, rulePath] of discoveredRulePaths.entries()) {
      const alreadyExists = [
        ...(baseEnv.rules.alwaysActive || []),
        ...(baseEnv.rules.conditional || [])
      ].some(r => (r.filePath && r.filePath.toLowerCase() === rulePath.toLowerCase()) || 
                  (r.name && r.name.toLowerCase() === ruleKey));

      if (!alreadyExists) {
        const parsedRule = await ContextScannerService.parseSingleRuleFile(rulePath);
        if (parsedRule) {
          parsedRule.isInvoked = true;
          if (parsedRule.isAlwaysActive) {
            baseEnv.rules.alwaysActive.push(parsedRule);
          } else {
            baseEnv.rules.conditional.push(parsedRule);
          }
        }
      }
    }

    // 7. 標註並過濾 Rules
    const annotateRule = (r) => {
      const isAlwaysActive = r.isAlwaysActive || dbSessionMeta.alwaysActiveRules.some(p => p.toLowerCase() === r.filePath?.toLowerCase());
      const isInvoked = invokedRules.has(r.name.toLowerCase()) || isAlwaysActive;
      return {
        ...r,
        isAlwaysActive: isAlwaysActive,
        isInvoked: isInvoked
      };
    };

    const annotatedRules = {
      alwaysActive: baseEnv.rules.alwaysActive.map(annotateRule),
      conditional: baseEnv.rules.conditional.map(annotateRule)
    };

    // 8. 標註 Skills
    const annotateSkill = (s) => {
      const isInvoked = invokedSkills.has(s.name.toLowerCase()) || invokedSkills.has(s.dirName?.toLowerCase());
      return {
        ...s,
        isInvoked: isInvoked
      };
    };

    const annotatedSkills = {
      workspace: (baseEnv.skills.workspace || []).map(annotateSkill),
      global: (baseEnv.skills.global || []).map(annotateSkill),
      builtin: (baseEnv.skills.builtin || []).map(annotateSkill)
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
      rules: annotatedRules,
      skills: annotatedSkills,
      mcpServers: annotatedMcp,
      workspaces: effectiveWorkspaceObjects
    };
  }
}

module.exports = TranscriptParserService;
