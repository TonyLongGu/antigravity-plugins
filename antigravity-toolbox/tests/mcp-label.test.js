// ==============================================================================
// 檔案名稱：tests/mcp-label.test.js
// 功能說明：「全域自訂」卡片 MCP 按鈕名稱統一為 mcp.json 的回歸測試（零相依）
//   驗證重點：
//     1. media/locales.js 三種語言（zh-TW / zh-CN / en）的 config_mcp 都是 mcp.json
//     2. 不得再出現依宿主分流的 config_mcp_<flavor> 覆寫鍵
//        （一旦有人加回 config_mcp_cline 之類的鍵，按鈕又會顯示 cline_mcp_settings.json）
//     3. index.html 的按鈕仍綁 data-i18n="config_mcp"，且預設文字為 mcp.json
//     4. 不動磁碟上的真實檔名：宿主實際路徑由 systemService 決定
//        （路徑回歸見 tests/environment-flavor.test.js）
//   執行：node tests/mcp-label.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const LOCALES_FILE = path.join(EXT_ROOT, 'media', 'locales.js');
const INDEX_FILE = path.join(EXT_ROOT, 'media', 'index.html');

// locales.js 是 IIFE，載入時會把 LOCALES 掛到 globalThis（見檔案末尾）
require(LOCALES_FILE);
const LOCALES = globalThis.LOCALES || {};

const LANGS = ['zh-TW', 'zh-CN', 'en'];
const UNIFIED_LABEL = 'mcp.json';

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✘ ${name}\n    ${e.message}`);
  }
}

function main() {
  console.log(`\n[mcp-label] 檢查 MCP 按鈕名稱統一為 ${UNIFIED_LABEL}\n`);

  check('L1 locales.js 可載入並提供三種語言', () => {
    assert.ok(fs.existsSync(LOCALES_FILE), `找不到 ${LOCALES_FILE}`);
    LANGS.forEach((lang) => {
      assert.ok(LOCALES[lang], `缺少語言 ${lang}`);
    });
  });

  LANGS.forEach((lang) => {
    check(`L2 ${lang} 的 config_mcp 為 ${UNIFIED_LABEL}`, () => {
      assert.strictEqual(LOCALES[lang].config_mcp, UNIFIED_LABEL);
    });
  });

  check('L3 沒有任何 config_mcp_* 宿主覆寫鍵', () => {
    LANGS.forEach((lang) => {
      const leftovers = Object.keys(LOCALES[lang]).filter((key) => /^config_mcp_/.test(key));
      assert.deepStrictEqual(leftovers, [], `${lang} 殘留 ${JSON.stringify(leftovers)}`);
    });
  });

  check('L4 index.html 按鈕綁定 config_mcp 且預設文字為 mcp.json', () => {
    const html = fs.readFileSync(INDEX_FILE, 'utf-8');
    const pattern = /data-i18n="config_mcp"[^>]*>\s*([^<]+?)\s*</;
    const match = html.match(pattern);
    assert.ok(match, '找不到 data-i18n="config_mcp" 的按鈕標籤');
    assert.strictEqual(match[1], UNIFIED_LABEL);
  });

  console.log(`\n[mcp-label] ${failed === 0 ? '全部通過' : `${failed} 項失敗`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
