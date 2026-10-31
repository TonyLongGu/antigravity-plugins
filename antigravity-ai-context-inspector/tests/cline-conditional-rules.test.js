// ==============================================================================
// 檔案名稱：tests/cline-conditional-rules.test.js
// 功能說明：Cline 規範分類（常駐／條件式／按需工作流程）回歸測試
//   驗證重點：
//     1. `.clinerules/*.md` 無 frontmatter ⇒ 常駐（alwaysActive）
//     2. `.clinerules/*.md` 有 `paths:` frontmatter ⇒ 條件式（不得列為常駐）
//     3. `.clinerules/workflows/*.md` ⇒ kind=workflow、trigger=workflow（按需）
//     4. `.cline/rules`、`.cline/workflows`（官方第二條路徑）同樣納入掃描
//     5. parseFrontmatter 支援區塊清單／單行／行內陣列三種 paths 寫法
//     6. 快照模式只保留「對話中真的讀過的」條件式項目
//   執行：node tests/cline-conditional-rules.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：USERPROFILE / APPDATA / CLINE_DATA_DIR 全指向系統暫存目錄下的夾具，
//         不觸碰真實的 ~/.cline、Documents/Cline 或 IDE 設定
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'ai-context-inspector-cline-rules-test');
const FAKE_HOME = path.join(ROOT, 'home');
const CLINE_DATA = path.join(FAKE_HOME, '.cline', 'data');
const WORKSPACE = path.join(ROOT, 'ws');

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

const ruleNames = (list) => (list || []).map((r) => r.name);

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });

  // ── 夾具：四種 Cline 檔案型態 ──────────────────────────────────────────────
  const plainRule = path.join(WORKSPACE, '.clinerules', 'plain.md');
  writeText(plainRule, '# 常駐規範\n\n沒有 frontmatter，Cline 每次都載入。\n');

  const conditionRule = path.join(WORKSPACE, '.clinerules', 'condition.md');
  writeText(conditionRule, [
    '---',
    'paths:',
    '  - "src/api/**"',
    '  - "src/db/**"',
    '---',
    '',
    '# 條件式規範',
    '',
    '只在當前上下文命中 paths 時啟用。'
  ].join('\n'));

  const inlineRule = path.join(WORKSPACE, '.clinerules', 'inline-paths.md');
  writeText(inlineRule, '---\npaths: ["docs/**", "**/*.mdx"]\n---\n\n# 行內陣列寫法\n');

  const workflowRule = path.join(WORKSPACE, '.clinerules', 'workflows', 'deploy.md');
  writeText(workflowRule, '# 部署流程\n\n用 /deploy 觸發的 slash command。\n');

  const altRule = path.join(WORKSPACE, '.cline', 'rules', 'alt.md');
  writeText(altRule, '# .cline/rules 規範\n\n官方第二條合法路徑。\n');

  const altWorkflow = path.join(WORKSPACE, '.cline', 'workflows', 'alt-flow.md');
  writeText(altWorkflow, '# .cline/workflows 流程\n');

  // ── B0：frontmatter 解析 ──────────────────────────────────────────────────
  await checkAsync('B0 parseFrontmatter 支援區塊／單行／行內陣列 paths', () => {
    const block = ContextScannerService.parseFrontmatter(fs.readFileSync(conditionRule, 'utf-8'));
    assert.deepStrictEqual(block.paths, ['src/api/**', 'src/db/**']);

    const inline = ContextScannerService.parseFrontmatter(fs.readFileSync(inlineRule, 'utf-8'));
    assert.deepStrictEqual(inline.paths, ['docs/**', '**/*.mdx']);

    const single = ContextScannerService.parseFrontmatter('---\npaths: src/auth/**\n---\n\n# x\n');
    assert.deepStrictEqual(single.paths, ['src/auth/**']);

    const none = ContextScannerService.parseFrontmatter('# 沒有 frontmatter\n');
    assert.deepStrictEqual(none.paths, []);
  });

  // ── B1–B4：即時掃描分類 ───────────────────────────────────────────────────
  const env = await ContextScannerService.scanLiveEnvironment(
    [{ uri: { fsPath: WORKSPACE } }],
    { isVsCode: true, cline: true }
  );

  await checkAsync('B1 無 frontmatter 的 .clinerules 檔案列為常駐', () => {
    const names = ruleNames(env.rules.alwaysActive);
    assert.ok(names.includes('plain.md'), '實際：' + names.join(','));
    assert.ok(!names.includes('condition.md'), 'condition.md 不該出現在常駐：' + names.join(','));
  });

  await checkAsync('B2 有 paths frontmatter 的 .clinerules 檔案列為條件式', () => {
    const rule = env.rules.conditional.find((r) => r.name === 'condition.md');
    assert.ok(rule, '找不到 condition.md，實際：' + ruleNames(env.rules.conditional).join(','));
    assert.deepStrictEqual(rule.paths, ['src/api/**', 'src/db/**']);
    assert.strictEqual(rule.hasPaths, true);
    assert.strictEqual(rule.isAlwaysActive, false);
    assert.strictEqual(rule.trigger, 'conditional_paths');
    assert.strictEqual(rule.kind, 'conditional');
  });

  await checkAsync('B3 workflows 標記為按需工作流程（kind=workflow）', () => {
    const rule = env.rules.conditional.find((r) => r.name === 'deploy.md');
    assert.ok(rule, '找不到 deploy.md，實際：' + ruleNames(env.rules.conditional).join(','));
    assert.strictEqual(rule.kind, 'workflow');
    assert.strictEqual(rule.trigger, 'workflow');
    assert.strictEqual(rule.isAlwaysActive, false);
  });

  await checkAsync('B4 .cline/rules 與 .cline/workflows 納入掃描', () => {
    const always = ruleNames(env.rules.alwaysActive);
    assert.ok(always.includes('alt.md'), '實際：' + always.join(','));
    const flow = env.rules.conditional.find((r) => r.name === 'alt-flow.md');
    assert.ok(flow, '.cline/workflows 未被掃描');
    assert.strictEqual(flow.kind, 'workflow');
  });

  // ── B5–B6：對話快照（足跡）────────────────────────────────────────────────
  const sessionId = 'sess-rules0001';
  const sessionDir = path.join(CLINE_DATA, 'sessions', sessionId);
  writeJson(path.join(sessionDir, `${sessionId}.json`), {
    version: 1,
    session_id: sessionId,
    source: 'vscode',
    started_at: '2026-10-30T10:00:00.000Z',
    ended_at: '2026-10-30T10:05:00.000Z',
    status: 'completed',
    provider: 'cline',
    model: 'cline-free/test-model',
    cwd: WORKSPACE,
    workspace_root: WORKSPACE,
    prompt: '分類測試',
    metadata: { title: '條件式規範分類測試', tokensIn: 10, tokensOut: 10, cacheReads: 0, totalCost: 0 }
  });
  writeJson(path.join(sessionDir, `${sessionId}.messages.json`), {
    version: 1,
    sessionId,
    messages: [
      { id: 'm1', role: 'user', content: [{ type: 'text', text: '請讀取條件式規範' }] },
      {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'read_files', input: { files: [{ path: conditionRule }] } }]
      }
    ]
  });

  const snapshot = await ClineSessionService.parseConversationSnapshot(
    sessionId,
    [{ uri: { fsPath: WORKSPACE } }],
    { scope: 'workspace', clineDataDir: CLINE_DATA }
  );

  await checkAsync('B5 快照只保留對話中真的讀過的條件式項目', () => {
    const names = ruleNames(snapshot.rules.conditional);
    assert.ok(names.includes('condition.md'), '實際：' + names.join(','));
    assert.ok(!names.includes('inline-paths.md'), '未讀取的條件式規範不該出現：' + names.join(','));
    assert.ok(!names.includes('deploy.md'), '未叫用的工作流程不該出現：' + names.join(','));
    const rule = snapshot.rules.conditional.find((r) => r.name === 'condition.md');
    assert.strictEqual(rule.isInvoked, true);
  });

  await checkAsync('B6 快照的常駐清單保留未讀取項目，只標 isInvoked=false', () => {
    const names = ruleNames(snapshot.rules.alwaysActive);
    assert.ok(names.includes('plain.md'), '實際：' + names.join(','));
    assert.ok(!names.includes('condition.md'), '條件式規範不得混進常駐：' + names.join(','));
    const rule = snapshot.rules.alwaysActive.find((r) => r.name === 'plain.md');
    assert.strictEqual(rule.isInvoked, false);
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const [status, label] of results) console.log(`${status}  ${label}`);
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);

  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
});
