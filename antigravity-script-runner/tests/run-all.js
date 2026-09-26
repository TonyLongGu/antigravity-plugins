/**
 * 測試總執行器
 *
 * 依序執行三支驗證腳本，並彙整結果；任一失敗即回傳非零退出碼。
 * 用法：node tests/run-all.js   （或 npm test）
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUITES = [
  { file: 'locales.check.js', title: '語系字典對稱性與引用完整性' },
  { file: 'frontend.dom.js', title: '前端互動語意（DOM 模擬）' },
  { file: 'backend.smoke.js', title: '後端面板生命週期與訊息流（mock vscode）' }
];

let failedSuites = 0;
for (const suite of SUITES) {
  console.log('\n' + '='.repeat(72));
  console.log(`▶ ${suite.title}  (tests/${suite.file})`);
  console.log('='.repeat(72));
  const result = spawnSync(process.execPath, [path.join(__dirname, suite.file)], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  if (result.status !== 0) {
    failedSuites++;
    console.log(`✖ ${suite.file} 未通過（exit=${result.status}）`);
  }
}

console.log('\n' + '='.repeat(72));
if (failedSuites === 0) {
  console.log(`ALL-SUITES-PASSED (${SUITES.length}/${SUITES.length})`);
} else {
  console.log(`SUITES-FAILED (${failedSuites}/${SUITES.length})`);
}
console.log('='.repeat(72));
process.exitCode = failedSuites === 0 ? 0 : 1;
