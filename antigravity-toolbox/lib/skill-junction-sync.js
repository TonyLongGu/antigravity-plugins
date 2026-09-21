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

function collectSourceSkills(enabledFolders, wsDir) {
  const sources = [];
  const seen = new Set();

  for (const folder of enabledFolders || []) {
    const projFull = resolveFullPath(folder.path || '', wsDir);
    if (!projFull || !isExistingDirectory(projFull)) continue;
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
 * @returns {{ added: number, removed: number, kept: number, failed: number, protected: number, skipped?: string }}
 */
function syncWorkspaceSkills(enabledFolders, wsDir, options = {}) {
  const dryRun = !!options.dryRun;
  const globalDir = options.globalDir
    ? resolveFullPath(options.globalDir)
    : getDefaultGlobalSkillsDir();

  if (!Array.isArray(enabledFolders) || enabledFolders.length === 0) {
    return {
      added: 0,
      removed: 0,
      kept: 0,
      failed: 0,
      protected: 0,
      skipped: 'empty-enabled',
    };
  }

  const sourceSkills = collectSourceSkills(enabledFolders, wsDir);
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

  for (const src of plan) {
    if (src.action === 'keep') continue;
    let candidate = src.baseName;
    let serial = 1;
    while (reserved.has(candidate.toLowerCase())) {
      serial += 1;
      candidate = `${src.baseName}_${serial}`;
    }
    src.assignedName = candidate;
    src.action = 'add';
    reserved.add(candidate.toLowerCase());
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
    plan,
    globalDir,
  };
}

module.exports = {
  SKILL_SUB_PATHS,
  getDefaultGlobalSkillsDir,
  resolveFullPath,
  collectSourceSkills,
  syncWorkspaceSkills,
};
