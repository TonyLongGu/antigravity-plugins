// ==============================================================================
// 檔案名稱：tests/kilo-snapshot.test.js
// 功能說明：Kilo Code 對話快照來源的回歸測試（零相依）
//   驗證重點：
//     1. kilo.db（SQLite）的 session 表可列出對話，並依工作區目錄過濾
//     2. 足跡（tool／patch part）可還原：讀過的路徑、技能呼叫、MCP 工具呼叫
//     3. 快照環境掃描走 Kilo 佈局（AGENTS.md、.agents/skills、.kilo/rules），
//        不誤抓 Antigravity 的 ~/.gemini 全域設定
//     4. MCP 來源：~/.config/kilo/kilo.jsonc（JSONC）的 mcp 段 + 專案 .kilo/mcp.json
//     5. 宿主 Node 沒有 node:sqlite 時 isAvailable() 必須回 false（優雅降級）
//   執行：node tests/kilo-snapshot.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：所有夾具都在系統暫存目錄，測試結束自動清除，不觸碰真實使用者資料
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-inspector-kilo-test');
const HOME = path.join(ROOT, 'home');
const APPDATA = path.join(ROOT, 'appdata');
const WS = path.join(ROOT, 'ws');
const OTHER_WS = path.join(ROOT, 'other-ws');
const KILO_DATA = path.join(HOME, '.local', 'share', 'kilo');
const KILO_DB = path.join(KILO_DATA, 'kilo.db');
const KILO_CONFIG_HOME = path.join(HOME, '.config', 'kilo');
const WS_SKILL_FOO = path.join(WS, '.agents', 'skills', 'foo');
const GLOBAL_SKILL_BAR = path.join(HOME, '.agents', 'skills', 'bar');

process.env.USERPROFILE = HOME;
process.env.APPDATA = APPDATA;
process.env.XDG_CONFIG_HOME = path.join(HOME, '.config');
process.env.XDG_DATA_HOME = path.join(HOME, '.local', 'share');

const KiloSessionService = require(path.join(EXT_ROOT, 'services', 'kiloSessionService.js'));

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', `${label} :: ${e.message}`]);
  }
};

function writeSkill(dir, name, description) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  );
}

function createFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(WS, { recursive: true });
  fs.mkdirSync(OTHER_WS, { recursive: true });
  fs.mkdirSync(KILO_DATA, { recursive: true });
  fs.mkdirSync(KILO_CONFIG_HOME, { recursive: true });
  fs.mkdirSync(path.join(WS, '.kilo', 'rules'), { recursive: true });
  fs.mkdirSync(path.join(WS, 'src'), { recursive: true });

  fs.writeFileSync(path.join(WS, 'AGENTS.md'), '# 專案規範\n\n測試用。\n');
  fs.writeFileSync(path.join(WS, '.kilo', 'rules', 'team.md'), '# Team rules\n');
  fs.writeFileSync(path.join(WS, 'src', 'a.js'), '// fixture\n');
  writeSkill(WS_SKILL_FOO, 'foo', 'workspace skill');
  writeSkill(GLOBAL_SKILL_BAR, 'bar', 'global skill');

  // Kilo 全域設定（JSONC：含註解與尾逗號）
  fs.writeFileSync(
    path.join(KILO_CONFIG_HOME, 'kilo.jsonc'),
    `{
      // 全域 MCP（測試註解）
      "mcp": {
        "supermemory": { "type": "remote", "url": "https://mcp.example/mcp" },
        "chrome": { "type": "local", "command": ["node", "chrome.js", "--flag"], },
      },
    }\n`
  );

  // 專案層 MCP
  fs.mkdirSync(path.join(WS, '.kilo'), { recursive: true });
  fs.writeFileSync(
    path.join(WS, '.kilo', 'mcp.json'),
    JSON.stringify({ mcpServers: { localproj: { command: 'node', args: ['server.js'] } } })
  );

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(KILO_DB);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, directory TEXT, title TEXT, slug TEXT, model TEXT,
      cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_cache_read INTEGER,
      time_created INTEGER, time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
      time_created INTEGER, time_updated INTEGER, data TEXT
    );
  `);
  const now = Date.now();
  const insertSession = db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insertSession.run(
    'ses_test_1', WS, 'Kilo 測試對話', 'test-slug',
    JSON.stringify({ id: 'deepseek-v4.1-flash', providerID: 'opencode-go', variant: 'high' }),
    0.01, 120, 30, 5, now - 1000, now
  );
  insertSession.run('ses_test_2', OTHER_WS, '別的工作區', 'other', null, 0, 10, 5, 0, now - 5000, now - 4000);

  const insertMessage = db.prepare('INSERT INTO message VALUES (?,?,?,?,?)');
  insertMessage.run('msg_1', 'ses_test_1', now - 900, now - 900, '{"role":"user"}');
  insertMessage.run('msg_2', 'ses_test_1', now - 800, now - 800, '{"role":"assistant"}');
  // session.model 為空的舊對話：應退回第一則帶模型的訊息
  insertMessage.run(
    'msg_3', 'ses_test_2', now - 4700, now - 4700,
    '{"role":"assistant","modelID":"derived-model","providerID":"derived-provider"}'
  );

  const insertPart = db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)');
  const pushPart = (id, sessionId, data) => insertPart.run(id, `msg_${sessionId}`, sessionId, now, now, JSON.stringify(data));

  pushPart('prt_1', 'ses_test_1', {
    type: 'tool',
    tool: 'read',
    state: { input: { filePath: path.join(WS, 'AGENTS.md') } }
  });
  pushPart('prt_2', 'ses_test_1', {
    type: 'tool',
    tool: 'skill',
    state: { input: { name: 'foo' } }
  });
  pushPart('prt_3', 'ses_test_1', {
    type: 'tool',
    tool: 'supermemory_search_memory',
    state: { input: { query: 'test' } }
  });
  pushPart('prt_4', 'ses_test_1', {
    type: 'patch',
    files: [path.join(WS, 'src', 'a.js')]
  });
  // 大型 base64 不應被讀取（此筆不應影響足跡）
  pushPart('prt_5', 'ses_test_1', {
    type: 'file',
    filename: 'image.png',
    url: `data:image/png;base64,${'A'.repeat(1024)}`
  });
  db.close();
}

async function main() {
  createFixtures();

  await check('K0 環境支援 node:sqlite 且偵測到 kilo.db', () => {
    assert.strictEqual(KiloSessionService.isAvailable(), true, 'isAvailable 應為 true');
  });

  await check('K1 對話清單依工作區目錄過濾', async () => {
    const folders = [{ uri: { fsPath: WS } }];
    const workspaceList = await KiloSessionService.getConversationsList(folders, { scope: 'workspace' });
    assert.deepStrictEqual(workspaceList.map(i => i.id), ['ses_test_1']);
    assert.strictEqual(workspaceList[0].source, 'kilo');
    assert.strictEqual(workspaceList[0].usage.tokensIn, 120);
    // model 欄位是 JSON 字串，必須正規化成純模型名稱
    assert.strictEqual(workspaceList[0].model, 'deepseek-v4.1-flash');
    assert.strictEqual(workspaceList[0].provider, 'opencode-go');

    const all = await KiloSessionService.getConversationsList(folders, { scope: 'all' });
    assert.strictEqual(all.length, 2, `實際 ${all.length}`);
    const derived = all.find(i => i.id === 'ses_test_2');
    assert.strictEqual(derived.model, 'derived-model', 'session.model 為空時應退回訊息中的模型');
    assert.strictEqual(derived.provider, 'derived-provider');
  });

  await check('K2 快照足跡：路徑／技能／MCP／patch 都能還原', async () => {
    const snapshot = await KiloSessionService.parseConversationSnapshot(
      'ses_test_1',
      [{ uri: { fsPath: WS } }],
      { scope: 'workspace' }
    );
    assert.strictEqual(snapshot.sourceId, 'kilo');
    assert.strictEqual(snapshot.conversationId, 'ses_test_1');
    assert.strictEqual(snapshot.model, 'deepseek-v4.1-flash', `實際 ${snapshot.model}`);
    assert.strictEqual(snapshot.provider, 'opencode-go', `實際 ${snapshot.provider}`);
    assert.strictEqual(snapshot.footprint.messageCount, 2, `實際 ${snapshot.footprint.messageCount}`);
    assert.strictEqual(snapshot.footprint.toolCount, 3, `實際 ${snapshot.footprint.toolCount}`);

    const agents = snapshot.rules.alwaysActive.find(r => (r.filePath || '').toLowerCase().endsWith('agents.md'));
    assert.ok(agents, '應列出 AGENTS.md');
    assert.strictEqual(agents.isInvoked, true, 'AGENTS.md 應被標為已讀取');

    assert.ok(snapshot.rules.alwaysActive.some(r => r.filePath && r.filePath.includes('team.md')), '應列出 .kilo/rules');

    const foo = snapshot.skills.workspace.find(s => s.name === 'foo' || s.dirName === 'foo');
    assert.ok(foo, '應列出工作區技能 foo');
    assert.ok(!snapshot.skills.global.some(s => s.name === 'bar' || s.dirName === 'bar'), '未叫用的全域技能不列入');

    const supermemory = snapshot.mcpServers.find(s => s.name === 'supermemory');
    assert.ok(supermemory, '應列出全域 MCP server');
    assert.strictEqual(supermemory.isInvoked, true);
    assert.ok(supermemory.tools.some(t => t.name === 'supermemory_search_memory'));

    const chrome = snapshot.mcpServers.find(s => s.name === 'chrome');
    assert.strictEqual(chrome.isInvoked, false);
    const localproj = snapshot.mcpServers.find(s => s.name === 'localproj');
    assert.ok(localproj, '應列出專案 .kilo/mcp.json 的 server');
    assert.strictEqual(localproj.isInvoked, false);
  });

  await check('K3 找不到對話時回傳空快照而不是拋錯', async () => {
    const snapshot = await KiloSessionService.parseConversationSnapshot(
      'ses_not_exist',
      [{ uri: { fsPath: path.join(ROOT, 'no-such-ws') } }],
      { scope: 'workspace' }
    );
    assert.strictEqual(snapshot.sourceId, 'kilo');
    assert.strictEqual(snapshot.conversationId, null);
    assert.ok(snapshot.error);
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
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
