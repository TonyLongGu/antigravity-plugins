'use strict';

/**
 * 以 node:sqlite 唯讀查詢 Cursor state.vscdb 的單一鍵值。
 * 由外掛以子行程呼叫，避免把 2GB+ 資料庫整檔載入記憶體。
 * 用法: node read-vscdb-value.js <dbPath> <key>
 * 成功時將純文字值寫到 stdout，找不到則輸出空字串。
 */
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.argv[2];
const key = process.argv[3];
if (!dbPath || !key) {
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
  if (row && row.value != null) {
    process.stdout.write(String(row.value));
  }
} finally {
  db.close();
}
