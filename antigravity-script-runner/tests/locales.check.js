/**
 * 語系字典一致性檢查
 *
 * 檢查項目：
 *   1. 每個 viewer 的 zh-TW / en 鍵集合完全對稱（無缺漏、無多餘）
 *   2. 無空字串值（避免介面出現空白標籤）
 *   3. 程式碼與 HTML 實際引用的 i18n 鍵，皆存在於兩個語系
 *
 * 用法：node tests/locales.check.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MEDIA_DIR = path.join(__dirname, '..', 'media');
const VIEWERS = ['image-viewer', 'video-viewer', 'audio-viewer'];

/** 載入 locales.js 並取出其對外暴露的字典（各 viewer 變數名稱不同，故自動偵測） */
function loadLocales(viewerDir) {
  const src = fs.readFileSync(path.join(MEDIA_DIR, viewerDir, 'locales.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: viewerDir + '/locales.js' });
  const found = Object.keys(sandbox)
    .map((k) => sandbox[k])
    .find((v) => v && typeof v === 'object' && v['zh-TW'] && v['en']);
  if (!found) throw new Error(viewerDir + '：找不到 locales 字典（zh-TW / en）');
  return found;
}

/** 收集 viewer.js 與 index.html 中實際引用的 i18n 鍵 */
function collectUsedKeys(viewerDir) {
  const viewerSrc = fs.readFileSync(path.join(MEDIA_DIR, viewerDir, 'viewer.js'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(MEDIA_DIR, viewerDir, 'index.html'), 'utf8');
  const used = new Set();
  const attrRe = /data-i18n(?:-title|-placeholder|-aria)?="([A-Za-z0-9_]+)"/g;
  for (const m of viewerSrc.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of viewerSrc.matchAll(attrRe)) used.add(m[1]);
  for (const m of htmlSrc.matchAll(attrRe)) used.add(m[1]);
  return used;
}

let failed = 0;
for (const viewerDir of VIEWERS) {
  const locales = loadLocales(viewerDir);
  const zhKeys = Object.keys(locales['zh-TW']).sort();
  const enKeys = Object.keys(locales['en']).sort();
  const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
  const extraInEn = enKeys.filter((k) => !zhKeys.includes(k));
  const emptyKeys = ['zh-TW', 'en'].flatMap((lang) =>
    Object.entries(locales[lang]).filter(([, v]) => !String(v).trim()).map(([k]) => lang + ':' + k));

  const used = collectUsedKeys(viewerDir);
  const unknownKeys = [...used]
    .filter((k) => !(k in locales['zh-TW']) || !(k in locales['en']))
    .sort();

  const syncOk = Object.keys(locales).length === 2
    && !missingInEn.length && !extraInEn.length && !emptyKeys.length;
  const refOk = unknownKeys.length === 0;
  const pass = syncOk && refOk;
  if (!pass) failed++;

  console.log(`${pass ? 'PASS' : 'FAIL'}  ${viewerDir}`
    + ` | zh-TW=${zhKeys.length} en=${enKeys.length}`
    + ` | missing_in_en=${JSON.stringify(missingInEn)}`
    + ` | extra_in_en=${JSON.stringify(extraInEn)}`
    + ` | empty=${JSON.stringify(emptyKeys)}`
    + ` | 程式碼引用未知鍵=${JSON.stringify(unknownKeys)}`);
}

console.log(failed === 0 ? 'LOCALE-CHECK-PASSED' : `LOCALE-CHECK-FAILED (${failed} viewer)`);
process.exitCode = failed === 0 ? 0 : 1;
