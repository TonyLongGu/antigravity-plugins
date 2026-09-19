const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const McpDetectorService = require('./mcpDetectorService');

class ContextScannerService {
  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  /**
   * 提取 YAML Frontmatter 中的 key-value (安全解析)
   */
  static parseFrontmatter(content) {
    const result = { name: '', description: '', trigger: '' };
    if (!content || !content.startsWith('---')) return result;
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return result;

    const lines = match[1].split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim().replace(/^["']|["']$/g, '');
        if (key === 'name') result.name = value;
        if (key === 'description') result.description = value;
        if (key === 'trigger') result.trigger = value;
      }
    }
    return result;
  }

  /**
   * 字母與數字自然排序 (Natural Sort / Explorer Sort)
   */
  static naturalCompare(a, b) {
    return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
  }

  /**
   * 掃描指定目錄底下的所有 Rules (.md 檔案)
   */
  static async scanRulesInDir(dirPath, sourceName, isGlobal = false, wsIndex = 999) {
    const rules = [];
    if (!fs.existsSync(dirPath)) return rules;

    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      const mdFiles = entries
        .filter(file => file.isFile() && file.name.endsWith('.md'))
        .sort((a, b) => this.naturalCompare(a.name, b.name));
      
      const parsedRules = await Promise.all(
        mdFiles.map(async (file) => {
          const filePath = path.join(dirPath, file.name);
          try {
            const stat = await fsPromises.stat(filePath);
            const content = await fsPromises.readFile(filePath, 'utf-8');
            const lines = content.split(/\r?\n/);
            const meta = this.parseFrontmatter(content);
            
            // 提取第一行標題作為簡介
            let firstHeader = '';
            for (const line of lines) {
              if (line.startsWith('#')) {
                firstHeader = line.replace(/^#+\s*/, '').trim();
                break;
              }
            }

            // 判斷是否為核心常駐規範 (如 core-guidelines 或 trigger === always_on)
            const isAlwaysActive = meta.trigger === 'always_on' || file.name.toLowerCase().includes('core-guidelines') || isGlobal;

            // 提取描述：優先使用 YAML description
            let desc = meta.description || '';
            if (!desc) {
              // 若無 YAML description，過濾掉標題提取第一段文字
              const bodyLines = lines.filter(l => !l.startsWith('#') && !l.startsWith('---') && l.trim());
              if (bodyLines.length > 0) {
                desc = bodyLines.slice(0, 3).join(' ').trim();
              }
            }

            return {
              name: file.name,
              displayName: firstHeader || file.name,
              filePath: filePath,
              source: sourceName,
              wsIndex: wsIndex,
              isGlobal: isGlobal,
              isAlwaysActive: isAlwaysActive,
              trigger: meta.trigger || (isAlwaysActive ? 'always_on' : 'model_decision'),
              description: desc,
              lineCount: lines.length,
              sizeBytes: stat.size
            };
          } catch (e) {
            console.error(`Error processing rule file ${filePath}:`, e);
            return null;
          }
        })
      );
      rules.push(...parsedRules.filter(Boolean));
    } catch (err) {
      console.error(`Error scanning rules in ${dirPath}:`, err);
    }
    return rules;
  }

  /**
   * 掃描指定目錄底下的所有 Skills (含有 SKILL.md 的子資料夾)
   */
  static async scanSkillsInDir(dirPath, sourceName, type = 'workspace', wsIndex = 999) {
    const skills = [];
    if (!fs.existsSync(dirPath)) return skills;

    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      const skillDirs = entries
        .filter(entry => entry.isDirectory())
        .sort((a, b) => this.naturalCompare(a.name, b.name));
      
      const parsedSkills = await Promise.all(
        skillDirs.map(async (entry) => {
          const skillDir = path.join(dirPath, entry.name);
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          try {
            if (!fs.existsSync(skillMdPath)) return null;
            const content = await fsPromises.readFile(skillMdPath, 'utf-8');
            const meta = this.parseFrontmatter(content);
            const stat = await fsPromises.stat(skillMdPath);
            const lines = content.split(/\r?\n/);

            // 提取內文第一個一級標題 (# 標題) 作為顯示名稱
            let firstHeader = '';
            let inFrontmatter = false;
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
              }
              if (!inFrontmatter && trimmed.startsWith('#')) {
                firstHeader = trimmed.replace(/^#+\s*/, '').trim();
                break;
              }
            }

            const rawName = meta.name || entry.name;
            const displayName = firstHeader || rawName;

            return {
              name: rawName,
              displayName: displayName,
              dirName: entry.name,
              description: meta.description || '無描述',
              filePath: skillMdPath,
              dirPath: skillDir,
              source: sourceName,
              wsIndex: wsIndex,
              type: type, // 'builtin' | 'global' | 'workspace'
              sizeBytes: stat.size
            };
          } catch (e) {
            console.error(`Error processing skill file ${skillMdPath}:`, e);
            return null;
          }
        })
      );
      skills.push(...parsedSkills.filter(Boolean));
    } catch (err) {
      console.error(`Error scanning skills in ${dirPath}:`, err);
    }
    return skills;
  }

  /**
   * 執行全方位環境即時掃描（嚴格遵循 VS Code 檔案總管專案順序與 A-Z 自然排序）
   */
  static async scanLiveEnvironment(workspaceFolders = [], options = {}) {
    const isVsCode = Boolean(options.isVsCode);
    const isCursor = Boolean(options.isCursor);
    const userHome = this.getUserHome();
    const globalConfigDir = path.join(userHome, '.gemini', 'config');
    const builtinSkillsDir = path.join(userHome, '.gemini', 'antigravity-ide', 'builtin', 'skills');

    const result = {
      mode: 'live',
      timestamp: new Date().toISOString(),
      workspaces: [],
      rules: {
        alwaysActive: [],
        conditional: []
      },
      skills: {
        builtin: [],
        extension: [],
        global: [],
        workspace: []
      },
      mcpServers: []
    };

    // 1. 依序處理工作區清單（嚴格依照檔案總管專案由上而下順序）
    for (let wsIndex = 0; wsIndex < workspaceFolders.length; wsIndex++) {
      const ws = workspaceFolders[wsIndex];
      const wsPath = typeof ws === 'string' ? ws : (ws.uri ? ws.uri.fsPath : (ws.path || ws));
      const wsName = typeof ws === 'object' && ws.name ? ws.name : this.formatWorkspaceName(wsPath);
      result.workspaces.push({
        name: wsName,
        path: wsPath,
        index: wsIndex
      });

      // 1.1 掃描專案獨立常駐規範 (AGENTS.md / GEMINI.md，支援工作區根目錄與 .agents 目錄)
      const standaloneCandidates = [
        path.join(wsPath, 'AGENTS.md'),
        path.join(wsPath, 'GEMINI.md'),
        path.join(wsPath, '.agents', 'AGENTS.md'),
        path.join(wsPath, '.agents', 'GEMINI.md')
      ];
      for (const candPath of standaloneCandidates) {
        if (fs.existsSync(candPath)) {
          const rule = await this.parseSingleRuleFile(candPath, wsName, false, wsIndex);
          if (rule) {
            const alreadyExists = result.rules.alwaysActive.some(r => r.filePath && r.filePath.toLowerCase() === rule.filePath.toLowerCase());
            if (!alreadyExists) {
              result.rules.alwaysActive.push(rule);
            }
          }
        }
      }

      // 1.2 掃描 Workspace Rules（專案內依檔名自然排序）
      const wsRulesDir = path.join(wsPath, '.agents', 'rules');
      const wsRules = await this.scanRulesInDir(wsRulesDir, wsName, false, wsIndex);
      for (const r of wsRules) {
        const alreadyExists = [...result.rules.alwaysActive, ...result.rules.conditional].some(existing => existing.filePath && existing.filePath.toLowerCase() === r.filePath.toLowerCase());
        if (!alreadyExists) {
          if (r.isAlwaysActive) {
            result.rules.alwaysActive.push(r);
          } else {
            result.rules.conditional.push(r);
          }
        }
      }

      // 1.3 掃描 Workspace Skills（專案內依資料夾名稱自然排序）
      const wsSkillDirs = [path.join(wsPath, '.agents', 'skills')];
      if (isVsCode && !isCursor) {
        wsSkillDirs.push(
          path.join(wsPath, '.github', 'skills'),
          path.join(wsPath, '.claude', 'skills'),
          path.join(wsPath, '.copilot', 'skills')
        );
      }
      for (const wsSkillsDir of wsSkillDirs) {
        const wsSkills = await this.scanSkillsInDir(wsSkillsDir, wsName, 'workspace', wsIndex);
        this._mergeSkills(result.skills.workspace, wsSkills);
      }
    }

    // 2. 掃描全域 Rules 與 Skills (排在工作區之後)
    // 2.1 全域獨立常駐規範 (AGENTS.md / GEMINI.md)
    const globalStandaloneCandidates = [
      path.join(globalConfigDir, 'AGENTS.md'),
      path.join(globalConfigDir, 'GEMINI.md')
    ];
    for (const candPath of globalStandaloneCandidates) {
      if (fs.existsSync(candPath)) {
        const rule = await this.parseSingleRuleFile(candPath, '全域設定 (Global)', true, 1000);
        if (rule) {
          const alreadyExists = result.rules.alwaysActive.some(r => r.filePath && r.filePath.toLowerCase() === rule.filePath.toLowerCase());
          if (!alreadyExists) {
            result.rules.alwaysActive.push(rule);
          }
        }
      }
    }

    // 2.2 全域 Rules 目錄
    const globalRulesDir = path.join(globalConfigDir, 'rules');
    const globalRules = await this.scanRulesInDir(globalRulesDir, '全域設定 (Global)', true, 1000);
    for (const r of globalRules) {
      const alreadyExists = result.rules.alwaysActive.some(existing => existing.filePath && existing.filePath.toLowerCase() === r.filePath.toLowerCase());
      if (!alreadyExists) {
        result.rules.alwaysActive.push(r);
      }
    }

    const globalSkillsDir = path.join(globalConfigDir, 'skills');
    if (!(isVsCode && !isCursor)) {
      const globalSkills = await this.scanSkillsInDir(globalSkillsDir, '全域技能 (Global)', 'global', 1000);
      result.skills.global.push(...globalSkills);
    }

    // 3. 掃描內建 / VS Code Copilot 技能
    if (!isVsCode) {
      const builtinSkills = await this.scanSkillsInDir(builtinSkillsDir, 'Antigravity 內建', 'builtin', 2000);
      result.skills.builtin.push(...builtinSkills);
    } else if (isCursor) {
      const cursorBuiltinDir = path.join(userHome, '.cursor', 'skills-cursor');
      const builtinSkills = await this.scanSkillsInDir(cursorBuiltinDir, 'Cursor 內建', 'builtin', 2000);
      result.skills.builtin.push(...builtinSkills);
    } else {
      await this.scanVsCodeAgentSkills(result, options);
    }

    // 4. 掃描 MCP 伺服器與工具
    // Antigravity：本機 MCP 目錄；Cursor：~/.cursor/mcp.json；VS Code：%APPDATA%/Code/User/mcp.json
    if (!isVsCode) {
      result.mcpServers = await McpDetectorService.scanMcpServers(workspaceFolders);
    } else if (isCursor) {
      result.mcpServers = await McpDetectorService.scanCursorMcpServers(workspaceFolders);
    } else {
      result.mcpServers = await McpDetectorService.scanVsCodeMcpServers(workspaceFolders);
    }

    return result;
  }

  static _mergeSkills(target, list) {
    for (const skill of list || []) {
      const key = (skill.dirName || skill.name || '').toLowerCase();
      const fileKey = (skill.filePath || '').toLowerCase();
      if (!key && !fileKey) continue;
      const exists = target.some((item) => {
        const itemKey = (item.dirName || item.name || '').toLowerCase();
        const itemFile = (item.filePath || '').toLowerCase();
        return (key && itemKey === key) || (fileKey && itemFile === fileKey);
      });
      if (!exists) target.push(skill);
    }
  }

  /**
   * VS Code Copilot 技能：使用者 / 擴充 / 內建
   * 使用者：~/.claude/skills、~/.copilot/skills、~/.agents/skills
   * 擴充：已安裝擴充套件的 skills/ 目錄（由 extension host 傳入）
   * 內建：vscode.env.appRoot 底下 Copilot 隨附 skills
   */
  static async scanVsCodeAgentSkills(result, options = {}) {
    const userHome = this.getUserHome();
    const userDirs = [
      path.join(userHome, '.claude', 'skills'),
      path.join(userHome, '.copilot', 'skills'),
      path.join(userHome, '.agents', 'skills'),
      path.join(userHome, '.github', 'skills')
    ];
    for (const dir of userDirs) {
      const skills = await this.scanSkillsInDir(dir, '使用者', 'global', 1000);
      this._mergeSkills(result.skills.global, skills);
    }

    const extensionDirs = Array.isArray(options.extensionSkillDirs) ? options.extensionSkillDirs : [];
    for (const item of extensionDirs) {
      const dir = typeof item === 'string' ? item : item.dir;
      const source = (typeof item === 'object' && item.source) ? item.source : '擴充';
      if (!dir) continue;
      const skills = await this.scanSkillsInDir(dir, source, 'extension', 1500);
      this._mergeSkills(result.skills.extension, skills);
    }

    const appRoot = typeof options.appRoot === 'string' ? options.appRoot : '';
    const builtinDirs = [];
    if (appRoot) {
      builtinDirs.push(path.join(appRoot, 'extensions', 'copilot', 'assets', 'prompts', 'skills'));
    }
    for (const dir of builtinDirs) {
      const skills = await this.scanSkillsInDir(dir, 'VS Code 內建', 'builtin', 2000);
      this._mergeSkills(result.skills.builtin, skills);
    }
  }

  /**
   * 格式化專案路徑為簡潔優美的顯示名稱 (例如 D:\PJ\ComfyUiPj\ai -> ComfyUiPj \ ai)
   */
  static formatWorkspaceName(wsPath) {
    if (!wsPath || typeof wsPath !== 'string') return '';
    let decoded = wsPath;
    try {
      decoded = decodeURIComponent(wsPath);
    } catch (e) {}
    const norm = decoded.replace(/\\/g, '/').replace(/\/+$/, '');
    if (norm.toLowerCase().includes('/pj/')) {
      const parts = norm.split(/\/pj\//i);
      if (parts.length > 1 && parts[1]) {
        return parts[1].replace(/\//g, ' \\ ');
      }
    }
    const segs = norm.split('/').filter(Boolean);
    if (segs.length >= 2) {
      return `${segs[segs.length - 2]} \\ ${segs[segs.length - 1]}`;
    }
    return segs[segs.length - 1] || decoded;
  }

  /**
   * 安全標準化本機路徑：徹底處理 URI 編碼、file:/// 協議前綴、引號與 Windows 斜線相容性
   */
  static normalizeFsPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    let p = filePath.trim().replace(/^["']|["']$/g, '');
    try {
      p = decodeURIComponent(p);
    } catch (e) {}
    p = p.replace(/^file:\/\/\/?/i, '');
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) {
      p = p.slice(1);
    }
    return path.normalize(p);
  }

  /**
   * 依據給定檔案或目錄路徑，向上溯源尋找所屬之工作區根目錄（含有 .agents）
   */
  static findWorkspaceRoot(filePath) {
    const cleanPath = this.normalizeFsPath(filePath).replace(/[\\/]+$/, '');
    if (!cleanPath || !path.isAbsolute(cleanPath)) return null;

    // 1. 如果路徑中包含 .agents，直接截取 .agents 前一層作為工作區根目錄
    const agentsIdx = cleanPath.toLowerCase().indexOf(path.sep + '.agents');
    if (agentsIdx !== -1) {
      const candidate = cleanPath.slice(0, agentsIdx);
      if (fs.existsSync(candidate)) return path.normalize(candidate);
    }

    // 2. 向上逐層尋找包含 .agents 的目錄（排除使用者家目錄與磁碟根目錄避免誤判）
    try {
      const userHomeNorm = path.normalize(this.getUserHome()).toLowerCase();
      let current = fs.existsSync(cleanPath) && fs.statSync(cleanPath).isDirectory() 
        ? cleanPath 
        : path.dirname(cleanPath);
      
      const root = path.parse(current).root;
      while (current && current !== root) {
        const curNorm = path.normalize(current).toLowerCase();
        // 避免將 C:\Users\User 或磁碟根目錄誤判為專案工作區
        if (curNorm === userHomeNorm || curNorm === root.toLowerCase()) break;

        if (fs.existsSync(path.join(current, '.agents')) || fs.existsSync(path.join(current, '.git'))) {
          return path.normalize(current);
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    } catch (e) {}

    return null;
  }

  /**
   * 單檔解析單一 Rule (.md)
   */
  static async parseSingleRuleFile(filePath, sourceName = '', isGlobal = false, wsIndex = 999) {
    const cleanPath = this.normalizeFsPath(filePath);
    if (!cleanPath || !fs.existsSync(cleanPath)) return null;
    try {
      const stat = await fsPromises.stat(cleanPath);
      const content = await fsPromises.readFile(cleanPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const meta = this.parseFrontmatter(content);
      const fileName = path.basename(cleanPath);

      let firstHeader = '';
      for (const line of lines) {
        if (line.startsWith('#')) {
          firstHeader = line.replace(/^#+\s*/, '').trim();
          break;
        }
      }

      // 判斷是否為獨立常駐規範 (AGENTS.md 或 GEMINI.md，官方標準原生常駐)
      const isStandaloneRule = /^(agents|gemini)\.md$/i.test(fileName);
      const isAlwaysActive = meta.trigger === 'always_on' || fileName.toLowerCase().includes('core-guidelines') || isGlobal || isStandaloneRule;

      let desc = meta.description || '';
      if (!desc) {
        const bodyLines = lines.filter(l => !l.startsWith('#') && !l.startsWith('---') && l.trim());
        if (bodyLines.length > 0) {
          desc = bodyLines.slice(0, 3).join(' ').trim();
        }
      }

      let finalSource = sourceName;
      if (!finalSource) {
        if (isGlobal) {
          finalSource = '全域設定 (Global)';
        } else {
          const wsRoot = this.findWorkspaceRoot(cleanPath);
          if (wsRoot) {
            finalSource = this.formatWorkspaceName(wsRoot);
          } else {
            const parentDir = path.dirname(cleanPath);
            if (cleanPath.toLowerCase().includes(path.sep + '.agents' + path.sep + 'rules')) {
              finalSource = this.formatWorkspaceName(path.resolve(cleanPath, '../..'));
            } else {
              finalSource = this.formatWorkspaceName(parentDir);
            }
          }
        }
      }

      return {
        name: fileName,
        displayName: firstHeader || fileName,
        filePath: cleanPath,
        source: finalSource,
        wsIndex: wsIndex,
        isGlobal: isGlobal,
        isAlwaysActive: isAlwaysActive,
        trigger: meta.trigger || (isAlwaysActive ? 'always_on' : 'model_decision'),
        description: desc,
        lineCount: lines.length,
        sizeBytes: stat.size
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 單檔解析單一 Skill (SKILL.md)
   */
  static async parseSingleSkillFile(skillMdPath, sourceName = '', type = 'workspace', wsIndex = 999) {
    const cleanPath = this.normalizeFsPath(skillMdPath);
    if (!cleanPath || !fs.existsSync(cleanPath)) return null;
    try {
      const content = await fsPromises.readFile(cleanPath, 'utf-8');
      const meta = this.parseFrontmatter(content);
      const stat = await fsPromises.stat(cleanPath);
      const lines = content.split(/\r?\n/);
      const skillDir = path.dirname(cleanPath);
      const dirName = path.basename(skillDir);

      let firstHeader = '';
      let inFrontmatter = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '---') {
          inFrontmatter = !inFrontmatter;
          continue;
        }
        if (!inFrontmatter && trimmed.startsWith('#')) {
          firstHeader = trimmed.replace(/^#+\s*/, '').trim();
          break;
        }
      }

      const rawName = meta.name || dirName;
      const displayName = firstHeader || rawName;
      const finalSource = sourceName || (type === 'global' ? '全域技能 (Global)' : (type === 'builtin' ? 'IDE 內建' : this.formatWorkspaceName(path.resolve(skillDir, '../../..'))));

      return {
        name: rawName,
        displayName: displayName,
        dirName: dirName,
        description: meta.description || '無描述',
        filePath: cleanPath,
        dirPath: skillDir,
        source: finalSource,
        wsIndex: wsIndex,
        type: type,
        sizeBytes: stat.size
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 以 Git 歷史判斷檔案在對話當下是否已存在。
   * 不使用 Windows birthtime：複製／checkout 常把建立時間改掉，早期對話會誤判。
   * 不在 Git 內或查不到時回傳 false（寧可漏、不要灌進尚未存在的規範）。
   */
  static existedBeforeConversation(filePath, convMtime) {
    const clean = this.normalizeFsPath(filePath);
    if (!clean || !fs.existsSync(clean) || !convMtime) return false;

    const beforeSec = Math.floor((Number(convMtime) + 60000) / 1000);
    const cacheKey = `${clean.toLowerCase()}|${beforeSec}`;
    if (this._gitExistCache.has(cacheKey)) return this._gitExistCache.get(cacheKey);

    const existed = this._gitFileExistedAt(clean, beforeSec);
    this._gitExistCache.set(cacheKey, existed);
    if (this._gitExistCache.size > 200) {
      const first = this._gitExistCache.keys().next().value;
      this._gitExistCache.delete(first);
    }
    return existed;
  }

  static _gitFileExistedAt(filePath, beforeSec) {
    const startDir = path.dirname(filePath);
    let root = '';
    try {
      root = execFileSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {
      return false;
    }
    if (!root) return false;

    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) return false;

    try {
      const hash = execFileSync(
        'git',
        ['-C', root, 'rev-list', '-1', `--before=${beforeSec}`, 'HEAD', '--', rel],
        {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }
      ).trim();
      return Boolean(hash);
    } catch {
      return false;
    }
  }
}

ContextScannerService._gitExistCache = new Map();

module.exports = ContextScannerService;
