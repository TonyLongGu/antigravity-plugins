// ==============================================================================
// 檔案名稱：tests/skill-junction-sync.test.js
// 功能說明：全域 Skills Junction 同步（lib/skill-junction-sync.js）的回歸測試（零相依）
//   驗證重點：
//     1. 基本同步：依啟用專案建立連結、關閉單一專案時只解除該專案的連結
//     2. 【回歸】關閉「最後一個」專案（folders 變空、allowEmpty=true）必須解除本工作區
//        全部連結；舊版會回 skipped:'empty-enabled' 而殘留（使用者回報的 bug）
//     3. 【回歸】只剩沒有 skills 的專案時（舊版 skipped:'empty-source'），本工作區的
//        殘留連結仍必須被解除
//     4. 沒有工作區資訊（單資料夾視窗、allowEmpty=false）時不得亂刪既有連結
//     5. 連結歸屬（workspacePaths）：指向其他多專案工作區的連結一律保留，只有
//        「指向本工作區專案」或「目標已失效」的連結可回收
//     6. 實體資料夾（使用者自建技能）永不刪除；dryRun 不動磁碟；排除首專案會解除其連結
//   執行：node tests/skill-junction-sync.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：所有夾具都在系統暫存目錄，測試結束先拆連結再刪夾具，不觸碰真實使用者資料
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const { syncWorkspaceSkills } = require(path.join(EXT_ROOT, 'lib', 'skill-junction-sync.js'));

const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-skill-junction-test');
const globalDirs = [];

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✘ ${name}\n    ${e.message}`);
  }
}

// ── 夾具 ─────────────────────────────────────────────────────────────────────
function caseDir(name) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 建立假專案（skills=[] 也能建立空專案），回傳 {path, name} 形式的 folder 物件 */
function makeProject(base, name, skills = []) {
  const proj = path.join(base, name);
  fs.mkdirSync(proj, { recursive: true });
  for (const skill of skills) {
    fs.mkdirSync(path.join(proj, '.agents', 'skills', skill), { recursive: true });
  }
  return { path: proj, name };
}

function makeGlobalDir(base) {
  const dir = path.join(base, 'global');
  fs.mkdirSync(dir, { recursive: true });
  globalDirs.push(dir);
  return dir;
}

function isLink(fullPath) {
  try {
    return fs.lstatSync(fullPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function exists(fullPath) {
  try {
    fs.lstatSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

function entries(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function sync(enabledFolders, wsDir, options) {
  return syncWorkspaceSkills(enabledFolders, wsDir, options);
}

// ── 測試本體 ────────────────────────────────────────────────────────────────
function main() {
  console.log('\n[skill-junction] 檢查全域 Skills 連結同步與關閉專案後的解除行為\n');

  check('S1 首次同步：依啟用專案的 .agents/skills 建立連結', () => {
    const base = caseDir('s1');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha', 'beta']);
    const b = makeProject(base, 'projB', ['gamma']);

    const r = sync([a, b], base, { globalDir, workspacePaths: [a.path, b.path], allowEmpty: true });

    assert.strictEqual(r.added, 3, `added 應為 3，實際 ${r.added}`);
    assert.strictEqual(r.removed, 0);
    assert.deepStrictEqual(entries(globalDir), ['alpha', 'beta', 'gamma']);
    assert.ok(isLink(path.join(globalDir, 'gamma')), 'gamma 應為連結');
  });

  check('S2 關閉其中一個專案：只解除該專案的連結', () => {
    const base = caseDir('s2');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha', 'beta']);
    const b = makeProject(base, 'projB', ['gamma']);
    const workspacePaths = [a.path, b.path];

    sync([a, b], base, { globalDir, workspacePaths, allowEmpty: true });
    const r = sync([a], base, { globalDir, workspacePaths, allowEmpty: true });

    assert.strictEqual(r.removed, 1, `removed 應為 1，實際 ${r.removed}`);
    assert.deepStrictEqual(entries(globalDir), ['alpha', 'beta']);
  });

  check('S3【回歸】關閉最後一個專案：必須解除本工作區全部連結（舊版殘留）', () => {
    const base = caseDir('s3');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha', 'beta']);
    const b = makeProject(base, 'projB', ['gamma']);
    const workspacePaths = [a.path, b.path];

    sync([a, b], base, { globalDir, workspacePaths, allowEmpty: true });
    const r = sync([], base, { globalDir, workspacePaths, allowEmpty: true });

    assert.strictEqual(r.skipped, undefined, `不應回 skipped，實際 ${r.skipped}`);
    assert.strictEqual(r.removed, 3, `removed 應為 3，實際 ${r.removed}`);
    assert.deepStrictEqual(entries(globalDir), [], '全域目錄應已無殘留連結');
  });

  check('S4 沒有工作區資訊（allowEmpty 未給）：保留既有連結，不得亂刪', () => {
    const base = caseDir('s4');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha']);

    sync([a], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    const r = sync([], base, { globalDir });

    assert.strictEqual(r.skipped, 'empty-enabled');
    assert.strictEqual(r.removed, 0);
    assert.deepStrictEqual(entries(globalDir), ['alpha'], '連結必須保留');
  });

  check('S5【回歸】只剩沒有 skills 的專案：本工作區殘留連結仍要被解除', () => {
    const base = caseDir('s5');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha', 'beta']);
    const b = makeProject(base, 'projB', ['gamma']);
    const empty = makeProject(base, 'projEmpty', []);
    const workspacePaths = [a.path, b.path, empty.path];

    sync([a, b], base, { globalDir, workspacePaths, allowEmpty: true });
    const r = sync([empty], base, { globalDir, workspacePaths, allowEmpty: true });

    assert.strictEqual(r.skipped, undefined, `不應回 skipped，實際 ${r.skipped}`);
    assert.strictEqual(r.removed, 3, `removed 應為 3，實際 ${r.removed}`);
    assert.deepStrictEqual(entries(globalDir), []);
  });

  check('S6 連結歸屬：其他工作區的連結不得被本工作區的同步誤刪', () => {
    const base = caseDir('s6');
    const globalDir = makeGlobalDir(base);
    const x = makeProject(base, 'projX', ['gamma']);
    const a = makeProject(base, 'projA', ['alpha']);

    // 另一個工作區（只註冊 projX）建立 gamma 連結
    sync([x], base, { globalDir, workspacePaths: [x.path], allowEmpty: true });

    // 本工作區（只註冊 projA）同步：新增 alpha，gamma 不屬於本工作區 ⇒ 保留
    const r1 = sync([a], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    assert.strictEqual(r1.added, 1, `added 應為 1，實際 ${r1.added}`);
    assert.strictEqual(r1.removed, 0, `removed 應為 0，實際 ${r1.removed}`);
    assert.deepStrictEqual(entries(globalDir), ['alpha', 'gamma']);
    assert.ok(isLink(path.join(globalDir, 'gamma')), 'gamma 應仍是連結');

    // 本工作區全部專案關閉：只解除 alpha，gamma 仍保留
    const r2 = sync([], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    assert.strictEqual(r2.removed, 1, `removed 應為 1，實際 ${r2.removed}`);
    assert.deepStrictEqual(entries(globalDir), ['gamma'], '其他工作區的連結必須保留');
  });

  check('S7 目標已失效（專案被刪）的殘缺連結仍會被清除', () => {
    const base = caseDir('s7');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha']);

    sync([a], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    fs.rmSync(path.join(a.path, '.agents', 'skills', 'alpha'), { recursive: true, force: true });

    const r = sync([], base, { globalDir, workspacePaths: [], allowEmpty: true });
    assert.strictEqual(r.removed, 1, `removed 應為 1，實際 ${r.removed}`);
    assert.deepStrictEqual(entries(globalDir), [], '殘缺連結應被清除');
  });

  check('S8 dryRun：只回報不實際動磁碟', () => {
    const base = caseDir('s8');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha']);

    sync([a], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    const r = sync([], base, { globalDir, workspacePaths: [a.path], allowEmpty: true, dryRun: true });

    assert.strictEqual(r.removed, 1, '預覽應回報 1 個待解除連結');
    assert.deepStrictEqual(entries(globalDir), ['alpha'], 'dryRun 不得實際刪除');
  });

  check('S9 排除首專案（唯一來源）時，其既有連結會被解除', () => {
    const base = caseDir('s9');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha']);
    const b = makeProject(base, 'projB', ['gamma']);
    const workspacePaths = [a.path, b.path];

    sync([a, b], base, { globalDir, workspacePaths, allowEmpty: true });
    const r = sync([a, b], base, {
      globalDir,
      workspacePaths,
      allowEmpty: true,
      excludePaths: [a.path],
    });

    assert.strictEqual(r.removed, 1, `removed 應為 1，實際 ${r.removed}`);
    assert.deepStrictEqual(r.excludedProjects, ['projA']);
    assert.deepStrictEqual(entries(globalDir), ['gamma'], '被排除專案的連結應解除');
  });

  check('S10 全域目錄內的實體資料夾（使用者自建技能）永不刪除', () => {
    const base = caseDir('s10');
    const globalDir = makeGlobalDir(base);
    const manual = path.join(globalDir, 'manualSkill');
    fs.mkdirSync(manual, { recursive: true });
    fs.writeFileSync(path.join(manual, 'SKILL.md'), '# manual\n', 'utf-8');
    const a = makeProject(base, 'projA', ['alpha']);

    const r1 = sync([a], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    assert.strictEqual(r1.added, 1, `added 應為 1，實際 ${r1.added}`);
    assert.strictEqual(r1.protected, 1, `protected 應為 1，實際 ${r1.protected}`);
    assert.deepStrictEqual(entries(globalDir), ['alpha', 'manualSkill']);

    const r2 = sync([], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    assert.strictEqual(r2.removed, 1, `removed 應為 1，實際 ${r2.removed}`);
    assert.deepStrictEqual(entries(globalDir), ['manualSkill'], '實體資料夾必須保留');
    assert.ok(!isLink(manual), 'manualSkill 不得變成連結');
    assert.strictEqual(fs.readFileSync(path.join(manual, 'SKILL.md'), 'utf-8'), '# manual\n');
  });

  check('S11 解除連結不會動到來源技能內容（rmdir 快路徑）', () => {
    const base = caseDir('s11');
    const globalDir = makeGlobalDir(base);
    const a = makeProject(base, 'projA', ['alpha']);
    const marker = path.join(a.path, '.agents', 'skills', 'alpha', 'SKILL.md');
    fs.writeFileSync(marker, '# alpha\n', 'utf-8');

    sync([a], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });
    const r = sync([], base, { globalDir, workspacePaths: [a.path], allowEmpty: true });

    assert.strictEqual(r.removed, 1, `removed 應為 1，實際 ${r.removed}`);
    assert.deepStrictEqual(entries(globalDir), []);
    assert.strictEqual(fs.readFileSync(marker, 'utf-8'), '# alpha\n', '來源檔必須完好');
  });

  cleanup();

  console.log(`\n[skill-junction] ${failed === 0 ? '全部通過' : `${failed} 項失敗`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── 清理：先逐一拆除連結，再刪夾具（避免遞迴刪除時跟著連結跑進真實資料）────────
function removeLinksOnly(dir) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of list) {
    const full = path.join(dir, entry.name);
    if (!isLink(full)) continue;
    try { fs.rmSync(full, { recursive: false, force: true }); } catch {}
    if (exists(full)) {
      try { fs.rmdirSync(full); } catch {}
    }
  }
}

function cleanup() {
  for (const dir of globalDirs) removeLinksOnly(dir);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
}

main();
