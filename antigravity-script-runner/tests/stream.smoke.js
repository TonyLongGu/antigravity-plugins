/**
 * 串流伺服器 HTTP 語意驗證（Range / 206 / 白名單 / Token）
 *
 * 為什麼要測這個：影片與音訊都由本機 HTTP 伺服器以 206 切片供檔，
 * 播放器（Chromium）能否正確解讀 moov、能否 seek，全取決於這裡的標頭正確性。
 * 曾有一個真實缺陷：`Range: bytes=-N`（取檔案尾端 N 個位元組）被誤實作為 `0-N`，
 * 會讓播放器讀到錯誤區段（部分容器如 moov 在尾端的檔案會直接播放失敗）。
 *
 * 用法：node tests/stream.smoke.js（或 npm test 一併執行）
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { videoStreamServer } = require('../services/videoStreamServer.js');
const { audioStreamServer } = require('../services/audioStreamServer.js');

let checked = 0;
let failed = 0;
const ok = (cond, label) => {
  checked++;
  if (cond) console.log('  PASS  ' + label);
  else { failed++; console.log('  FAIL  ' + label); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'script-runner-stream-'));
const SMALL = path.join(TMP, 'fixture.wav');
const BIG = path.join(TMP, 'fixture.mp4');
const NOT_ALLOWED = path.join(TMP, 'fixture.txt');
const SMALL_SIZE = 64 * 1024;
const BIG_SIZE = 5 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;

fs.writeFileSync(SMALL, Buffer.alloc(SMALL_SIZE, 0x41));
fs.writeFileSync(BIG, Buffer.alloc(BIG_SIZE, 0x42));
fs.writeFileSync(NOT_ALLOWED, 'not media');

/** 送出一個 HTTP 請求並回傳狀態、Content-Range、Content-Length、Content-Type */
function request(url, { method = 'GET', range = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, method,
      path: u.pathname + u.search,
      headers: range ? { Range: range } : {}
    }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({
        status: res.statusCode,
        contentRange: res.headers['content-range'] || '',
        length: res.headers['content-length'] || '',
        type: res.headers['content-type'] || '',
        bodyBytes: bytes
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const videoPort = await videoStreamServer.ensureServer();
  const audioPort = await audioStreamServer.ensureServer();
  const videoBase = `http://127.0.0.1:${videoPort}/video?token=${videoStreamServer.sessionToken}&path=`;
  const audioBase = `http://127.0.0.1:${audioPort}/audio?token=${audioStreamServer.sessionToken}&path=`;

  console.log('\n=== 音訊串流（小檔、支援 suffix range）===');
  const wav = audioBase + encodeURIComponent(SMALL);
  {
    const r = await request(wav, { range: 'bytes=0-1023' });
    ok(r.status === 206 && r.contentRange === `bytes 0-1023/${SMALL_SIZE}` && r.length === '1024',
      `前段切片：bytes=0-1023 → 206 ${r.contentRange}（實得 ${r.status} ${r.contentRange} CL=${r.length}）`);
  }
  {
    const r = await request(wav, { range: 'bytes=-1000' });
    ok(r.status === 206 && r.contentRange === `bytes ${SMALL_SIZE - 1000}-${SMALL_SIZE - 1}/${SMALL_SIZE}` && r.length === '1000',
      `尾端切片：bytes=-1000 必須回傳最後 1000 位元組（修正前會回 0-1000，導致播放器讀錯區段）`);
  }
  {
    const r = await request(wav, { range: 'bytes=1000-' });
    ok(r.status === 206 && r.contentRange === `bytes 1000-${SMALL_SIZE - 1}/${SMALL_SIZE}` && r.length === String(SMALL_SIZE - 1000),
      '開放式切片：bytes=1000- → 206 至檔尾');
  }
  {
    const r = await request(wav);
    ok(r.status === 200 && r.length === String(SMALL_SIZE) && r.type === 'audio/wav',
      '無 Range 的小檔：200 全檔輸出且 Content-Type 正確');
  }
  {
    const r = await request(wav, { method: 'HEAD' });
    ok(r.status === 200 && r.length === String(SMALL_SIZE) && r.bodyBytes === 0,
      'HEAD 探測：回 200 且帶 Content-Length、無 body');
  }
  {
    const r = await request(wav, { range: 'bytes=9999999-' });
    ok(r.status === 416 && r.contentRange === `bytes */${SMALL_SIZE}`,
      '超出範圍：start 大於檔案 → 416 並附 Content-Range: bytes */size');
  }
  {
    const r = await request(`http://127.0.0.1:${audioPort}/audio?token=deadbeef&path=${encodeURIComponent(SMALL)}`);
    ok(r.status === 403, 'Token 錯誤 → 403（避免本機任何網頁都能讀檔）');
  }
  console.log('\n=== 影片串流（大檔、4MB 分塊上限）===');
  const mp4 = videoBase + encodeURIComponent(BIG);
  {
    const r = await request(mp4, { range: 'bytes=0-1023' });
    ok(r.status === 206 && r.contentRange === `bytes 0-1023/${BIG_SIZE}` && r.type === 'video/mp4',
      '前段切片：206 且 Content-Type=video/mp4');
  }
  {
    const r = await request(mp4, { range: 'bytes=-1000' });
    ok(r.status === 206 && r.contentRange === `bytes ${BIG_SIZE - 1000}-${BIG_SIZE - 1}/${BIG_SIZE}`,
      '尾端切片：bytes=-1000 → 最後 1000 位元組（moov 在尾端的檔案靠這個才能播放）');
  }
  {
    const r = await request(mp4, { range: `bytes=${BIG_SIZE - 1000}-` });
    ok(r.status === 206 && r.contentRange === `bytes ${BIG_SIZE - 1000}-${BIG_SIZE - 1}/${BIG_SIZE}`,
      '開放式切片：起點在尾端時正確收斂到檔尾');
  }
  {
    const r = await request(mp4, { range: 'bytes=4200000-' });
    const expectedEnd = Math.min(BIG_SIZE - 1, 4200000 + CHUNK - 1);
    ok(r.status === 206 && r.contentRange === `bytes 4200000-${expectedEnd}/${BIG_SIZE}` && r.length === String(expectedEnd - 4200000 + 1),
      `大檔分塊上限：單次回應不超過 4MB（避免 2GB 影片灌爆連線池）`);
  }
  {
    const r = await request(mp4);
    ok(r.status === 206 && r.contentRange === `bytes 0-${CHUNK - 1}/${BIG_SIZE}` && r.length === String(CHUNK),
      '大檔無 Range 請求：僅回第一段 4MB（不灌入全檔）');
  }
  {
    const r = await request(`http://127.0.0.1:${videoPort}/video?token=nope&path=${encodeURIComponent(BIG)}`);
    ok(r.status === 403, '影片伺服器 Token 錯誤 → 403');
  }

  console.log('\n---------------------------------------------');
  console.log((failed === 0 ? 'STREAM-ALL-ASSERTIONS-PASSED' : 'STREAM-TEST-FAILED')
    + '  (checked=' + checked + ', failed=' + failed + ')');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  videoStreamServer.dispose();
  audioStreamServer.dispose();
  process.exitCode = failed === 0 ? 0 : 1;
})().catch((err) => {
  console.error('STREAM-TEST-CRASHED', err);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  videoStreamServer.dispose();
  audioStreamServer.dispose();
  process.exitCode = 1;
});
