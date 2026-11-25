// ==============================================================================
// 檔案名稱：tests/antigravity-data-roots.test.js
// 功能說明：Antigravity 對話資料根目錄搬遷的相容性回歸測試（零相依）
//   驗證重點：
//     1. 新根 ~/.gemini/antigravity 與舊根 ~/.gemini/antigravity-ide 合併列出
//        （只讀舊根會看不到搬遷後的新對話；只讀新根會整批掉歷史）
//     2. 同一個 convId 兩邊都有時只列一次，且選「有 transcript 的那一份」
//     3. 標題優先取 conversation_summaries.db 的 title（新格式 .db 已無標題字串）
//     4. 排序以摘要庫 last_modified_time 為準（brain 資料夾 mtime 會被碰觸失真）
//     5. 沒有摘要庫／沒有 node:sqlite 時優雅降級，不拋錯
//     6. 內建技能與 MCP 目錄同樣新舊合併、同名以新根為準
//   執行：node tests/antigravity-data-roots.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
//   設計：所有夾具都在系統暫存目錄，不觸碰真實使用者資料
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-inspector-data-roots-test');
const HOME = path.join(ROOT, 'home');
const MODERN = path.join(HOME, '.gemini', 'antigravity');
const LEGACY = path.join(HOME, '.gemini', 'antigravity-ide');
const SUMMARIES_DB = path.join(MODERN, 'conversation_summaries.db');

const NEW_ONLY = '11111111-1111-1111-1111-111111111111';
const DUP = '22222222-2222-2222-2222-222222222222';
const OLD_ONLY = '33333333-3333-3333-3333-333333333333';

process.env.USERPROFILE = HOME;

const TranscriptParserService = require(path.join(EXT_ROOT, 'services', 'transcriptParserService.js'));
const ContextScannerService = require(path.join(EXT_ROOT, 'services', 'contextScannerService.js'));
const McpDetectorService = require(path.join(EXT_ROOT, 'services', 'mcpDetectorService.js'));

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', `${label} :: ${e.message}`]);
  }
};

// 固定時間點，避免測試依賴執行時刻
const DAY = 24 * 60 * 60 * 1000;
const T_DUP_SUMMARY = Date.UTC(2026, 10, 20, 4, 0, 0);      // 摘要庫：重複對話
const T_NEW_SUMMARY = Date.UTC(2026, 10, 24, 12, 2, 35);    // 摘要庫：最新對話
const T_LEGACY_DIR = Date.UTC(2026, 10, 19, 4, 0, 0);       // 只有舊根的對話

function transcriptLine(requestText) {
  return JSON.stringify({
    type: 'USER_INPUT',
    content: `<USER_REQUEST>${requestText}</USER_REQUEST>`
  }) + '\n';
}

function writeTranscript(convDir, requestText, mtimeMs) {
  const logDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, 'transcript.jsonl');
  fs.writeFileSync(filePath, transcriptLine(requestText));
  fs.utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

function writeSkill(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} fixture\n---\n\n# ${name}\n`);
}

function writeMcpServer(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'instructions.md'), '# fixture server\n');
}

function createSummariesDb(rows) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(SUMMARIES_DB);
  db.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, last_modified_time datetime)');
  const insert = db.prepare('INSERT INTO conversation_summaries (conversation_id, title, last_modified_time) VALUES (?, ?, ?)');
  for (const row of rows) insert.run(row.id, row.title, row.time);
  db.close();
}

function createFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(MODERN, 'brain'), { recursive: true });
  fs.mkdirSync(path.join(MODERN, 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(LEGACY, 'brain'), { recursive: true });
  fs.mkdirSync(path.join(LEGACY, 'conversations'), { recursive: true });

  // 新根：搬遷後才產生的對話（只有新根有）
  const newOnlyDir = path.join(MODERN, 'brain', NEW_ONLY);
  writeTranscript(newOnlyDir, 'New conversation after migration', T_NEW_SUMMARY - 5 * DAY);

  // 同 id 兩邊都有：新根只剩 .user_uploaded（搬遷殘留），舊根才有 transcript
  const dupModern = path.join(MODERN, 'brain', DUP);
  fs.mkdirSync(path.join(dupModern, '.user_uploaded'), { recursive: true });
  const dupLegacy = path.join(LEGACY, 'brain', DUP);
  writeTranscript(dupLegacy, 'Duplicate Conversation', T_DUP_SUMMARY - 5 * DAY);

  // 只有舊根的歷史對話
  const oldOnlyDir = path.join(LEGACY, 'brain', OLD_ONLY);
  writeTranscript(oldOnlyDir, 'Legacy Only Conversation', T_LEGACY_DIR);

  // 讓重複對話的新根資料夾「看起來很新」（模擬被零星檔案碰觸），排序不得被它帶走
  const now = Date.now();
  fs.utimesSync(dupModern, now / 1000, now / 1000);

  // 其他資料夾的 mtime 對齊真實活躍時間（無摘要庫時排序才不會被建立時間帶走）
  fs.utimesSync(oldOnlyDir, T_LEGACY_DIR / 1000, T_LEGACY_DIR / 1000);
  fs.utimesSync(dupLegacy, T_DUP_SUMMARY / 1000, T_DUP_SUMMARY / 1000);
  fs.utimesSync(newOnlyDir, T_NEW_SUMMARY / 1000, T_NEW_SUMMARY / 1000);

  // 內建技能：新舊根各有一份，beta 兩邊都有（同名只留新根）
  writeSkill(path.join(MODERN, 'builtin', 'skills', 'alpha'), 'alpha');
  writeSkill(path.join(MODERN, 'builtin', 'skills', 'beta'), 'beta');
  writeSkill(path.join(LEGACY, 'builtin', 'skills', 'beta'), 'beta-legacy');
  writeSkill(path.join(LEGACY, 'builtin', 'skills', 'gamma'), 'gamma');

  // MCP：server-y 兩邊都有（同名以新根為準），x 只有新根、z 只有舊根
  writeMcpServer(path.join(MODERN, 'mcp', 'server-x'));
  writeMcpServer(path.join(MODERN, 'mcp', 'server-y'));
  writeMcpServer(path.join(LEGACY, 'mcp', 'server-y'));
  writeMcpServer(path.join(LEGACY, 'mcp', 'server-z'));
}

async function main() {
  createFixtures();

  let hasSqlite = true;
  try {
    require('node:sqlite');
  } catch (e) {
    hasSqlite = false;
  }

  if (hasSqlite) {
    createSummariesDb([
      { id: NEW_ONLY, title: 'Update AGENTS.md Rules File', time: '2026-11-24 12:02:35.7637336+00:00' },
      { id: DUP, title: '', time: '2026-11-20 04:00:00+00:00' }
    ]);
  }

  await check('D1 新舊兩個資料根合併列出（不是只剩舊歷史、也不是只剩新對話）', async () => {
    const list = await TranscriptParserService.getConversationsList();
    assert.deepStrictEqual(list.map(i => i.id).sort(), [NEW_ONLY, DUP, OLD_ONLY].sort());
  });

  await check('D2 同一個 convId 只列一次，且選有 transcript 的那一份資料夾', async () => {
    const list = await TranscriptParserService.getConversationsList();
    const dups = list.filter(i => i.id === DUP);
    assert.strictEqual(dups.length, 1, '重複對話應只出現一次');
    assert.ok(dups[0].dirPath.toLowerCase().startsWith(LEGACY.toLowerCase()), `應選舊根有日誌的資料夾，實際：${dups[0].dirPath}`);
  });

  if (hasSqlite) {
    await check('D3 標題優先取 conversation_summaries.db（新格式 .db 已無標題字串）', async () => {
      const list = await TranscriptParserService.getConversationsList();
      assert.strictEqual(list[0].title, 'Update AGENTS.md Rules File');
    });

    await check('D4 摘要標題為空時退回日誌首句請求（不得顯示空白或 undefined）', async () => {
      const list = await TranscriptParserService.getConversationsList();
      assert.strictEqual(list.find(i => i.id === DUP).title, 'Duplicate Conversation');
      assert.strictEqual(list.find(i => i.id === OLD_ONLY).title, 'Legacy Only Conversation');
    });

    await check('D5 排序以摘要庫 last_modified_time 為準，brain 資料夾 mtime 不得插隊', async () => {
      const list = await TranscriptParserService.getConversationsList();
      assert.deepStrictEqual(list.map(i => i.id), [NEW_ONLY, DUP, OLD_ONLY]);
    });
  } else {
    console.log('SKIP D3–D5（此 Node 沒有 node:sqlite，摘要庫路徑無法驗證）');
  }

  await check('D6 沒有摘要庫時仍能列出清單並降級排序（不拋錯）', async () => {
    if (fs.existsSync(SUMMARIES_DB)) fs.rmSync(SUMMARIES_DB, { force: true });
    const list = await TranscriptParserService.getConversationsList();
    assert.strictEqual(list.length, 3);
    assert.ok(list.every(i => typeof i.title === 'string' && i.title.length > 0));
  });

  await check('D7 內建技能新舊合併、同名以新根為準', async () => {
    const env = await ContextScannerService.scanLiveEnvironment([], {});
    const names = env.skills.builtin.map(s => s.name);
    for (const expected of ['alpha', 'beta', 'gamma']) {
      assert.strictEqual(names.filter(n => n === expected).length, 1, `${expected} 應只出現一次，實際：${names}`);
    }
    const beta = env.skills.builtin.find(s => s.name === 'beta');
    assert.ok(beta.filePath.toLowerCase().startsWith(MODERN.toLowerCase()), '同名技能應取新根');
  });

  await check('D8 MCP 目錄新舊合併、同名以新根為準', async () => {
    const servers = await McpDetectorService.scanMcpServers([]);
    const names = servers.map(s => s.name);
    for (const expected of ['server-x', 'server-y', 'server-z']) {
      assert.strictEqual(names.filter(n => n === expected).length, 1, `${expected} 應只出現一次，實際：${names}`);
    }
    const y = servers.find(s => s.name === 'server-y');
    assert.ok(y.path.toLowerCase().startsWith(MODERN.toLowerCase()), '同名 MCP 應取新根');
  });

  await check('D9 isAvailable：只有舊根也算有資料，兩者都沒有才回 false', async () => {
    assert.strictEqual(TranscriptParserService.isAvailable(), true);
    fs.rmSync(path.join(MODERN, 'brain'), { recursive: true, force: true });
    fs.rmSync(path.join(MODERN, 'conversations'), { recursive: true, force: true });
    fs.rmSync(path.join(LEGACY, 'brain'), { recursive: true, force: true });
    fs.rmSync(path.join(LEGACY, 'conversations'), { recursive: true, force: true });
    assert.strictEqual(TranscriptParserService.isAvailable(), false);
    assert.deepStrictEqual(await TranscriptParserService.getConversationsList(), []);
  });

  const failed = results.filter(r => r[0] === 'FAIL');
  for (const [status, label] of results) {
    console.log(`${status}  ${label}`);
  }
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  process.exit(1);
});
