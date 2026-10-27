// ==============================================================================
// 檔案名稱：tests/cline-snapshot.test.js
// 功能說明：Cline 對話來源（足跡快照）回歸測試（零相依，直接以 node 執行）
//   驗證重點：
//     1. 清單只讀 meta：整個列舉過程不得讀取任何 *.messages.json
//     2. clineScope=workspace 依 workspace_root 過濾；all 不過濾
//     3. skills 工具呼叫（input.skill）會標記該技能為 isInvoked
//     4. <server>__<tool> 會標記 MCP 伺服器，且只保留實際呼叫的工具
//     5. workspaceState.json 的 localSkillsToggles / localClineRulesToggles 會反映在
//        isEnabled 與 clineSettings 統計，且關閉的常駐規範不得出現在快照
//     6. 沒有 Cline 資料目錄時 available=false、清單為空、解析不拋錯
//     7. > 20 MB 的 messages.json 走串流降級路徑（不 JSON.parse）仍能取得足跡
//   執行：node tests/cline-snapshot.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：USERPROFILE / APPDATA / CLINE_DATA_DIR 全指向系統暫存目錄下的夾具，
//         不觸碰真實的 ~/.cline、Documents/Cline 或 IDE 設定
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'ai-context-inspector-cline-test');
const FAKE_HOME = path.join(ROOT, 'home');
const CLINE_DATA = path.join(FAKE_HOME, '.cline', 'data');
const WORKSPACE = path.join(ROOT, 'ws');
const OTHER_WORKSPACE = path.join(ROOT, 'ws-other');

// 必須在 require 服務前改寫環境變數（服務以 USERPROFILE / APPDATA 推導路徑）
process.env.USERPROFILE = FAKE_HOME;
process.env.APPDATA = path.join(ROOT, 'AppData');
process.env.CLINE_DATA_DIR = CLINE_DATA;

const ClineSessionService = require(path.join(EXT_ROOT, 'services', 'clineSessionService.js'));
const McpDetectorService = require(path.join(EXT_ROOT, 'services', 'mcpDetectorService.js'));

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', label + ' :: ' + e.message]);
  }
};

async function checkAsync(label, fn) {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', label + ' :: ' + e.message]);
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf-8');
}

function folders() {
  return [{ uri: { fsPath: WORKSPACE } }];
}

function makeSession(sessionId, workspaceRoot, messages, overrides = {}) {
  const sessionDir = path.join(CLINE_DATA, 'sessions', sessionId);
  writeJson(path.join(sessionDir, `${sessionId}.json`), {
    version: 1,
    session_id: sessionId,
    source: 'vscode',
    started_at: '2026-09-14T23:31:52.993Z',
    ended_at: '2026-09-15T00:34:49.649Z',
    status: 'completed',
    provider: 'cline',
    model: 'cline-free/deepseek-v4.1-flash',
    cwd: workspaceRoot,
    workspace_root: workspaceRoot,
    prompt: '測試用對話',
    metadata: {
      title: `測試用對話 ${sessionId.slice(-4)}`,
      modelId: 'cline-free/deepseek-v4.1-flash',
      tokensIn: 1200,
      tokensOut: 340,
      cacheReads: 800,
      totalCost: 0.012,
      usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 800, totalCost: 0.012 }
    },
    ...overrides
  });
  writeJson(path.join(sessionDir, `${sessionId}.messages.json`), {
    version: 1,
    sessionId,
    messages
  });
  return sessionDir;
}

function toolUse(name, input) {
  return {
    id: `msg_${name}`,
    role: 'assistant',
    content: [{ type: 'tool_use', id: `call_${name}`, name, input }]
  };
}

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });

  // ── 工作區夾具：AGENTS.md / .agents/rules / .agents/skills / .clinerules ────
  const agentsMd = path.join(WORKSPACE, 'AGENTS.md');
  writeText(agentsMd, '# 專案規範\n\n給 AI 的核心指示。\n');

  const touchedRule = path.join(WORKSPACE, '.agents', 'rules', 'touched-rule.md');
  writeText(touchedRule, '# 被讀取的條件式規範\n\ntrigger: model_decision\n');
  writeText(path.join(WORKSPACE, '.agents', 'rules', 'untouched-rule.md'), '# 未被讀取的規範\n\ntrigger: model_decision\n');

  const disabledRule = path.join(WORKSPACE, '.clinerules', 'off-by-toggle.md');
  writeText(disabledRule, '# 在 Cline 設定中被關閉的規範\n\n不應出現在快照。\n');
  const activeClineRule = path.join(WORKSPACE, '.clinerules', 'active.md');
  writeText(activeClineRule, '# 啟用中的 Cline 規範\n\n應出現在快照。\n');

  const demoSkillMd = path.join(WORKSPACE, '.agents', 'skills', 'demo-skill', 'SKILL.md');
  writeText(demoSkillMd, '---\nname: demo-skill\ndescription: 示範技能\n---\n\n# 示範技能\n');
  writeText(path.join(WORKSPACE, '.agents', 'skills', 'other-skill', 'SKILL.md'),
    '---\nname: other-skill\ndescription: 沒被呼叫的技能\n---\n\n# 沒被呼叫的技能\n');

  // 全域 Cline 規則（~/Documents/Cline/Rules）
  writeText(path.join(FAKE_HOME, 'Documents', 'Cline', 'Rules', 'global-rule.md'),
    '# 全域 Cline 規則\n\n一律生效。\n');

  // ── 對話夾具 ────────────────────────────────────────────────────────────────
  makeSession('sess-aaaa1111', WORKSPACE, [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: '<user_input mode="act">請幫我提交</user_input>' }] },
    toolUse('skills', { skill: 'demo-skill' }),
    toolUse('supermemory__search_memory', { query: '規範' }),
    toolUse('ghost-mcp__do_thing', {}),
    toolUse('read_files', { files: [{ path: touchedRule }] })
  ]);

  makeSession('sess-bbbb2222', OTHER_WORKSPACE, [
    toolUse('skills', { skill: 'other-skill' })
  ], {
    started_at: '2026-08-01T10:00:00.000Z',
    ended_at: '2026-08-01T10:05:00.000Z',
    metadata: { title: '另一個工作區的對話', totalCost: 0, tokensIn: 1, tokensOut: 1, cacheReads: 0 }
  });

  // ── 開關狀態與 Cline MCP 設定 ─────────────────────────────────────────────
  writeJson(path.join(CLINE_DATA, 'workspaces', 'ws-hash', 'workspaceState.json'), {
    localAgentsRulesToggles: { [agentsMd]: true },
    localClineRulesToggles: { [disabledRule]: false, [activeClineRule]: true },
    localSkillsToggles: { [demoSkillMd]: true },
    workflowToggles: {}
  });
  writeJson(path.join(CLINE_DATA, 'globalState.json'), {
    clineVersion: '4.1.25',
    actModeApiProvider: 'cline',
    planModeApiProvider: 'cline',
    actModeApiModelId: 'cline-free/deepseek-v4.1-flash',
    useAutoCondense: true
  });
  writeJson(path.join(CLINE_DATA, 'settings', 'cline_mcp_settings.json'), {
    mcpServers: {
      supermemory: { command: 'npx', args: ['-y', 'supermemory'], env: { API_KEY: 'should-not-leak' } },
      'unused-server': { command: 'node', args: ['unused.js'], disabled: true }
    }
  });

  // ── A1：清單只讀 meta（攔截任何 *.messages.json 讀取）────────────────────────
  let readMessagesDuringList = false;
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async function patchedReadFile(file, ...args) {
    if (String(file).toLowerCase().endsWith('.messages.json')) {
      readMessagesDuringList = true;
      throw new Error('列舉對話清單時不應讀取 messages.json');
    }
    return originalReadFile.call(this, file, ...args);
  };
  let workspaceList = [];
  try {
    workspaceList = await ClineSessionService.getConversationsList(folders(), { scope: 'workspace' });
  } finally {
    fsPromises.readFile = originalReadFile;
  }

  check('A1 清單只讀 meta（未讀 messages.json）', () => {
    assert.strictEqual(readMessagesDuringList, false, '列舉過程讀到了 messages.json');
    assert.deepStrictEqual(workspaceList.map(c => c.id), ['sess-aaaa1111'],
      '實際 ' + workspaceList.map(c => c.id).join(','));
    assert.strictEqual(workspaceList[0].source, 'cline');
  });

  const allList = await ClineSessionService.getConversationsList(folders(), { scope: 'all' });
  check('A2 clineScope=all 不過濾工作區', () => {
    assert.deepStrictEqual(allList.map(c => c.id).sort(), ['sess-aaaa1111', 'sess-bbbb2222'],
      '實際 ' + allList.map(c => c.id).join(','));
  });

  const snapshot = await ClineSessionService.parseConversationSnapshot('sess-aaaa1111', folders(), {
    scope: 'workspace'
  });

  check('A3 skills 工具呼叫 → 技能標記 isInvoked', () => {
    const names = snapshot.skills.workspace.map(s => s.dirName);
    assert.deepStrictEqual(names, ['demo-skill'], '實際 ' + names.join(','));
    assert.strictEqual(snapshot.skills.workspace[0].isInvoked, true);
    assert.strictEqual(snapshot.skills.workspace[0].isEnabled, true);
  });

  check('A4 MCP 以 <server>__<tool> 標記且只留實際呼叫的工具', () => {
    const server = snapshot.mcpServers.find(s => s.name === 'supermemory');
    assert.ok(server, '找不到 supermemory');
    assert.strictEqual(server.isInvoked, true);
    assert.deepStrictEqual(server.tools.map(t => t.name), ['search_memory']);
    assert.strictEqual(server.tools[0].isInvoked, true);

    const unused = snapshot.mcpServers.find(s => s.name === 'unused-server');
    assert.ok(unused, '找不到 unused-server');
    assert.strictEqual(unused.isInvoked, false);
    assert.deepStrictEqual(unused.tools, []);
    assert.ok(!('env' in server), 'MCP 條目不得帶出 env');
  });

  check('A5 開關狀態：關閉的常駐規範被排除、統計正確', () => {
    const names = snapshot.rules.alwaysActive.map(r => r.name);
    assert.ok(!names.includes('off-by-toggle.md'), '關閉的規範不應出現：' + names.join(','));
    assert.ok(names.includes('active.md'), '.clinerules 啟用項應出現：' + names.join(','));
    assert.ok(names.includes('AGENTS.md'), 'AGENTS.md 應出現：' + names.join(','));
    assert.ok(names.includes('global-rule.md'), '全域 Cline 規則應出現：' + names.join(','));
    assert.strictEqual(snapshot.clineSettings.clineVersion, '4.1.25');
    assert.ok(snapshot.clineSettings.disabledRules >= 1, 'disabledRules 應 >= 1');
  });

  check('A6 條件式規範：只有被讀取的才算足跡', () => {
    const names = snapshot.rules.conditional.map(r => r.name);
    assert.deepStrictEqual(names, ['touched-rule.md'], '實際 ' + names.join(','));
    assert.strictEqual(snapshot.rules.conditional[0].isInvoked, true);
  });

  check('A7 對話 meta（來源 / 模型 / 狀態 / Token）', () => {
    assert.strictEqual(snapshot.sourceId, 'cline');
    assert.strictEqual(snapshot.model, 'cline-free/deepseek-v4.1-flash');
    assert.strictEqual(snapshot.status, 'completed');
    assert.strictEqual(snapshot.usage.tokensIn, 1200);
    assert.ok(snapshot.conversationTitle.startsWith('測試用對話'), '實際 ' + snapshot.conversationTitle);
  });

  check('A7b 設定檔已移除但實際呼叫過的 MCP 仍會列出', () => {
    const ghost = snapshot.mcpServers.find(s => s.name === 'ghost-mcp');
    assert.ok(ghost, '找不到 ghost-mcp');
    assert.strictEqual(ghost.isInvoked, true);
    assert.strictEqual(ghost.scope, 'Cline');
    assert.deepStrictEqual(ghost.tools.map(t => t.name), ['do_thing']);
  });

  // ── A10/A11：常駐規範的掃描範圍與「已調用」語意 ────────────────────────────
  const otherSnapshot = await ClineSessionService.parseConversationSnapshot('sess-bbbb2222', folders(), {
    scope: 'all'
  });

  check('A10 常駐規範以「對話自己的工作區」掃描（不看目前開著的視窗）', () => {
    const names = otherSnapshot.rules.alwaysActive.map(r => r.name);
    assert.ok(!names.includes('AGENTS.md'),
      '不應列出目前視窗（WORKSPACE）的 AGENTS.md：' + names.join(','));
    assert.ok(!names.includes('active.md'),
      '不應列出目前視窗的 .clinerules：' + names.join(','));
    assert.ok(names.includes('global-rule.md'), '全域 Cline 規則仍應列出：' + names.join(','));
    assert.strictEqual(otherSnapshot.workspaces[0].path, OTHER_WORKSPACE,
      '實際 ' + JSON.stringify(otherSnapshot.workspaces));
  });

  check('A11 常駐規範被列出但未被讀取時不標記 isInvoked（維持足跡語意）', () => {
    const agents = snapshot.rules.alwaysActive.find(r => r.name === 'AGENTS.md');
    assert.ok(agents, '找不到 AGENTS.md');
    assert.strictEqual(agents.isEnabled, true);
    assert.strictEqual(agents.isInvoked, false, '未被工具讀取者不得標記為已調用');
  });

  await checkAsync('A8 缺少 Cline 資料目錄：available=false、清單空、解析不拋錯', async () => {
    const missing = path.join(ROOT, 'no-cline-data');
    assert.strictEqual(ClineSessionService.isAvailable(missing), false);

    const emptyList = await ClineSessionService.getConversationsList([], { clineDataDir: missing, scope: 'all' });
    assert.deepStrictEqual(emptyList, []);

    const empty = await ClineSessionService.parseConversationSnapshot(null, folders(), { clineDataDir: missing });
    assert.strictEqual(empty.mode, 'snapshot');
    assert.ok(Array.isArray(empty.rules.alwaysActive), 'rules 應為陣列');
    assert.ok(empty.error && empty.error.includes('Cline'), '應帶明確錯誤訊息');
  });

  // ── A9：> 20 MB 的 messages.json 必須走串流降級路徑 ─────────────────────────
  const bigId = 'sess-cccc3333';
  const bigDir = path.join(CLINE_DATA, 'sessions', bigId);
  writeJson(path.join(bigDir, `${bigId}.json`), {
    version: 1,
    session_id: bigId,
    source: 'vscode',
    started_at: '2026-09-15T01:00:00.000Z',
    ended_at: '2026-09-15T01:30:00.000Z',
    status: 'completed',
    provider: 'cline',
    model: 'big-model',
    workspace_root: WORKSPACE,
    prompt: '大檔案對話',
    metadata: { title: '大檔案對話', tokensIn: 1, tokensOut: 1, cacheReads: 0, totalCost: 0 }
  });

  const padding = 'x'.repeat(21 * 1024 * 1024);
  fs.writeFileSync(
    path.join(bigDir, `${bigId}.messages.json`),
    JSON.stringify({
      version: 1,
      sessionId: bigId,
      messages: [
        { id: 'b1', role: 'user', content: [{ type: 'text', text: padding }] },
        { id: 'b2', role: 'assistant', content: [{ type: 'tool_use', id: 'call_b1', name: 'skills', input: { skill: 'demo-skill' } }] },
        { id: 'b3', role: 'assistant', content: [{ type: 'tool_use', id: 'call_b2', name: 'editor', input: { path: agentsMd } }] }
      ]
    }, null, 2),
    'utf-8'
  );

  // 清掉 3 秒 TTL 快取，確保新建的大檔案 session 進得了清單
  ClineSessionService._listCache.clear();
  ClineSessionService._metaCache.clear();

  const bigSnapshot = await ClineSessionService.parseConversationSnapshot(bigId, folders(), { scope: 'workspace' });

  check('A9 > 20 MB messages 走串流降級仍取得足跡', () => {
    assert.strictEqual(bigSnapshot.conversationId, bigId, '實際 ' + bigSnapshot.conversationId);
    assert.strictEqual(bigSnapshot.footprint.degraded, true, '應標記 degraded');
    const agentsRule = bigSnapshot.rules.alwaysActive.find(r => r.name === 'AGENTS.md');
    assert.ok(agentsRule, '找不到 AGENTS.md');
    assert.strictEqual(agentsRule.isInvoked, true, '串流掃描應抓到被讀取的路徑');
    const skillNames = bigSnapshot.skills.workspace.map(s => s.dirName);
    assert.ok(skillNames.includes('demo-skill'), '串流掃描應抓到 skills 呼叫：' + skillNames.join(','));
  });

  const failed = results.filter(r => r[0] === 'FAIL');
  for (const [status, label] of results) {
    console.log(`${status}  ${label}`);
  }
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);

  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
});



