#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  getDefaultGlobalSkillsDir,
  resolveFullPath,
  syncWorkspaceSkills,
} = require('../lib/skill-junction-sync');

function parseArgs(argv) {
  const opts = {
    workspace: '',
    globalDir: '',
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-DryRun') {
      opts.dryRun = true;
    } else if ((arg === '--workspace' || arg === '-WorkspaceFile') && argv[i + 1]) {
      opts.workspace = argv[i + 1];
      i += 1;
    } else if ((arg === '--global-dir' || arg === '-GlobalSkillsDir') && argv[i + 1]) {
      opts.globalDir = argv[i + 1];
      i += 1;
    }
  }

  return opts;
}

function findWorkspaceFile(startDir) {
  let searchDir = startDir;
  while (searchDir && fs.existsSync(searchDir)) {
    let files = [];
    try {
      files = fs.readdirSync(searchDir).filter((name) => name.toLowerCase().endsWith('.code-workspace'));
    } catch {
      files = [];
    }

    if (files.length > 0) {
      const globalMatch = files.find((name) => name.toLowerCase() === 'global.code-workspace');
      return path.join(searchDir, globalMatch || files[0]);
    }

    const parent = path.dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }
  return '';
}

function loadWorkspace(wsPath) {
  const raw = fs.readFileSync(wsPath, 'utf8').replace(/^\uFEFF/, '');
  const cleanJson = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(cleanJson);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scriptDir = __dirname;
  const searchFrom = process.cwd() || scriptDir;

  let wsPath = opts.workspace;
  if (!wsPath) {
    wsPath = findWorkspaceFile(searchFrom) || findWorkspaceFile(scriptDir);
  }

  if (!wsPath || !fs.existsSync(wsPath)) {
    console.error('[ERR] 找不到有效的 *.code-workspace 工作區設定檔。請使用 --workspace 指定。');
    process.exit(1);
  }

  wsPath = resolveFullPath(wsPath);
  const wsDir = path.dirname(wsPath);
  let wsConfig;
  try {
    wsConfig = loadWorkspace(wsPath);
  } catch (err) {
    console.error(`[ERR] 解析工作區 JSON 失敗: ${err.message}`);
    process.exit(1);
  }

  const folders = Array.isArray(wsConfig.folders) ? wsConfig.folders : [];
  if (folders.length === 0) {
    console.error('[ERR] 工作區設定檔中未定義任何專案 folders！');
    process.exit(1);
  }

  const globalDir = opts.globalDir || getDefaultGlobalSkillsDir();
  console.log('===============================================================');
  console.log('         工作區 Skills 全域同步管理工具                        ');
  console.log('===============================================================');
  if (opts.dryRun) {
    console.log('[WARN] 目前為 [預覽模擬模式 (DryRun)]，不會對檔案系統進行實際修改！');
  }
  console.log(`[INFO] 全域 Skills 目標目錄: ${globalDir}`);
  console.log(`[INFO] 使用工作區設定檔: ${wsPath}`);
  console.log(`[INFO] 工作區共註冊 ${folders.length} 個啟用專案（全部納入 Skills 同步）`);

  const result = syncWorkspaceSkills(folders, wsDir, {
    dryRun: opts.dryRun,
    globalDir,
  });

  if (result.skipped === 'empty-enabled') {
    console.log('[WARN] 目前沒有啟用中的專案，已略過 Skills 同步。');
    process.exit(0);
  }

  console.log(`[INFO] 保持 ${result.kept}、新增 ${result.added}、解除 ${result.removed}、失敗 ${result.failed}、受保護 ${result.protected}`);
  console.log('===============================================================');
  console.log('                       同步成果報告                            ');
  console.log('===============================================================');
  console.log(`  - 受保護全域實體目錄     : ${result.protected} 個`);
  console.log(`  - 保持既有有效連結       : ${result.kept} 個`);
  console.log(`  - 新建立 Junction 連結    : ${result.added} 個`);
  console.log(`  - 解除無效或過期連結     : ${result.removed} 個`);
  if (result.failed > 0) {
    console.log(`  - 失敗                   : ${result.failed} 個`);
    process.exit(1);
  }
  console.log('===============================================================');
}

main();
