// ==============================================================================
// 檔案名稱：tests/antigravity-roots.test.js
// 功能說明：Antigravity 新舊資料根（~/.gemini/antigravity 與 antigravity-ide）的
//           解析與合併回歸測試（零相依，vscode 以 stub 取代）
//   為什麼要這一支：Antigravity 2026-10-29 遷移資料根後，toolbox 只掃舊根，
//   導致「對話記憶庫」統計少一整批新對話，清理範圍也看不到新根。
//   驗證重點：
//     R0 只有新根 → 主要根＝新根，brain 統計與掃描都看到新根對話
//     R1 只有舊根（尚未遷移的機器）→ 主要根退回舊根，環境判定仍算有 Antigravity
//     R2 兩邊都有且同 convId → 去重後只留一份（新根），dedupe=false 仍看得到兩份實體
//     R3 兩邊都沒有 → 回退到新根預設路徑、不報錯、清單為空
//     R4 同 convId 新根只有 .user_uploaded、舊根才有 transcript → 選有對話的舊根那份
//     R5 同 convId 新根有 transcript、舊根只有 transcript_full → 選可讀性較高的新根
//   執行：node tests/antigravity-roots.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-toolbox-antigravity-roots-test');
const HOME = path.join(ROOT, 'home');

// ── vscode stub（只滿足被呼叫到的 API）─────────────────────────────────────
const vscodeStub = {
  env: { appName: 'Visual Studio Code' },
  workspace: {
    workspaceFile: undefined,
    workspaceFolders: [],
    getConfiguration: () => ({
      get: (key, defaultValue) => defaultValue,
      update: async () => {},
      inspect: () => null,
    }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  Uri: { file: (p) => ({ fsPath: p }), joinPath: () => ({ fsPath: '' }) },
  extensions: { getExtension: () => undefined },
  window: {
    showInformationMessage: () => undefined,
    showErrorMessage: () => undefined,
    showWarningMessage: async () => undefined,
  },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.apply(this, arguments);
};

process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.APPDATA = path.join(ROOT, 'appdata');

const systemService = require(path.join(EXT_ROOT, 'services', 'systemService.js'));
const brainService = require(path.join(EXT_ROOT, 'services', 'brainService.js'));

// ── 測試框架 ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✘ ${name}\n    ${err.message}`);
  }
}

function assertEqual(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}：預期 ${expected}，實際 ${actual}`);
}

function resetFakeHome() {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  systemService.resetCopilotEnvironmentCache();
  brainService.invalidateCache();
}

function geminiDir(rootName) {
  return path.join(HOME, '.gemini', rootName);
}

/**
 * 建立一個 brain 對話資料夾
 * @param {'antigravity'|'antigravity-ide'} rootName
 * @param {string} convId
 * @param {{transcript?:boolean, fullTranscriptOnly?:boolean, markerOnly?:boolean}} [options]
 */
function makeSession(rootName, convId, options = {}) {
  const convDir = path.join(geminiDir(rootName), 'brain', convId);
  fs.mkdirSync(convDir, { recursive: true });
  if (options.markerOnly) {
    fs.writeFileSync(path.join(convDir, '.user_uploaded'), '', 'utf-8');
    return convDir;
  }
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  if (options.fullTranscriptOnly) {
    fs.writeFileSync(path.join(logsDir, 'transcript_full.jsonl'), '{"full":true}\n', 'utf-8');
  } else {
    fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), '{"text":"hello"}\n', 'utf-8');
  }
  if (options.sizeBytes) {
    fs.writeFileSync(path.join(logsDir, 'blob.bin'), Buffer.alloc(options.sizeBytes, 97));
  }
  return convDir;
}

async function main() {
  console.log('antigravity-roots.test.js — Antigravity 新舊資料根');

  // ── R0：只有新根 ─────────────────────────────────────────────────────────
  await test('R0 只有新根 → 主要根＝新根，brain 掃描與統計都看得到', async () => {
    resetFakeHome();
    makeSession('antigravity', 'aaaaaaaa-0000-0000-0000-000000000001', { sizeBytes: 200 * 1024 });
    makeSession('antigravity', 'aaaaaaaa-0000-0000-0000-000000000002', { sizeBytes: 200 * 1024 });

    const paths = systemService.getGlobalPaths('antigravity');
    assertEqual(paths.brain, path.join(geminiDir('antigravity'), 'brain'), 'brain 路徑');
    assertEqual(paths.brainScanRoots.length, 1, '掃描根數');
    assertEqual(systemService.collectBrainSessionDirs('antigravity').length, 2, '對話數');

    const stats = await brainService.getBrainStats(true);
    assertEqual(stats.folderCount, 2, '統計對話數');
    assertEqual(stats.path, path.join(geminiDir('antigravity'), 'brain'), '統計顯示路徑');
    assert.ok(stats.totalMB !== '0.0', '統計容量不應為 0');
  });

  // ── R1：只有舊根 ─────────────────────────────────────────────────────────
  await test('R1 只有舊根 → 主要根退回舊根，環境判定仍算有 Antigravity', async () => {
    resetFakeHome();
    makeSession('antigravity-ide', 'bbbbbbbb-0000-0000-0000-000000000001');

    const roots = systemService.resolveAntigravityRoots();
    assertEqual(roots.activeRoot, geminiDir('antigravity-ide'), '主要根');
    assertEqual(roots.exists, true, '根存在判定');

    const paths = systemService.getGlobalPaths('antigravity');
    assertEqual(paths.brain, path.join(geminiDir('antigravity-ide'), 'brain'), 'brain 路徑');
    assertEqual(systemService.collectBrainSessionDirs('antigravity').length, 1, '對話數');

    const env = systemService.getEnvironmentInfo();
    assertEqual(env.flavors.antigravity, true, 'Antigravity 可用判定');
    assertEqual(env.paths.brain, path.join(geminiDir('antigravity-ide'), 'brain'), '環境摘要 brain 路徑');
  });

  // ── R2：兩邊都有且同 convId ───────────────────────────────────────────────
  await test('R2 兩邊都有且同 convId → 去重留新根；dedupe=false 仍列出兩份實體', async () => {
    resetFakeHome();
    const shared = 'cccccccc-0000-0000-0000-000000000001';
    makeSession('antigravity', shared);
    makeSession('antigravity-ide', shared);
    makeSession('antigravity', 'cccccccc-0000-0000-0000-000000000002');
    makeSession('antigravity-ide', 'cccccccc-0000-0000-0000-000000000003');

    const paths = systemService.getGlobalPaths('antigravity');
    assertEqual(paths.brainScanRoots.length, 2, '掃描根數');
    assertEqual(paths.brainScanRoots[0], path.join(geminiDir('antigravity'), 'brain'), '新根優先');

    const deduped = systemService.collectBrainSessionDirs('antigravity');
    assertEqual(deduped.length, 3, '去重後對話數');
    assert.ok(
      deduped.includes(path.join(geminiDir('antigravity'), 'brain', shared)),
      '同 id 應保留新根那份'
    );

    const all = systemService.collectBrainSessionDirs('antigravity', { dedupe: false });
    assertEqual(all.length, 4, '不去重實體數');

    const stats = await brainService.getBrainStats(true);
    assertEqual(stats.folderCount, 3, '統計以去重後計算');
  });

  // ── R3：兩邊都沒有 ───────────────────────────────────────────────────────
  await test('R3 兩邊都沒有 → 回退新根預設路徑、清單為空、不拋錯', async () => {
    resetFakeHome();

    const roots = systemService.resolveAntigravityRoots();
    assertEqual(roots.exists, false, '根存在判定');
    assertEqual(roots.activeRoot, geminiDir('antigravity'), '主要根回退新根');

    const paths = systemService.getGlobalPaths('antigravity');
    assertEqual(paths.brain, path.join(geminiDir('antigravity'), 'brain'), 'brain 預設路徑');
    assertEqual(systemService.collectBrainSessionDirs('antigravity').length, 0, '對話數');

    const stats = await brainService.getBrainStats(true);
    assertEqual(stats.folderCount, 0, '統計對話數');
    assertEqual(stats.totalMB, '0.0', '統計容量');

    const env = systemService.getEnvironmentInfo();
    assertEqual(env.flavors.antigravity, false, 'Antigravity 可用判定');
  });

  // ── R4：同 id，新根只有標記、舊根才有 transcript ──────────────────────────
  await test('R4 同 id 新根只剩 .user_uploaded、舊根有 transcript → 選舊根那份', async () => {
    resetFakeHome();
    const convId = 'dddddddd-0000-0000-0000-000000000001';
    makeSession('antigravity', convId, { markerOnly: true });
    const legacyDir = makeSession('antigravity-ide', convId);

    const deduped = systemService.collectBrainSessionDirs('antigravity');
    assertEqual(deduped.length, 1, '去重後對話數');
    assertEqual(deduped[0], legacyDir, '應選有 transcript 的舊根');

    const all = systemService.collectBrainSessionDirs('antigravity', { dedupe: false });
    assertEqual(all.length, 2, '實體仍有兩份（清理不漏舊根）');
  });

  // ── R5：同 id，新根有 transcript、舊根只有 transcript_full ───────────────
  await test('R5 同 id 新根有 transcript、舊根只有 transcript_full → 選新根', async () => {
    resetFakeHome();
    const convId = 'eeeeeeee-0000-0000-0000-000000000001';
    const primaryDir = makeSession('antigravity', convId);
    makeSession('antigravity-ide', convId, { fullTranscriptOnly: true });

    const deduped = systemService.collectBrainSessionDirs('antigravity');
    assertEqual(deduped.length, 1, '去重後對話數');
    assertEqual(deduped[0], primaryDir, '應選有 transcript 的新根');
  });

  console.log('');
  console.log(`${failed === 0 ? '全部通過' : '有失敗'}：通過 ${passed}／失敗 ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
