const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
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
      
      for (const file of mdFiles) {
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

          rules.push({
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
          });
        } catch (e) {
          console.error(`Error processing rule file ${filePath}:`, e);
        }
      }
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
      
      for (const entry of skillDirs) {
        const skillDir = path.join(dirPath, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          try {
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

            skills.push({
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
            });
          } catch (e) {
            console.error(`Error processing skill file ${skillMdPath}:`, e);
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning skills in ${dirPath}:`, err);
    }
    return skills;
  }

  /**
   * 執行全方位環境即時掃描（嚴格遵循 VS Code 檔案總管專案順序與 A-Z 自然排序）
   */
  static async scanLiveEnvironment(workspaceFolders = []) {
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
        global: [],
        workspace: []
      },
      mcpServers: []
    };

    // 1. 依序處理工作區清單（嚴格依照檔案總管專案由上而下順序）
    for (let wsIndex = 0; wsIndex < workspaceFolders.length; wsIndex++) {
      const ws = workspaceFolders[wsIndex];
      const wsPath = typeof ws === 'string' ? ws : (ws.uri ? ws.uri.fsPath : ws);
      const wsName = typeof ws === 'object' && ws.name ? ws.name : path.basename(wsPath);
      result.workspaces.push({
        name: wsName,
        path: wsPath,
        index: wsIndex
      });

      // 掃描 Workspace Rules（專案內依檔名自然排序）
      const wsRulesDir = path.join(wsPath, '.agents', 'rules');
      const wsRules = await this.scanRulesInDir(wsRulesDir, wsName, false, wsIndex);
      for (const r of wsRules) {
        if (r.isAlwaysActive) {
          result.rules.alwaysActive.push(r);
        } else {
          result.rules.conditional.push(r);
        }
      }

      // 掃描 Workspace Skills（專案內依資料夾名稱自然排序）
      const wsSkillsDir = path.join(wsPath, '.agents', 'skills');
      const wsSkills = await this.scanSkillsInDir(wsSkillsDir, wsName, 'workspace', wsIndex);
      result.skills.workspace.push(...wsSkills);
    }

    // 2. 掃描全域 Rules 與 Skills (排在工作區之後)
    const globalRulesDir = path.join(globalConfigDir, 'rules');
    const globalRules = await this.scanRulesInDir(globalRulesDir, '全域設定 (Global)', true, 1000);
    for (const r of globalRules) {
      result.rules.alwaysActive.push(r);
    }

    const globalSkillsDir = path.join(globalConfigDir, 'skills');
    const globalSkills = await this.scanSkillsInDir(globalSkillsDir, '全域技能 (Global)', 'global', 1000);
    result.skills.global.push(...globalSkills);

    // 3. 掃描內建 Skills (排在最末)
    const builtinSkills = await this.scanSkillsInDir(builtinSkillsDir, 'Antigravity 內建', 'builtin', 2000);
    result.skills.builtin.push(...builtinSkills);

    // 4. 掃描 MCP 伺服器與工具
    result.mcpServers = await McpDetectorService.scanMcpServers(workspaceFolders);

    return result;
  }
}

module.exports = ContextScannerService;
