/**
 * 前端互動語意驗證（DOM 模擬，無需 VS Code）
 *
 * 驗證重點：三個多媒體檢視器的「分頁角色 × 使用者操作」語意
 *   - 檔案分頁（自訂編輯器，標題為檔名）：退出放大檢視 → 轉入父層資料夾畫廊分頁
 *   - 畫廊分頁（右鍵命令開啟，標題為資料夾名）：僅退出放大檢視，留在畫廊
 *
 * 為什麼要測「送出什麼訊息」而不是測畫面：分頁轉換由後端決定，
 * 前端唯一職責是「在對的情境送出對的訊息」，這正是最容易寫錯且無法肉眼驗證的部分。
 *
 * 用法：node tests/frontend.dom.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createContext } = require('./dom-stub.js');

const MEDIA_DIR = path.join(__dirname, '..', 'media');
/** 合成路徑（只用於字串比對，不會碰觸磁碟；避免綁定任何真實機器路徑） */
const FOLDER = 'C:/fixture/gallery-folder';
const FOLDER_NAME = path.basename(FOLDER);

let failed = 0;
let checked = 0;
const ok = (cond, label) => {
  checked++;
  if (cond) console.log('  PASS  ' + label);
  else { failed++; console.log('  FAIL  ' + label); }
};

const KEY_ESC = {
  key: 'Escape', code: 'Escape',
  preventDefault() {}, stopPropagation() {},
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false
};
const lastPost = (c) => (c.posted.length ? c.posted[c.posted.length - 1] : null);
const countPost = (c, type) => c.posted.filter((m) => m && m.type === type).length;

/** 在 vm 中載入指定 viewer 的 locales.js + viewer.js */
function boot(viewerDir) {
  const c = createContext();
  const src = [
    fs.readFileSync(path.join(MEDIA_DIR, viewerDir, 'locales.js'), 'utf8'),
    fs.readFileSync(path.join(MEDIA_DIR, viewerDir, 'viewer.js'), 'utf8')
  ].join('\n;\n');
  vm.runInContext(src, c.context, { filename: viewerDir + '/viewer.js' });
  c.fireDocument('DOMContentLoaded');
  return c;
}

/** 產生假的媒體檔案清單 */
const makeList = (dir, names) => names.map((n, i) => ({
  fullPath: dir + '/' + n,
  fileName: n,
  ext: n.split('.').pop(),
  size: 1000 + i * 100,
  sizeFormatted: (1000 + i * 100) + ' B',
  mtime: 1700000000000 + i * 1000,
  mtimeFormatted: '2024-01-0' + (i + 1) + ' 12:00',
  width: 1920,
  height: 1080,
  duration: 30 + i,
  durationFormatted: '00:3' + i
}));

const IMG_NAMES = ['a.jpg', 'b.png', 'c.gif'];
const VID_NAMES = ['a.mp4', 'b.mkv', 'c.webm'];
const AUD_NAMES = ['a.mp3', 'b.wav', 'c.flac'];

/**
 * 開啟一個檢視器情境
 * @param {'image-viewer'|'video-viewer'|'audio-viewer'} viewerDir
 * @param {object} opts
 */
function open(viewerDir, opts) {
  const c = boot(viewerDir);
  const names = opts.names;
  const list = makeList(FOLDER, names);
  const target = list[opts.targetIndex === undefined ? 1 : opts.targetIndex];
  const payload = {
    type: 'initData',
    folderPath: FOLDER,
    folderName: FOLDER_NAME,
    isCustomEditor: !!opts.isCustomEditor,
    targetFilePath: opts.useReveal ? null : target.fullPath,
    revealFilePath: opts.useReveal ? target.fullPath : null,
    selectFilePath: opts.useReveal ? target.fullPath : null
  };
  payload[opts.key] = list;
  payload.thumbSize = 140;
  c.fireMessage(payload);
  c.posted.length = 0;
  return { c, target: target.fullPath, list };
}

// ===========================================================================
// 圖片檢視器
// ===========================================================================
const img = (opts) => open('image-viewer', Object.assign({ names: IMG_NAMES, key: 'images' }, opts));

console.log('\n=== 圖片檢視器：檔案分頁（自訂編輯器）退出 → 轉入父層資料夾畫廊 ===');
{
  const { c, target } = img({ isCustomEditor: true });
  ok(c.getEl('lightboxModal').classList.contains('active'), '開檔後自動進入放大檢視');
  ok(c.getEl('expandGalleryBtn').style.display !== 'none', '檔案分頁顯示「展開為資料夾畫廊」按鈕');
  c.fireWindow('keydown', KEY_ESC);
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', 'Esc → 送出 expandToFolderGallery（轉入父層資料夾畫廊）');
  ok(lastPost(c) && lastPost(c).filePath === target, '轉入畫廊時帶出目標檔路徑（畫廊可定位該檔）');
  ok(countPost(c, 'closeCustomEditor') === 0, 'Esc 不再直接關閉分頁（原行為已改）');
}
{
  const { c, target } = img({ isCustomEditor: true });
  c.getEl('lightboxModal')._fire('contextmenu', { preventDefault() {}, stopPropagation() {} });
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', '右鍵退回 → 送出 expandToFolderGallery');
  ok(lastPost(c) && lastPost(c).filePath === target, '右鍵退回帶出目標檔路徑');
  ok(countPost(c, 'closeCustomEditor') === 0, '右鍵退回不再直接關閉分頁');
}
{
  const { c, target } = img({ isCustomEditor: true });
  c.getEl('lightboxCloseBtn')._fire('click');
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', '關閉鈕 (✕) → 送出 expandToFolderGallery');
  ok(lastPost(c) && lastPost(c).filePath === target, '關閉鈕帶出目標檔路徑');
}
{
  const { c, target } = img({ isCustomEditor: true });
  c.fireWindow('keydown', Object.assign({}, KEY_ESC, { key: 'g', code: 'KeyG' }));
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', 'G 快捷鍵 → 送出 expandToFolderGallery');
  ok(lastPost(c) && lastPost(c).filePath === target, 'G 快捷鍵帶出目標檔路徑');
}
{
  const { c } = img({ isCustomEditor: true });
  c.getEl('expandGalleryBtn')._fire('click');
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery' && lastPost(c).selectFile === false, '工具列「展開為資料夾畫廊」按鈕可用');
}
{
  const { c } = img({ isCustomEditor: true });
  c.getEl('selectAndCloseBtn')._fire('click');
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery' && lastPost(c).selectFile === true, '「選取並關閉」轉入畫廊並要求選取該檔');
}

console.log('\n=== 圖片檢視器：資料夾畫廊分頁維持原行為 ===');
{
  const { c, target } = img({ isCustomEditor: false });
  ok(c.getEl('expandGalleryBtn').style.display === 'none', '畫廊分頁不顯示「展開為資料夾畫廊」按鈕');
  c.fireWindow('keydown', KEY_ESC);
  ok(!c.getEl('lightboxModal').classList.contains('active'), '畫廊分頁 Esc 僅關閉放大檢視（留在畫廊）');
  ok(c.posted.length === 0, '畫廊分頁 Esc 不送出任何分頁轉換／關閉訊息');
  c.fireMessage({ type: 'revealInGallery', filePath: target, select: true });
  ok(!c.getEl('lightboxModal').classList.contains('active'), 'revealInGallery 僅定位，不開啟放大檢視');
  ok(c.posted.length === 0, 'revealInGallery 不觸發分頁轉換');
}
{
  const { c } = img({ isCustomEditor: false, useReveal: true });
  ok(!c.getEl('lightboxModal').classList.contains('active'), '由檔案分頁轉入畫廊（revealFilePath）：呈現父層資料夾全部檔案，不自動放大');
  ok(c.posted.length === 0, '轉入畫廊後未殘留分頁關閉訊息');
}

// ===========================================================================
// 影片檢視器
// ===========================================================================
const vid = (opts) => open('video-viewer', Object.assign({ names: VID_NAMES, key: 'videos' }, opts));
const playerCtxMenu = (c) => c.fireDocument('contextmenu', {
  target: { tagName: 'DIV', closest: () => null },
  preventDefault() {}, stopPropagation() {}
});

console.log('\n=== 影片檢視器：檔案分頁（自訂編輯器）退出 → 轉入父層資料夾畫廊 ===');
{
  const { c, target } = vid({ isCustomEditor: true });
  ok(c.getEl('playerModal').classList.contains('active'), '開檔後自動進入播放器');
  ok(c.getEl('expandGalleryBtn').style.display !== 'none', '檔案分頁顯示「展開為資料夾畫廊」按鈕');
  c.fireWindow('keydown', KEY_ESC);
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', 'Esc → 送出 expandToFolderGallery（轉入父層資料夾畫廊）');
  ok(lastPost(c) && lastPost(c).filePath === target, '轉入畫廊時帶出目標檔路徑');
  ok(countPost(c, 'closeCustomEditor') === 0, 'Esc 不再直接關閉分頁（原行為已改）');
}
{
  // 影片檢視器的右鍵退出掛在 document 上（非 modal 本身）
  const { c, target } = vid({ isCustomEditor: true });
  playerCtxMenu(c);
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', '右鍵退回 → 送出 expandToFolderGallery');
  ok(lastPost(c) && lastPost(c).filePath === target, '右鍵退回帶出目標檔路徑');
}
{
  const { c } = vid({ isCustomEditor: true });
  c.getEl('playerCloseBtn')._fire('click');
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', '關閉鈕 (✕) → 送出 expandToFolderGallery');
}
{
  const { c } = vid({ isCustomEditor: true });
  c.fireWindow('keydown', Object.assign({}, KEY_ESC, { key: 'g', code: 'KeyG' }));
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', 'G 快捷鍵 → 送出 expandToFolderGallery');
}
{
  const { c } = vid({ isCustomEditor: true });
  c.getEl('expandGalleryBtn')._fire('click');
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery' && lastPost(c).selectFile === false, '工具列「轉入畫廊分頁」按鈕可用');
}

console.log('\n=== 影片檢視器：資料夾畫廊分頁維持原行為 ===');
{
  const { c, target } = vid({ isCustomEditor: false });
  ok(c.getEl('expandGalleryBtn').style.display === 'none', '畫廊分頁不顯示「展開為資料夾畫廊」按鈕');
  c.fireWindow('keydown', KEY_ESC);
  ok(!c.getEl('playerModal').classList.contains('active'), '畫廊分頁 Esc 僅關閉播放器（留在畫廊）');
  ok(c.posted.length === 0, '畫廊分頁 Esc 不送出任何分頁轉換／關閉訊息');
  c.fireMessage({ type: 'revealInGallery', filePath: target, select: true });
  ok(!c.getEl('playerModal').classList.contains('active'), 'revealInGallery 僅定位，不開啟播放器');
}
{
  const { c } = vid({ isCustomEditor: false, useReveal: true });
  ok(!c.getEl('playerModal').classList.contains('active'), '由檔案分頁轉入畫廊（revealFilePath）：呈現父層資料夾全部檔案，不自動播放');
}


// ===========================================================================
// 音訊檢視器
// ===========================================================================
const aud = (opts) => open('audio-viewer', Object.assign({ names: AUD_NAMES, key: 'audios' }, opts));
/** 音訊檢視器的右鍵退出掛在 document 上，且需目標位於底部播放列內 */
const barCtxMenu = (c) => c.fireDocument('contextmenu', {
  target: { tagName: 'DIV', closest: () => ({}) },
  preventDefault() {}, stopPropagation() {}
});
const barShown = (c) => c.getEl('dockedPlayerBar').style.display !== 'none';
const playingTitle = (c) => c.getEl('playerTitle').textContent;

console.log('\n=== 音訊檢視器：檔案分頁（自訂編輯器）退出 → 轉入父層資料夾畫廊 ===');
{
  const { c, target } = aud({ isCustomEditor: true });
  ok(barShown(c), '開檔後自動開啟底部播放列');
  ok(c.getEl('expandGalleryBtn').style.display !== 'none', '檔案分頁顯示「展開為資料夾畫廊」按鈕');
  c.fireWindow('keydown', KEY_ESC);
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', 'Esc → 送出 expandToFolderGallery（轉入父層資料夾畫廊）');
  ok(lastPost(c) && lastPost(c).filePath === target, '轉入畫廊時帶出目標檔路徑');
  ok(countPost(c, 'closeCustomEditor') === 0, 'Esc 不再直接關閉分頁（原行為已改）');
}
{
  const { c, target } = aud({ isCustomEditor: true });
  barCtxMenu(c);
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', '播放列右鍵退回 → 送出 expandToFolderGallery');
  ok(lastPost(c) && lastPost(c).filePath === target, '播放列右鍵退回帶出目標檔路徑');
}
{
  const { c } = aud({ isCustomEditor: true });
  c.fireWindow('keydown', Object.assign({}, KEY_ESC, { key: 'g', code: 'KeyG' }));
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', 'G 快捷鍵 → 送出 expandToFolderGallery');
}
{
  const { c } = aud({ isCustomEditor: true });
  c.getEl('expandGalleryBtn')._fire('click');
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery' && lastPost(c).selectFile === false, '工具列「展開為資料夾畫廊」按鈕可用');
}

console.log('\n=== 音訊檢視器：資料夾畫廊分頁維持原行為 ===');
{
  const { c, target } = aud({ isCustomEditor: false });
  ok(c.getEl('expandGalleryBtn').style.display === 'none', '畫廊分頁不顯示「展開為資料夾畫廊」按鈕');
  c.fireWindow('keydown', KEY_ESC);
  ok(c.posted.length === 0, '畫廊分頁 Esc 不送出任何分頁轉換／關閉訊息');
  c.fireMessage({ type: 'revealInGallery', filePath: target, select: true });
  ok(c.posted.length === 0, 'revealInGallery 不觸發分頁轉換');
}
{
  const { c } = aud({ isCustomEditor: false, useReveal: true });
  ok(c.posted.length === 0, '由檔案分頁轉入畫廊（revealFilePath）：呈現父層資料夾全部檔案，未殘留分頁關閉訊息');
}


// ===========================================================================
// 音訊檢視器：刪除播放中檔案 + Esc 優先序（此段曾抓出真實缺陷，勿刪）
//
// 背景：playTrack() 內建「同曲→切換暫停」與「同曲→續播」兩條早退分支。
//       刪檔後 currentIndex 仍指向同一格，若未先重設，改播下一首會被誤判為
//       「點同一首」而只做暫停 → 播放列停在已刪除的檔案上（已修正）。
//       本段以負對照驗證過鑑別力：移除 currentIndex = -1 會使第 1 項失敗。
// ===========================================================================
/** 開啟音訊檢視器並讓 audio 元素呈現「播放中」（貼近真實瀏覽器狀態） */
function openAudioPlaying(opts) {
  const r = aud(opts);
  r.c.getEl('playerAudio').paused = false;
  r.c.posted.length = 0;
  return r;
}
const selectAt = (c, list, idx) => c.fireMessage({ type: 'revealInGallery', filePath: list[idx].fullPath, select: true });

console.log('\n=== 音訊檢視器：Esc 優先序（有選取時） ===');
{
  const { c, list } = openAudioPlaying({ isCustomEditor: false });
  selectAt(c, list, 2);
  c.fireWindow('keydown', KEY_ESC);
  ok(barShown(c) && c.posted.length === 0, '畫廊分頁：Esc 優先取消選取，播放列維持（與圖片/影片一致）');
}
{
  const { c, list } = openAudioPlaying({ isCustomEditor: true });
  selectAt(c, list, 2);
  c.fireWindow('keydown', KEY_ESC);
  ok(lastPost(c) && lastPost(c).type === 'expandToFolderGallery', '檔案分頁：即使有選取，Esc 仍直接退出播放列並轉入畫廊（修正前會被「清選取」卡住）');
}

console.log('\n=== 音訊檢視器：刪除播放中的檔案（畫廊分頁） ===');
{
  const { c, list } = openAudioPlaying({ isCustomEditor: false });
  ok(playingTitle(c) === 'b.wav', '前置：正在播放 b.wav');
  c.fireMessage({ type: 'updateAudios', audios: [list[0], list[2]], isSilent: true });
  ok(barShown(c), '刪除後播放列仍在（不殘留失效狀態）');
  ok(playingTitle(c) === 'c.flac', '自動改播下一首 c.flac（移除 currentIndex = -1 會退回失敗，此即負對照依據）');
  ok(countPost(c, 'closeCustomEditor') === 0, '刪除後不會誤關畫廊分頁');
}
{
  const { c, list } = openAudioPlaying({ isCustomEditor: false, targetIndex: 2 });
  ok(playingTitle(c) === 'c.flac', '前置：正在播放最後一首 c.flac');
  c.fireMessage({ type: 'updateAudios', audios: [list[0], list[1]], isSilent: true });
  ok(barShown(c) && playingTitle(c) === 'b.wav', '刪除最後一首時改播剩餘的最後一首 b.wav（索引收斂正確）');
}
{
  const { c } = openAudioPlaying({ isCustomEditor: false });
  c.fireMessage({ type: 'updateAudios', audios: [], isSilent: true });
  ok(!barShown(c), '刪光所有音訊時自動關閉播放列');
  ok(c.posted.length === 0, '刪光時不送出任何分頁訊息');
}

console.log('\n=== 回歸：刪除檔案分頁所播放的檔案 ===');
{
  const { c, list } = openAudioPlaying({ isCustomEditor: true });
  c.fireMessage({ type: 'updateAudios', audios: [list[0], list[2]], isSilent: true });
  ok(countPost(c, 'closeCustomEditor') === 1, '檔案分頁所播放的檔案被刪除 → 關閉該分頁（維持原行為）');
  ok(countPost(c, 'expandToFolderGallery') === 0, '檔案分頁刪檔不會誤觸畫廊轉換');
}

console.log('\n---------------------------------------------');
console.log((failed === 0 ? 'FRONTEND-ALL-ASSERTIONS-PASSED' : 'FRONTEND-TEST-FAILED')
  + '  (checked=' + checked + ', failed=' + failed + ')');
process.exitCode = failed === 0 ? 0 : 1;

