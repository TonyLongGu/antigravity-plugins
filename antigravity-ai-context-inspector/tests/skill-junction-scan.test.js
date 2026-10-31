// ==============================================================================
// 檔案名稱：tests/skill-junction-scan.test.js
// 功能說明：技能掃描對「symlink／junction 技能資料夾」的支援（零相依，直接以 node 執行）
//   驗證重點：
//     1. 【回歸】`~/.agents/skills/<name>` 是 junction 時必須照樣列出技能
//        （Windows 的 Dirent.isDirectory() 對 junction 回傳 false、只有
//         isSymbolicLink() 為 true；只認 isDirectory() 會整批漏掉——2026-10-31 實測
//         26 個全域技能掃到 0 個，使用者看到的症狀是「只顯示專案技能」）
//     2. 沒有 SKILL.md 的子資料夾仍不得列入（負對照，證明放寬條件不等於亂收）
//     3. scanLiveEnvironment 的 global 群組含 junction 技能（Cline 快照走同一條鏈）
//     4. Cline 快照：junction 技能被 skills 工具呼叫時要出現在 skills.global
//     5. Cline 快照：未被呼叫的 junction 技能不得出現（足跡語意不變）
//   執行：node tests/skill-junction-scan.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：USERPROFILE / APPDATA / CLINE_DATA_DIR 全指向系統暫存目錄下的夾具；
//         測試結束先拆連結再刪夾具，不觸碰真實的 ~/.agents/skills 或 ~/.cline
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'ai-context-inspector-skill-junction-test');
const FAKE_HOME = path.join(ROOT, 'home');
const CLINE_DATA = path.join(FAKE_HOME, '.cline', 'data');
const WORKSPACE = path.join(ROOT, 'ws');
const VENDOR = path.join(ROOT, 'vendor');
const GLOBAL_SKILLS = path.join(FAKE_HOME, '.agents', 'skills');
const LINKED_SKILL = path.join(GLOBAL_SKILLS, 'linked-skill');

// 必須在 require 服務前改寫環境變數（服務以 USERPROFILE / APPDATA 推導路徑）
process.env.USERPROFILE = FAKE_HOME;
process.env.APPDATA = path.join(ROOT, 'AppData');
process.env.CLINE_DATA_DIR = CLINE_DATA;

const ContextScannerService = require(path.join(EXT_ROOT, 'services', 'contextScannerService.js'));
const ClineSessionService = require(path.join(EXT_ROOT, 'services', 'clineSessionService.js'));

const results = [];
async function checkAsync(label, fn) {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', label + ' :: ' + e.message]);
  }
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf-8');
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
}

function skillMd(name) {
  return `---\nname: ${name}\ndescription: 夾具技能 ${name}\n---\n\n# ${name}\n\n測試用。\n`;
}

/** Windows 上 junction 不需管理員權限；POSIX 走 dir symlink */
function makeSkillJunction(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function makeSession(sessionId, messages) {
  const sessionDir = path.join(CLINE_DATA, 'sessions', sessionId);
  writeJson(path.join(sessionDir, `${sessionId}.json`), {
    version: 1,
    session_id: sessionId,
    source: 'vscode',
    status: 'completed',
    provider: 'cline',
    model: 'test-model',
    cwd: WORKSPACE,
    workspace_root: WORKSPACE,
    prompt: '技能連結掃描測試',
    metadata: { title: '技能連結掃描測試', tokensIn: 10, tokensOut: 5, totalCost: 0 }
  });
  writeJson(path.join(sessionDir, `${sessionId}.messages.json`), { version: 1, sessionId, messages });
}

/** 先拆連結再刪夾具，避免動到 vendor 內的實體技能 */
function cleanup() {
  try {
    if (fs.lstatSync(LINKED_SKILL).isSymbolicLink()) fs.rmdirSync(LINKED_SKILL);
  } catch {}
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
}


async function main() {
  cleanup();

  // ── 夾具：實體技能 / junction 技能 / 無 SKILL.md 的資料夾 ──────────────────
  writeText(path.join(VENDOR, 'linked-skill', 'SKILL.md'), skillMd('linked-skill'));
  writeText(path.join(GLOBAL_SKILLS, 'plain-skill', 'SKILL.md'), skillMd('plain-skill'));
  fs.mkdirSync(path.join(GLOBAL_SKILLS, 'no-skill-md'), { recursive: true });
  makeSkillJunction(path.join(VENDOR, 'linked-skill'), LINKED_SKILL);
  fs.mkdirSync(WORKSPACE, { recursive: true });

  await checkAsync('J0 夾具前提：linked-skill 是連結、Dirent.isDirectory() 為 false', async () => {
    const dirent = fs.readdirSync(GLOBAL_SKILLS, { withFileTypes: true }).find((e) => e.name === 'linked-skill');
    assert.ok(dirent, '找不到 linked-skill');
    assert.strictEqual(fs.lstatSync(LINKED_SKILL).isSymbolicLink(), true, 'linked-skill 應為連結');
    assert.strictEqual(dirent.isSymbolicLink(), true, 'Dirent 應標記為連結');
    // 這行就是舊版漏掉技能的原因，保留為負對照
    assert.strictEqual(dirent.isDirectory(), false, 'Windows junction 的 isDirectory() 應為 false');
  });

  const scanned = await ContextScannerService.scanSkillsInDir(GLOBAL_SKILLS, '使用者', 'global', 1000);
  const names = scanned.map((s) => s.dirName);

  await checkAsync('J1 junction 技能必須被列出（實體資料夾仍照常）', async () => {
    assert.ok(names.includes('linked-skill'), '缺 linked-skill：' + names.join(','));
    assert.ok(names.includes('plain-skill'), '缺 plain-skill：' + names.join(','));
    const linked = scanned.find((s) => s.dirName === 'linked-skill');
    assert.strictEqual(linked.type, 'global');
    assert.strictEqual(linked.name, 'linked-skill');
    assert.strictEqual(linked.filePath.toLowerCase(), path.join(LINKED_SKILL, 'SKILL.md').toLowerCase());
  });

  await checkAsync('J2 沒有 SKILL.md 的子資料夾不得列入（負對照）', async () => {
    assert.ok(!names.includes('no-skill-md'), 'no-skill-md 不該出現：' + names.join(','));
  });

  await checkAsync('J3 scanLiveEnvironment 的 global 群組含 junction 技能', async () => {
    const env = await ContextScannerService.scanLiveEnvironment(
      [{ uri: { fsPath: WORKSPACE } }],
      { isVsCode: true, isCursor: false, cline: true }
    );
    const globalNames = (env.skills.global || []).map((s) => s.dirName);
    assert.ok(globalNames.includes('linked-skill'), 'global 缺 linked-skill：' + globalNames.join(','));
  });

  // ── Cline 快照：junction 技能要能被 skills 工具足跡命中 ────────────────────
  const invokedId = 'sess-junction-invoked';
  makeSession(invokedId, [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: '用 linked-skill 做點事' }] },
    {
      id: 'm2',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_j1', name: 'skills', input: { skill: 'linked-skill' } }]
    }
  ]);
  ClineSessionService._listCache.clear();
  ClineSessionService._metaCache.clear();

  const snapshot = await ClineSessionService.parseConversationSnapshot(
    invokedId,
    [{ uri: { fsPath: WORKSPACE } }],
    {}
  );

  await checkAsync('J4 快照：被呼叫的 junction 技能出現在 skills.global', async () => {
    const globalNames = (snapshot.skills.global || []).map((s) => s.dirName);
    assert.ok(globalNames.includes('linked-skill'), 'skills.global 缺 linked-skill：' + globalNames.join(','));
    const item = snapshot.skills.global.find((s) => s.dirName === 'linked-skill');
    assert.strictEqual(item.isInvoked, true);
  });

  await checkAsync('J5 快照：未被呼叫的 junction 技能不得出現（足跡語意不變）', async () => {
    const allNames = ['workspace', 'global', 'extension', 'builtin']
      .flatMap((group) => (snapshot.skills[group] || []).map((s) => s.dirName));
    assert.ok(!allNames.includes('plain-skill'), 'plain-skill 未被呼叫卻出現：' + allNames.join(','));
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const [status, label] of results) console.log(`${status}  ${label}`);
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);

  cleanup();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  cleanup();
  process.exit(1);
});
