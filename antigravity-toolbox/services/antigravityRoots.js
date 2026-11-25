// ==============================================================================
// 檔案名稱：services/antigravityRoots.js
// 功能說明：解析 Antigravity 的資料根（新舊兩代並存）
//   為什麼要這一支：Antigravity 於 2026-10-29 把資料從 `~/.gemini/antigravity-ide`
//   搬到 `~/.gemini/antigravity`，舊根自此凍結。外掛若只讀舊根，遷移後的對話
//   （brain/<convId>/）與設定全都看不到，統計與清理範圍也會少一整批。
//   規則：新根優先、舊根當歷史來源；兩邊都掃、同 convId 只留可讀性最高的那一份。
//   註：六個外掛沒有程式碼共用（維護技能 §2），這裡自建最小解析，
//       不 require inspector 的 `services/antigravityDataRoots.js`。
// ==============================================================================

const fs = require('node:fs');
const path = require('node:path');

/** 新根資料夾名稱（2026-10-29 起的正式位置） */
const PRIMARY_DIR_NAME = 'antigravity';
/** 舊根資料夾名稱（遷移後凍結，仍保有 10/29 之前的歷史） */
const LEGACY_DIR_NAME = 'antigravity-ide';

/** brain 對話資料夾內，代表「這份有可讀對話」的檔案（依優先序） */
const TRANSCRIPT_FILES = ['transcript.jsonl', 'transcript_full.jsonl'];

function getDefaultHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || '';
}

/**
 * 解析 Antigravity 資料根。
 * @param {string} [homeDir] 使用者家目錄，省略時讀環境變數（測試請傳假 home）
 * @returns {{primaryRoot:string, legacyRoot:string, activeRoot:string, scanRoots:string[], exists:boolean}}
 *   primaryRoot／legacyRoot：兩個候選根（不論存在與否）
 *   activeRoot：主要根——新根存在就用新根；尚未遷移（只有舊根）才退回舊根
 *   scanRoots：實際存在的全部根，新根在前
 */
function resolveAntigravityRoots(homeDir = getDefaultHomeDir()) {
  const geminiHome = path.join(homeDir, '.gemini');
  const primaryRoot = path.join(geminiHome, PRIMARY_DIR_NAME);
  const legacyRoot = path.join(geminiHome, LEGACY_DIR_NAME);
  const existingRoots = [primaryRoot, legacyRoot].filter((root) => fs.existsSync(root));

  return {
    primaryRoot,
    legacyRoot,
    activeRoot: existingRoots[0] || primaryRoot,
    scanRoots: existingRoots,
    exists: existingRoots.length > 0,
  };
}

/**
 * 各根底下的同名子目錄（只回實際存在的目錄），新根在前。
 * @param {string} subDirName 例如 `brain`、`mcp`
 * @param {string} [homeDir]
 * @returns {string[]}
 */
function resolveAntigravitySubDirs(subDirName, homeDir) {
  return resolveAntigravityRoots(homeDir).scanRoots
    .map((root) => path.join(root, subDirName))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * 單一 brain 對話資料夾的「可讀性」分數：
 *   2＝有 transcript.jsonl、1＝只有 transcript_full.jsonl、0＝兩者都沒有。
 *   遷移後新根的資料夾可能只剩 `.user_uploaded` 之類的標記，舊根那份才有對話本體，
 *   因此同 convId 不能只看根目錄先後，要選分數高的。
 * @param {string} convDir
 * @returns {0|1|2}
 */
function scoreBrainSessionDir(convDir) {
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  if (fs.existsSync(path.join(logsDir, TRANSCRIPT_FILES[0]))) return 2;
  if (fs.existsSync(path.join(logsDir, TRANSCRIPT_FILES[1]))) return 1;
  return 0;
}

/**
 * 掃描全部根底下的 brain 對話資料夾（不去重）。
 * @param {string} [homeDir]
 * @returns {string[]} 新根在前
 */
function listAntigravityBrainSessionDirs(homeDir) {
  const sessions = [];
  for (const brainDir of resolveAntigravitySubDirs('brain', homeDir)) {
    let entries = [];
    try {
      entries = fs.readdirSync(brainDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) sessions.push(path.join(brainDir, entry.name));
    }
  }
  return sessions;
}

/**
 * 合併新舊根的 brain 對話資料夾，同 convId 去重。
 * 同一個 convId 取可讀性分數最高的一份；分數相同時保留先掃到的（新根）。
 * @param {string} [homeDir]
 * @returns {string[]}
 */
function collectAntigravityBrainSessionDirs(homeDir) {
  const byConvId = new Map();
  for (const convDir of listAntigravityBrainSessionDirs(homeDir)) {
    const convId = path.basename(convDir).toLowerCase();
    const existing = byConvId.get(convId);
    if (!existing) {
      byConvId.set(convId, { dir: convDir, score: scoreBrainSessionDir(convDir) });
      continue;
    }
    const score = scoreBrainSessionDir(convDir);
    if (score > existing.score) byConvId.set(convId, { dir: convDir, score });
  }
  return Array.from(byConvId.values(), (item) => item.dir);
}

module.exports = {
  PRIMARY_DIR_NAME,
  LEGACY_DIR_NAME,
  TRANSCRIPT_FILES,
  resolveAntigravityRoots,
  resolveAntigravitySubDirs,
  scoreBrainSessionDir,
  listAntigravityBrainSessionDirs,
  collectAntigravityBrainSessionDirs,
};
