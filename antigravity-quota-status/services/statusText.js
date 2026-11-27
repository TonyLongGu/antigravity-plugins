// ==============================================================================
// 檔案名稱：services/statusText.js
// 功能說明：狀態列文字組裝（純函式、不依賴 vscode，供 extension.js 與測試共用）
//   標準模式的一組可能有 1 個（僅週配額）或 2 個（週 + 5 小時）百分比，
//   只依序排數字會讓「Gemini 一個、Claude 兩個」無法分辨哪個是哪個，
//   因此每個數字都附上該 bucket 的週期標籤。
// ==============================================================================

/**
 * 組裝單一模型群組在標準模式下的文字
 * @param {{ weeklyPct: number|null, weeklyExists: boolean, fiveHourPct: number|null, fiveHourExists: boolean }} bucket
 * @param {{ weekly: string, fiveHour: string }} labels 週期短標籤（由 i18n 提供）
 * @param {(pct: number|null|undefined) => string} fmtPct 百分比格式化函式（由呼叫端注入）
 * @returns {string} 例：`96% (週), 100% (5h)`、`96% (週)`
 */
function formatStandardGroup(bucket, labels, fmtPct) {
  const weeklyText = `${fmtPct(bucket.weeklyPct)} (${labels.weekly})`;
  const fiveHourText = `${fmtPct(bucket.fiveHourPct)} (${labels.fiveHour})`;

  if (bucket.weeklyExists && bucket.fiveHourExists) {
    return `${weeklyText}, ${fiveHourText}`;
  }
  if (bucket.fiveHourExists) {
    return fiveHourText;
  }
  return weeklyText;
}

module.exports = { formatStandardGroup };
