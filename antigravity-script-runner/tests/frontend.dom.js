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

// ===========================================================================
// 影片檢視器：Autoplay 保底靜音下的音量控制語意
//
// 背景（真實症狀：開啟影片預設無聲，按下喇叭鈕想開聲音卻依然無聲）：

//   1. Webview 首次開啟時，瀏覽器會擋「帶聲音的自動播放」，檢視器因此降級為
//      「靜音自動播放」（isAutoplayMutedFallback），並等待使用者的第一次手勢解除。
//   2. 解除動作掛在 document 的「捕捉階段」(pointerdown/keydown)，比按鈕自己的
//      click 更早執行；若 click 讀的是「當下已非靜音」的狀態，就會把「開聲音」
//      誤判為「靜音」→ 按一次等於沒反應（音量被歸 0，圖示與聽感都不變）。
//   3. 保底靜音是「播放器的權宜狀態」，不是「使用者的選擇」；若被寫進持久化狀態
//      （muted:true），之後每次開檔都會預設無聲。
//   4. 滾輪調音量（window wheel）不在首次手勢清單內，必須靠「主動調音量」結束保底靜音。
// ===========================================================================
/** 開啟影片檢視器，並讓第一次 play() 以 NotAllowedError 失敗（模擬 Webview 的 Autoplay 限制） */
function vidWithAutoplayBlock(opts) {
  const c = boot('video-viewer');
  const videoEl = c.getEl('playerVideo');
  let playCalls = 0;
  videoEl.play = () => {
    playCalls++;
    if (playCalls === 1) {
      const err = new Error("play() failed because the user didn't interact with the document first.");
      err.name = 'NotAllowedError';
      return Promise.reject(err);
    }
    return Promise.resolve();
  };

  const list = makeList(FOLDER, VID_NAMES);
  const target = list[opts.targetIndex === undefined ? 1 : opts.targetIndex];
  c.fireMessage({
    type: 'initData',
    folderPath: FOLDER,
    folderName: FOLDER_NAME,
    isCustomEditor: !!opts.isCustomEditor,
    targetFilePath: target.fullPath,
    videos: list,
    thumbSize: 140,
    volume: 0.35,
    muted: false,
    lastVolume: 0.35
  });
  c.posted.length = 0;
  return { c, videoEl, target: target.fullPath };
}

/** 使用者在畫面上按下某處（保底靜音的解除就發生在這一刻的捕捉階段） */
const pressOn = (c, el) => c.fireDocument('pointerdown', {
  type: 'pointerdown', target: el, clientX: 0, clientY: 0,
  preventDefault() {}, stopPropagation() {}
});
/** 等待 play() 的 Promise 鏈與 saveVolume 去抖完成 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
/** 等待 saveVolumeState 的 200ms 去抖真正送出訊息 */
const settleSaved = () => new Promise((resolve) => setTimeout(resolve, 280));
const sliderVal = (c) => parseFloat(c.getEl('volumeSlider').value);
const lastVolumePost = (c) => [...c.posted].reverse().find((m) => m && m.type === 'saveVolume') || null;

async function runVideoAutoplayFallbackTests() {
  console.log('\n=== 影片檢視器：Autoplay 保底靜音下的音量語意 ===');
  {
    const { c, videoEl } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    ok(videoEl.muted === true, '前提：Autoplay 被擋時以「靜音自動播放」保底（畫面先動起來）');
  }
  {
    const { c, videoEl } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    pressOn(c, c.getEl('volumeBtn'));
    c.getEl('volumeBtn').click();
    await settle();
    ok(videoEl.muted === false && sliderVal(c) > 0,
      '保底靜音時按喇叭鈕 → 開啟聲音（修正前會被同一次手勢誤判為「靜音」，音量歸 0 而無聲）');
  }
  {
    const { c, videoEl } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    pressOn(c, c.getEl('volumeSlider'));
    c.getEl('volumeSlider')._fire('input', { target: { value: '0.6' } });
    await settle();
    ok(videoEl.muted === false && sliderVal(c) === 0.6, '保底靜音時拖曳音量滑桿 → 依設定值出聲');
  }
  {
    const { c, videoEl } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    c.fireWindow('wheel', { deltaY: -100, preventDefault() {}, ctrlKey: false, metaKey: false });
    await settle();
    ok(videoEl.muted === false && sliderVal(c) > 0.35,
      '保底靜音時以滾輪調音量 → 出聲（滾輪不在首次手勢清單內，修正前保底靜音不會被解除）');
  }
  {
    const { c } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    c.posted.length = 0;
    c.getEl('sortSelect')._fire('change', { target: { value: 'size-desc' } });
    await settle();
    const post = lastVolumePost(c);
    ok(post && post.muted === false,
      '只改排序不會把「保底靜音」寫成使用者靜音（修正前會污染持久化狀態，之後每次開檔都預設無聲）');
  }
  {
    const { c, videoEl } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    pressOn(c, c.getEl('volumeBtn'));
    c.getEl('volumeBtn').click(); // 第一次：使用者要開聲音
    await settle();
    ok(videoEl.muted === false, '前置：保底靜音後按一次喇叭鈕確實出聲');
    c.posted.length = 0;
    pressOn(c, c.getEl('volumeBtn'));
    c.getEl('volumeBtn').click(); // 第二次：使用者主動靜音
    await settleSaved();
    const post = lastVolumePost(c);
    ok(videoEl.muted === true && sliderVal(c) === 0 && !!post && post.muted === true,
      '使用者主動靜音才會持久化 muted:true（意圖與保底狀態必須可區分）');
  }
}

// ===========================================================================
// 音訊相容模式（IDE 內建 Chromium 缺 AAC 等專利解碼器：上游 microsoft/vscode#167685）
//
// 為什麼要測：這是讓「AAC 影片／音檔」在 IDE 內真的發出聲音的唯一路徑
//   （症狀：畫面正常、零音訊位元組、不報錯，怎麼調音量都沒用）。
// 風險點：偵測條件若不嚴謹（把已正常解碼、或處於靜音狀態的檔案也判為需要轉檔），
//   會造成無謂的 ffmpeg 轉檔（CPU／磁碟浪費），因此兩個方向都要固定下來。
// ===========================================================================
/** 等待相容偵測的 1.5s 計時器 */
const settleCompat = () => new Promise((resolve) => setTimeout(resolve, 1700));

/** 開啟影片檢視器（未觸發 Autoplay 保底，音量正常） */
function openVideoForCompat() {
  const c = boot('video-viewer');
  const videoEl = c.getEl('playerVideo');
  const list = makeList(FOLDER, VID_NAMES);
  c.fireMessage({
    type: 'initData', folderPath: FOLDER, folderName: FOLDER_NAME,
    isCustomEditor: true, targetFilePath: list[0].fullPath, videos: list,
    thumbSize: 140, volume: 0.5, muted: false, lastVolume: 0.5
  });
  videoEl.paused = false;
  return { c, videoEl, target: list[0].fullPath };
}

/** 開啟音訊檢視器並讓播放列處於播放中 */
function openAudioForCompat() {
  const c = boot('audio-viewer');
  const audioEl = c.getEl('playerAudio');
  const list = makeList(FOLDER, AUD_NAMES);
  c.fireMessage({
    type: 'initData', folderPath: FOLDER, folderName: FOLDER_NAME,
    isCustomEditor: true, targetFilePath: list[0].fullPath, audios: list,
    cardSize: 140, volume: 1, muted: false, lastVolume: 1
  });
  audioEl.paused = false;
  return { c, audioEl, target: list[0].fullPath };
}

async function runAudioCompatTests() {
  console.log('\n=== 音訊相容模式：開檔即以 ffprobe 判定播放規則 ===');
  {
    const { c, target } = openVideoForCompat();
    const probe = c.posted.find((m) => m && m.type === 'probeAudioCompat');
    ok(!!probe && probe.filePath === target,
      '影片一開檔就送出 probeAudioCompat（帶出檔案路徑）→ 依實際音軌編碼決定播放規則，不必等播放後才偵測（舊版必須手動暫停再播放才會觸發）');
  }
  {
    const { c, videoEl } = openVideoForCompat();
    c.posted.length = 0;
    c.fireMessage({ type: 'audioCompatDetected', filePath: 'x.mp4', codec: 'aac' });
    videoEl.webkitAudioDecodedByteCount = 0;
    videoEl._fire('playing');
    await settleCompat();
    ok(!c.posted.some((m) => m && m.type === 'probeAudioCompat' && m.force),
      '後端已判定需要相容（audioCompatDetected）→ 不再重複請求轉檔，避免同一檔案被轉兩次');
  }
  {
    const { c, videoEl, target } = openVideoForCompat();
    videoEl.webkitAudioDecodedByteCount = 0;
    videoEl.currentTime = 12.5;
    c.fireMessage({ type: 'audioCompatReady', filePath: target, uri: 'http://127.0.0.1:9/video?compat=1' });
    ok(videoEl.src === 'http://127.0.0.1:9/video?compat=1' && videoEl.currentTime === 12.5,
      '收到 audioCompatReady → 換用相容串流並保留播放位置（不在第 0 秒重播）');
  }
  {
    const { c, videoEl } = openVideoForCompat();
    c.posted.length = 0;
    c.fireMessage({ type: 'audioCompatNotNeeded', filePath: 'x.mp4', codec: 'mp3' });
    videoEl.webkitAudioDecodedByteCount = 0;
    videoEl._fire('playing');
    await settleCompat();
    ok(!c.posted.some((m) => m && m.type === 'probeAudioCompat' && m.force),
      '後端判定編碼可解碼（audioCompatNotNeeded）→ 即使零解碼位元組也不轉檔（避免無謂的 ffmpeg 消耗）');
  }
  {
    const { c, videoEl, target } = openVideoForCompat();
    c.posted.length = 0;
    c.fireMessage({ type: 'audioCompatUnavailable', filePath: target });
    videoEl.webkitAudioDecodedByteCount = 0;
    videoEl._fire('playing');
    await settleCompat();
    ok(c.posted.some((m) => m && m.type === 'probeAudioCompat' && m.force === true && m.filePath === target),
      '後端無 ffprobe（audioCompatUnavailable）→ 啟用啟發式：零解碼位元組時以 force 請求轉檔');
  }
  {
    const { c, videoEl, target } = openVideoForCompat();
    c.fireMessage({ type: 'audioCompatUnavailable', filePath: target });
    c.posted.length = 0;
    videoEl.muted = true; // 模擬 Autoplay 保底靜音（此時本來就不會發聲）
    videoEl.webkitAudioDecodedByteCount = 0;
    videoEl._fire('playing');
    await settleCompat();
    const requestedWhileMuted = c.posted.some((m) => m && m.type === 'probeAudioCompat' && m.force);
    videoEl.muted = false; // 使用者點一下解除靜音
    videoEl._fire('volumechange');
    await settleCompat();
    ok(!requestedWhileMuted && c.posted.some((m) => m && m.type === 'probeAudioCompat' && m.force === true),
      '保底靜音期間不誤判、解除靜音後立即觸發轉檔（舊版必須手動暫停再播放才會觸發，此即本次優化重點）');
  }
  {
    const { c, audioEl, target } = openAudioForCompat();
    const probe = c.posted.find((m) => m && m.type === 'probeAudioCompat');
    ok(!!probe && probe.filePath === target, '音訊檢視器同樣在開始播放時就送出 probeAudioCompat');
    audioEl.currentTime = 7.5;
    c.fireMessage({ type: 'audioCompatReady', filePath: target, uri: 'http://127.0.0.1:9/audio?compat=1' });
    ok(audioEl.src === 'http://127.0.0.1:9/audio?compat=1' && audioEl.currentTime === 7.5,
      '音訊收到 audioCompatReady → 換用 MP3 相容串流並保留播放位置');
  }

  console.log('\n=== 音訊相容模式：提示整合（同一流程只留一則）===');
  const visibleToasts = (c) => c.created.filter((el) => typeof el.className === 'string'
    && el.className.startsWith('toast toast-') && !el._removed);
  {
    const { c } = openVideoForCompat();
    c.created.length = 0;
    c.fireMessage({ type: 'audioCompatDetected', filePath: 'x.mp4', codec: 'aac' });
    const pending = visibleToasts(c);
    ok(pending.length === 1,
      `建立相容音軌期間只顯示一則提示（實際 ${pending.length} 則；修正前會與其他提示疊成三則）`);

    c.fireMessage({ type: 'audioCompatReady', filePath: 'x.mp4', uri: 'http://127.0.0.1:9/video?compat=1' });
    const after = visibleToasts(c);
    ok(after.length === 1 && after[0] === pending[0], '轉檔完成時「就地更新同一則提示」，不會再多彈一則');
  }
  {
    // 先讓 Autoplay 保底提示出現，再進入相容流程 → 應合併為一則（只留最重要的）
    const { c } = vidWithAutoplayBlock({ isCustomEditor: true });
    await settle();
    const hintCount = visibleToasts(c).length;
    c.fireMessage({ type: 'audioCompatDetected', filePath: 'x.mp4', codec: 'aac' });
    const merged = visibleToasts(c);
    ok(hintCount === 1 && merged.length === 1 && merged[0].innerHTML.includes('ffmpeg'),
      '進入相容流程時收掉先前的 Autoplay 提示並合併成一則（使用者實測回饋：不要一次彈三則）');
  }
  {
    const { c } = openVideoForCompat();
    c.created.length = 0;
    c.fireMessage({ type: 'audioCompatReady', filePath: 'x.mp4', uri: 'http://127.0.0.1:9/video?compat=1', cached: true });
    ok(visibleToasts(c).length === 0, '快取命中（瞬間完成）→ 完全不顯示提示，避免無謂干擾');
  }
}

runVideoAutoplayFallbackTests()
  .then(runAudioCompatTests)
  .then(() => {
    console.log('\n---------------------------------------------');
    console.log((failed === 0 ? 'FRONTEND-ALL-ASSERTIONS-PASSED' : 'FRONTEND-TEST-FAILED')
      + '  (checked=' + checked + ', failed=' + failed + ')');
    process.exitCode = failed === 0 ? 0 : 1;
  });

