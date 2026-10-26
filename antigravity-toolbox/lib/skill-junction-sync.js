const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_SUB_PATHS = [
  path.join('.agents', 'skills'),
  path.join('.gemini', 'config', 'skills'),
  'skills',
];

function getDefaultGlobalSkillsDir() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.agents', 'skills');
}

function resolveFullPath(targetPath, baseDir) {
  if (!targetPath) return '';
  let fullPath = targetPath;
  if (baseDir && !path.isAbsolute(targetPath)) {
    fullPath = path.resolve(baseDir, targetPath);
  }
  fullPath = path.normalize(fullPath);
  try {
    if (fs.existsSync(fullPath)) {
      fullPath = typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native(fullPath)
        : fs.realpathSync(fullPath);
    }
  } catch {}
  return fullPath;
}

function isReparsePoint(fullPath) {
  try {
    return fs.lstatSync(fullPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function pathExists(fullPath) {
  try {
    fs.lstatSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

function isExistingDirectory(fullPath) {
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveLinkTarget(linkPath) {
  try {
    const raw = fs.readlinkSync(linkPath);
    if (!raw) return '';
    if (path.isAbsolute(raw)) return resolveFullPath(raw);
    return resolveFullPath(raw, path.dirname(linkPath));
  } catch {
    return '';
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeJunction(linkPath) {
  if (!isReparsePoint(linkPath)) return false;

  try {
    if (process.platform === 'win32') {
      spawnSync('cmd.exe', ['/c', 'rmdir', linkPath], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      fs.rmdirSync(linkPath);
    }
  } catch {
    try {
      fs.unlinkSync(linkPath);
    } catch {
      return false;
    }
  }

  return !pathExists(linkPath);
}

function createJunction(destPath, sourcePath) {
  if (pathExists(destPath)) {
    if (isReparsePoint(destPath)) {
      if (!removeJunction(destPath)) return false;
    } else {
      return false;
    }
  }

  try {
    fs.symlinkSync(sourcePath, destPath, 'junction');
    return pathExists(destPath);
  } catch {
    if (process.platform === 'win32') {
      spawnSync('cmd.exe', ['/c', 'mklink', '/J', destPath, sourcePath], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return pathExists(destPath);
    }
    return false;
  }
}

/**
 * 掃描啟用中專案的 Skills 目錄，收集所有可連結的來源技能
 * @param {Array<{path?: string, name?: string}>} enabledFolders
 * @param {string} wsDir 工作區目錄 (解析相對路徑用)
 * @param {{ excludedCanon?: Set<string>, stats?: { excludedProjects: string[] } }} [options]
 *   - excludedCanon: 需排除的專案路徑集合 (小寫正規化)，例如「首專案」
 *   - stats: 收集排除結果的統計物件 (供介面提示使用)
 * @returns {Array<{ sourcePath: string, baseName: string, projectName: string }>}
 */
function collectSourceSkills(enabledFolders, wsDir, options = {}) {
  const excludedCanon = options.excludedCanon || null;
  const stats = options.stats || null;
  const sources = [];
  const seen = new Set();

  for (const folder of enabledFolders || []) {
    const projFull = resolveFullPath(folder.path || '', wsDir);
    if (!projFull || !isExistingDirectory(projFull)) continue;

    // 排除指定專案 (如首專案)：僅略過來源收集，其既有連結會被視為過期而解除
    if (excludedCanon && excludedCanon.has(projFull.toLowerCase())) {
      if (stats) stats.excludedProjects.push(folder.name || path.basename(projFull));
      continue;
    }

    const projName = folder.name || path.basename(projFull);

    for (const subRel of SKILL_SUB_PATHS) {
      const parent = path.join(projFull, subRel);
      if (!isExistingDirectory(parent)) continue;

      let entries = [];
      try {
        entries = fs.readdirSync(parent, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const sourceFull = path.join(parent, entry.name);
        if (!isExistingDirectory(sourceFull)) continue;

        const sourcePath = resolveFullPath(sourceFull);
        const key = sourcePath.toLowerCase();
        if (!sourcePath || seen.has(key)) continue;

        seen.add(key);
        sources.push({
          sourcePath,
          baseName: entry.name,
          projectName: projName,
        });
      }
    }
  }

  return sources;
}

/**
 * 依啟用專案比對全域 Skills Junction
 * @param {Array<{path?: string, name?: string}>} enabledFolders 啟用中的專案清單
 * @param {string} wsDir 工作區目錄 (解析相對路徑用)
 * @param {{ dryRun?: boolean, globalDir?: string, excludePaths?: string[] }} [options]
 *   - excludePaths: 不納入同步來源的專案路徑 (例如首專案)；其既有連結會被一併解除
 * @returns {{ added: number, removed: number, kept: number, failed: number, protected: number, excludedProjects: string[], conflicts: Array<object>, skipped?: string }} skipped: 'empty-enabled'（無啟用專案）| 'empty-source'（來源技能 0 但全域仍有連結，已中止同步）
 */
function syncWorkspaceSkills(enabledFolders, wsDir, options = {}) {
  const dryRun = !!options.dryRun;
  const globalDir = options.globalDir
    ? resolveFullPath(options.globalDir)
    : getDefaultGlobalSkillsDir();

  const excludedCanon = new Set(
    (Array.isArray(options.excludePaths) ? options.excludePaths : [])
      .map((p) => resolveFullPath(p || '', wsDir).toLowerCase())
      .filter(Boolean)
  );
  const collectStats = { excludedProjects: [] };

  if (!Array.isArray(enabledFolders) || enabledFolders.length === 0) {
    return {
      added: 0,
      removed: 0,
      kept: 0,
      failed: 0,
      protected: 0,
      excludedProjects: [],
      skipped: 'empty-enabled',
    };
  }

  const sourceSkills = collectSourceSkills(enabledFolders, wsDir, {
    excludedCanon,
    stats: collectStats,
  });
  if (!dryRun) ensureDir(globalDir);

  const existingLinks = [];
  const protectedNames = new Set();

  let globalEntries = [];
  try {
    globalEntries = fs.readdirSync(globalDir, { withFileTypes: true });
  } catch {
    globalEntries = [];
  }

  for (const entry of globalEntries) {
    const full = path.join(globalDir, entry.name);
    if (!isReparsePoint(full)) {
      protectedNames.add(entry.name.toLowerCase());
      continue;
    }

    existingLinks.push({
      linkName: entry.name,
      linkFullPath: full,
      resolvedTarget: resolveLinkTarget(full),
      matched: false,
    });
  }

  // 安全網（2026-10-26）：來源技能為 0 但全域仍有連結時，代表「這份工作區沒有任何 skills」
  // （開到純程式碼專案、或首專案被排除）。照原邏輯續跑會把所有連結當成過期而整批解除，
  // 連帶讓其他工作區的技能消失。故直接跳過同步並回報，要清空請明確使用 --clear。
  if (sourceSkills.length === 0 && existingLinks.length > 0) {
    return {
      added: 0,
      removed: 0,
      kept: existingLinks.length,
      failed: 0,
      protected: protectedNames.size,
      excludedProjects: collectStats.excludedProjects,
      plan: [],
      conflicts: [],
      globalDir,
      skipped: 'empty-source',
    };
  }

  const reserved = new Set(protectedNames);
  const plan = sourceSkills.map((src) => ({
    ...src,
    assignedName: null,
    action: '',
  }));

  for (const src of plan) {
    const matched = existingLinks.find((link) => (
      !link.matched
      && link.resolvedTarget
      && link.resolvedTarget.toLowerCase() === src.sourcePath.toLowerCase()
    ));
    if (matched) {
      matched.matched = true;
      src.assignedName = matched.linkName;
      src.action = 'keep';
      reserved.add(matched.linkName.toLowerCase());
    }
  }

  // 撞名一律視為衝突（2026-10-26 起）：舊行為會把連結命名成 `foo_2`，
  // 但目標 SKILL.md 的 name 仍是 `foo`，破壞 Cline 與 .agents/README.md §3 共同要求的
  // 「name 必須等於資料夾名」，而且失敗是靜默的。寧可少一顆技能並明確回報，
  // 也不要造出一顆永遠載入不到的技能。
  const conflicts = [];
  for (const src of plan) {
    if (src.action === 'keep') continue;
    if (reserved.has(src.baseName.toLowerCase())) {
      const holder = existingLinks.find((link) => link.linkName.toLowerCase() === src.baseName.toLowerCase());
      src.assignedName = null;
      src.action = 'conflict';
      conflicts.push({
        name: src.baseName,
        sourcePath: src.sourcePath,
        projectName: src.projectName,
        existingTarget: holder ? holder.resolvedTarget : '',
      });
      continue;
    }
    src.assignedName = src.baseName;
    src.action = 'add';
    reserved.add(src.baseName.toLowerCase());
  }

  let added = 0;
  let removed = 0;
  let kept = 0;
  let failed = 0;

  for (const link of existingLinks) {
    if (link.matched) continue;
    if (dryRun) {
      removed += 1;
      continue;
    }
    if (removeJunction(link.linkFullPath)) {
      removed += 1;
    } else {
      failed += 1;
    }
  }

  for (const src of plan) {
    if (src.action === 'keep') {
      kept += 1;
      continue;
    }

    if (src.action === 'conflict') {
      failed += 1;
      continue;
    }

    if (dryRun) {
      added += 1;
      continue;
    }

    const destPath = path.join(globalDir, src.assignedName);
    if (createJunction(destPath, src.sourcePath)) {
      added += 1;
    } else {
      failed += 1;
    }
  }

  return {
    added,
    removed,
    kept,
    failed,
    protected: protectedNames.size,
    excludedProjects: collectStats.excludedProjects,
    plan,
    conflicts,
    globalDir,
  };
}

/**
 * 解除全域 Skills 目錄下所有由本功能建立的連結（Junction / Symlink）
 * 僅處理 reparse point（本功能建立的連結），全域目錄內的實體資料夾與檔案一律保留。
 * @param {{ dryRun?: boolean, globalDir?: string }} [options]
 * @returns {{ removed: number, kept: number, failed: number, globalDir: string, removedNames: string[] }}
 */
function clearGlobalSkillLinks(options = {}) {
  const dryRun = !!options.dryRun;
  const globalDir = options.globalDir
    ? resolveFullPath(options.globalDir)
    : getDefaultGlobalSkillsDir();

  let globalEntries = [];
  try {
    globalEntries = fs.readdirSync(globalDir, { withFileTypes: true });
  } catch {
    globalEntries = [];
  }

  let kept = 0;
  let failed = 0;
  const removedNames = [];

  for (const entry of globalEntries) {
    const full = path.join(globalDir, entry.name);
    if (!isReparsePoint(full)) {
      kept += 1;
      continue;
    }

    if (dryRun) {
      removedNames.push(entry.name);
      continue;
    }

    if (removeJunction(full)) {
      removedNames.push(entry.name);
    } else {
      failed += 1;
    }
  }

  return {
    removed: removedNames.length,
    kept,
    failed,
    globalDir,
    removedNames,
  };
}

module.exports = {
  SKILL_SUB_PATHS,
  getDefaultGlobalSkillsDir,
  resolveFullPath,
  collectSourceSkills,
  syncWorkspaceSkills,
  clearGlobalSkillLinks,
};
