const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

// ============================================================================
// 音訊相容服務（Audio Compatibility Service）
//
// 背景（上游限制，非本擴充套件可修）：VS Code 系列 IDE（含 Antigravity）內建的
// Chromium/Electron ffmpeg **不含 AAC 等專利編碼解碼器**（microsoft/vscode#167685）。
// 症狀：MP4/MOV 內的 AAC / Opus / AC-3 / E-AC-3 / ALAC 音軌「有畫面、零音訊位元組、
//       不報任何錯誤」，而 PCM(WAV) / MP3 / FLAC / Vorbis 正常。
// 對策：偵測到這類音軌時，用本機 ffmpeg 把**音軌**轉為 MP3（畫面直接 stream copy），
//       產生一份暫存相容檔再交給播放器（原始檔永不修改）。
// ============================================================================

/** IDE 內建 Chromium 實測無法解碼的音軌編碼（其餘如 mp3/flac/vorbis/pcm 皆正常） */
const UNDECODABLE_AUDIO_CODECS = new Set([
  'aac', 'opus', 'ac3', 'eac3', 'alac', 'dts', 'dca', 'truehd', 'mlp'
]);

/** 需要保留畫面的容器（其餘視為純音訊檔，僅輸出 MP3） */
const VIDEO_CONTAINER_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.flv', '.ts', '.ogv', '.wmv']);

/** 相容檔暫存目錄（僅存於系統 temp，擴充套件停用時清除） */
const COMPAT_DIR = path.join(os.tmpdir(), 'antigravity-script-runner-compat');

/** 自動轉檔的檔案大小上限：超過者改建議使用系統播放器（避免產生巨大暫存檔） */
const MAX_AUTO_COMPAT_BYTES = 1500 * 1024 * 1024;

let ffmpegProbePromise = null;

/** 音軌編碼探測快取（path|size|mtime → 判定結果），避免重複呼叫 ffprobe */
const probeCache = new Map();

/** 進行中的轉檔任務（輸出檔路徑 → Promise），避免同一檔案被重複轉檔 */
const inflightTranscodes = new Map();

/** 執行外部命令並回傳輸出（不拋錯版本的安全封裝） */
function run(bin, args, timeout = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
    });
  });
}

/**
 * 檢查本機是否具備 ffmpeg（結果快取）
 * @returns {Promise<boolean>}
 */
async function isFfmpegAvailable() {
  if (!ffmpegProbePromise) {
    ffmpegProbePromise = run('ffmpeg', ['-hide_banner', '-version'], 15000)
      .then((r) => r.ok)
      .catch(() => false);
  }
  return ffmpegProbePromise;
}

/**
 * 以 ffprobe 讀取第一個音軌的編碼。
 * 回傳 ok=true 代表 ffprobe 成功執行（codec=null 表示該檔沒有音軌）；
 * ok=false 代表 ffprobe 不可用或讀取失敗（與「檔案沒有音軌」不同，不可混為一談）。
 * @param {string} filePath
 * @returns {Promise<{ ok: boolean, codec: string|null }>}
 */
async function probeAudioStream(filePath) {
  const r = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ], 30000);
  if (!r.ok) return { ok: false, codec: null };
  const name = r.stdout.trim().split(/\r?\n/)[0].trim().toLowerCase();
  return { ok: true, codec: name || null };
}

/**
 * 以 ffprobe 取得第一個音軌的編碼名稱（取不到時回 null）
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function probeAudioCodec(filePath) {
  const probe = await probeAudioStream(filePath);
  return probe.ok ? probe.codec : null;
}

/**
 * 判斷指定音軌編碼是否需要相容處理
 * @param {string} codec
 * @returns {boolean}
 */
function codecNeedsCompat(codec) {
  return !!codec && UNDECODABLE_AUDIO_CODECS.has(codec);
}

/**
 * 依「檔案實際的音軌編碼」判定是否需要相容處理（含快取）。
 *
 * 這是主要判定路徑：開啟檔案時即可得到確定答案，不必等播放後觀察解碼位元組，
 * 因此不會再出現「必須先暫停再播放才會觸發轉檔」的情況。
 *
 * @param {string} filePath
 * @returns {Promise<{ status: 'needs-compat'|'ok'|'unknown', codec: string|null }>}
 *   needs-compat：編碼確定無法由 IDE 內建 Chromium 解碼 → 應建立相容音軌
 *   ok          ：編碼可解碼（或此檔根本沒有音軌）→ 不需處理
 *   unknown     ：ffprobe 不可用／讀取失敗 → 由前端以「解碼位元組」啟發式補位
 */
async function inspectAudioCompat(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    const key = `${filePath}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
    if (probeCache.has(key)) {
      return probeCache.get(key);
    }
    if (!(await isFfmpegAvailable())) {
      return { status: 'unknown', codec: null };
    }
    const probe = await probeAudioStream(filePath);
    let result;
    if (!probe.ok) {
      result = { status: 'unknown', codec: null };
    } else if (!probe.codec) {
      // ffprobe 正常但沒有音軌 → 本質上沒有聲音可修，不需轉檔
      result = { status: 'ok', codec: null };
    } else {
      result = codecNeedsCompat(probe.codec)
        ? { status: 'needs-compat', codec: probe.codec }
        : { status: 'ok', codec: probe.codec };
    }
    probeCache.set(key, result);
    return result;
  } catch (_) {
    return { status: 'unknown', codec: null };
  }
}

/** 相容檔的暫存路徑（以「路徑＋mtime＋大小」雜湊命名，內容變更即自動失效） */
function buildCompatPath(filePath, stat) {
  const key = crypto.createHash('sha1')
    .update(`${filePath}|${stat.size}|${Math.floor(stat.mtimeMs)}`)
    .digest('hex')
    .slice(0, 16);
  const isVideo = VIDEO_CONTAINER_EXTS.has(path.extname(filePath).toLowerCase());
  return path.join(COMPAT_DIR, `${path.basename(filePath, path.extname(filePath)).slice(0, 40)}.${key}${isVideo ? '.mp4' : '.mp3'}`);
}

/**
 * 清除過期的相容檔暫存（預設 7 天）
 * @param {number} [maxAgeMs]
 * @returns {Promise<number>} 刪除的檔案數
 */
/**
 * 清除過期的相容檔暫存（預設 7 天）
 * @param {number} [maxAgeMs]
 * @returns {Promise<number>} 刪除的檔案數
 */
async function cleanupCompatCache(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  let removed = 0;
  try {
    const entries = await fsp.readdir(COMPAT_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const e of entries) {
      if (!e.isFile()) continue;
      const p = path.join(COMPAT_DIR, e.name);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > maxAgeMs) {
          await fsp.unlink(p);
          removed++;
        }
      } catch (_) { /* 忽略單檔錯誤 */ }
    }
  } catch (_) { /* 目錄不存在 */ }
  return removed;
}

/**
 * 建立（或取用快取的）音訊相容檔
 *
 * 影片容器：畫面 stream copy（無損、極快）＋ 音軌轉 MP3 → 暫存 .mp4
 * 純音訊檔：僅轉音軌 → 暫存 .mp3
 *
 * @param {string} filePath 原始媒體檔絕對路徑
 * @param {{ onProgress?: (kind: 'video'|'audio') => void, force?: boolean }} [options]
 * @returns {Promise<{ filePath: string, codec: string|null, cached: boolean }>}
 */
async function ensureAudioCompat(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('找不到原始檔案');
  }
  if (!(await isFfmpegAvailable())) {
    throw new Error('找不到 ffmpeg（請先安裝 ffmpeg，或改用系統播放器開啟）');
  }

  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_AUTO_COMPAT_BYTES && !options.force) {
    throw new Error('檔案過大（超過 1.5 GB），建議改用系統播放器開啟');
  }

  await fsp.mkdir(COMPAT_DIR, { recursive: true });
  const outPath = buildCompatPath(filePath, stat);
  const codec = await probeAudioCodec(filePath);

  // 快取命中：同一檔案（路徑＋大小＋mtime 未變）且已存在 → 直接重用
  if (!options.force && fs.existsSync(outPath)) {
    const outStat = await fsp.stat(outPath);
    if (outStat.size > 0 && outStat.mtimeMs >= stat.mtimeMs) {
      return { filePath: outPath, codec, cached: true };
    }
    await fsp.unlink(outPath).catch(() => {});
  }

  // 同一檔案若已有進行中的轉檔 → 共用同一個 Promise（避免重複啟動 ffmpeg）
  const inflight = inflightTranscodes.get(outPath);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    const isVideo = VIDEO_CONTAINER_EXTS.has(path.extname(filePath).toLowerCase());
    const args = isVideo
      ? ['-hide_banner', '-nostdin', '-y', '-i', filePath,
         '-map', '0:v:0?', '-map', '0:a:0',
         '-c:v', 'copy', '-c:a', 'libmp3lame', '-b:a', '192k',
         '-movflags', '+faststart', outPath]
      : ['-hide_banner', '-nostdin', '-y', '-i', filePath,
         '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', outPath];

    if (typeof options.onProgress === 'function') {
      options.onProgress(isVideo ? 'video' : 'audio');
    }

    const result = await run('ffmpeg', args, 30 * 60 * 1000);
    const produced = fs.existsSync(outPath) ? await fsp.stat(outPath) : null;
    if (!result.ok || !produced || produced.size === 0) {
      await fsp.unlink(outPath).catch(() => {});
      const tail = (result.stderr || '').trim().split(/\r?\n/).slice(-2).join(' / ').slice(0, 300);
      throw new Error(`轉檔失敗${tail ? '：' + tail : ''}`);
    }

    return { filePath: outPath, codec, cached: false };
  })();

  inflightTranscodes.set(outPath, task);
  try {
    return await task;
  } finally {
    inflightTranscodes.delete(outPath);
  }
}

module.exports = {
  UNDECODABLE_AUDIO_CODECS,
  MAX_AUTO_COMPAT_BYTES,
  COMPAT_DIR,
  isFfmpegAvailable,
  probeAudioStream,
  probeAudioCodec,
  codecNeedsCompat,
  inspectAudioCompat,
  ensureAudioCompat,
  cleanupCompatCache,
  buildCompatPath
};
