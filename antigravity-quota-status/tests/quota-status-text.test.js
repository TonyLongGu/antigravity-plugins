// ==============================================================================
// 檔案名稱：tests/quota-status-text.test.js
// 功能說明：標準模式狀態列文字組裝的迴歸測試（零相依、不讀真實資料）
//   驗證重點：
//     1. 同一組同時有週與 5 小時配額時，兩個數字都要帶週期標籤
//     2. 只有單一 bucket 時，標籤要跟著實際存在的週期走
//        （weekly 缺資料時 gWk 會退回 primary，不能因此誤標成「週」）
//     3. 無上限（-1）與 null 仍沿用呼叫端原本的百分比格式
//   執行：node tests/quota-status-text.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const path = require('node:path');

const { formatStandardGroup } = require(path.join(__dirname, '..', 'services', 'statusText.js'));

const LABELS = { weekly: '週', fiveHour: '5h' };

function fmtPct(pct) {
  if (pct === null || pct === undefined) return '--';
  return pct === -1 ? '∞' : `${pct}%`;
}

function format(bucket) {
  return formatStandardGroup(bucket, LABELS, fmtPct);
}

async function main() {
  const results = [];
  const check = async (label, fn) => {
    try {
      await fn();
      results.push(['PASS', label]);
    } catch (err) {
      results.push(['FAIL', `${label} — ${err.message}`]);
    }
  };

  await check('S1 週 + 5h 都在：兩個數字各自標示週期', async () => {
    const text = format({ weeklyPct: 96, weeklyExists: true, fiveHourPct: 100, fiveHourExists: true });
    assert.strictEqual(text, '96% (週), 100% (5h)');
  });

  await check('S2 只有週配額：只顯示一個帶「週」的數字', async () => {
    const text = format({ weeklyPct: 96, weeklyExists: true, fiveHourPct: null, fiveHourExists: false });
    assert.strictEqual(text, '96% (週)');
  });

  await check('S3 只有 5h 配額：標籤必須是 5h，不能沿用退回 primary 的週數字', async () => {
    const text = format({ weeklyPct: 100, weeklyExists: false, fiveHourPct: 100, fiveHourExists: true });
    assert.strictEqual(text, '100% (5h)');
  });

  await check('S4 無上限值仍由呼叫端格式化', async () => {
    const text = format({ weeklyPct: -1, weeklyExists: true, fiveHourPct: null, fiveHourExists: false });
    assert.strictEqual(text, '∞ (週)');
  });

  await check('S5 缺值顯示 -- 且保留週期標籤', async () => {
    const text = format({ weeklyPct: null, weeklyExists: true, fiveHourPct: null, fiveHourExists: false });
    assert.strictEqual(text, '-- (週)');
  });

  let failed = 0;
  for (const [state, label] of results) {
    console.log(`${state}  ${label}`);
    if (state === 'FAIL') failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
