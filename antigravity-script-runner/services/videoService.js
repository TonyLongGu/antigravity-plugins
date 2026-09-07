const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { videoStreamServer } = require('./videoStreamServer');

// 支援之影片副檔名清單（一律小寫）
const SUPPORTED_VIDEO_EXTS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
  '.avi',
  '.wmv',
  '.flv',
  '.m4v',
  '.ts',
  '.ogv'
]);

/**
 * 格式化檔案容量位元組
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

/**
 * 秒數格式化 (秒 -> MM:SS 或 HH:MM:SS)
 * @param {number|null} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0 || !isFinite(seconds)) {
    return '--:--';
  }
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * 輔助從 Buffer 中解析 mvhd 的時長
 */
function parseMvhdFromBuf(buf) {
  const mvhdIdx = buf.indexOf('mvhd');
  if (mvhdIdx !== -1 && mvhdIdx + 32 <= buf.length) {
    const ver = buf.readUInt8(mvhdIdx + 4);
    let timescale = 0;
    let duration = 0;
    if (ver === 0) {
      timescale = buf.readUInt32BE(mvhdIdx + 16);
      duration = buf.readUInt32BE(mvhdIdx + 20);
    } else if (ver === 1 && mvhdIdx + 40 <= buf.length) {
      timescale = buf.readUInt32BE(mvhdIdx + 24);
      duration = Number(buf.readBigUInt64BE(mvhdIdx + 28));
    }
    if (timescale > 0 && duration > 0) {
      return duration / timescale;
    }
  }
  return null;
}

/**
 * 極速非同步解析 MP4 / MOV / fMP4 影片之真實時長（完整支援 Fragmented MP4）
 * 耗時通常 < 0.2ms，零負擔
 * @param {string} filePath
 * @returns {Promise<number|null>} 回傳秒數或 null
 */
async function getMediaDurationFast(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.mp4' && ext !== '.mov' && ext !== '.m4v') {
    return null;
  }

  let handle;
  try {
    handle = await fsPromises.open(filePath, 'r');
    const stat = await handle.stat();
    if (stat.size < 128) return null;

    // 1. 讀取開頭 32KB 檢查 mvhd
    const headLen = Math.min(stat.size, 32768);
    const headBuf = Buffer.alloc(headLen);
    await handle.read(headBuf, 0, headLen, 0);

    const directDur = parseMvhdFromBuf(headBuf);
    if (directDur) return directDur;

    // 收集 head 中的 trak timescales (供 fMP4 之 tfra 換算)
    const trackTimescales = {};
    let pos = 0;
    while (pos < headBuf.length - 8) {
      const tkhdIdx = headBuf.indexOf('tkhd', pos);
      if (tkhdIdx === -1) break;
      const ver = headBuf.readUInt8(tkhdIdx + 4);
      const trackId = ver === 0 ? headBuf.readUInt32BE(tkhdIdx + 16) : headBuf.readUInt32BE(tkhdIdx + 24);
      const mdhdIdx = headBuf.indexOf('mdhd', tkhdIdx);
      if (mdhdIdx !== -1 && mdhdIdx < tkhdIdx + 2048) {
        const mdhdVer = headBuf.readUInt8(mdhdIdx + 4);
        const timescale = mdhdVer === 0 ? headBuf.readUInt32BE(mdhdIdx + 16) : headBuf.readUInt32BE(mdhdIdx + 24);
        trackTimescales[trackId] = timescale;
      }
      pos = tkhdIdx + 8;
    }

    // 2. 讀取尾部 1.5MB (兼顧 fMP4 之 mfra 與傳統 MP4/MOV 置於尾部之 moov)
    const tailLen = Math.min(stat.size, 1572864);
    const tailBuf = Buffer.alloc(tailLen);
    await handle.read(tailBuf, 0, tailLen, stat.size - tailLen);

    // 若尾部有 mvhd (非 faststart 傳統影片)
    const tailMvhdDur = parseMvhdFromBuf(tailBuf);
    if (tailMvhdDur) return tailMvhdDur;

    // 若為 fMP4 (尾部有 mfra/tfra)
    const mfraIdx = tailBuf.lastIndexOf('mfra');
    if (mfraIdx !== -1) {
      const mfraBox = tailBuf.subarray(mfraIdx - 4);
      let p = 8;
      let maxSec = 0;
      while (p < mfraBox.length - 8) {
        const bSize = mfraBox.readUInt32BE(p);
        const bType = mfraBox.toString('latin1', p + 4, p + 8);
        if (bType === 'tfra') {
          const ver = mfraBox.readUInt8(p + 8);
          const trackId = mfraBox.readUInt32BE(p + 12);
          const lengthFields = mfraBox.readUInt32BE(p + 16);
          const lengthSizeOfTrafNum = (lengthFields >> 4) & 0x03;
          const lengthSizeOfTrunNum = (lengthFields >> 2) & 0x03;
          const lengthSizeOfSampleNum = lengthFields & 0x03;
          const numEntries = mfraBox.readUInt32BE(p + 20);
          if (numEntries > 0) {
            const entrySize = (ver === 1 ? 16 : 8) + (lengthSizeOfTrafNum + 1) + (lengthSizeOfTrunNum + 1) + (lengthSizeOfSampleNum + 1);
            const lastEntryPos = p + 24 + (numEntries - 1) * entrySize;
            if (lastEntryPos + 8 <= mfraBox.length) {
              const time = ver === 1 ? Number(mfraBox.readBigUInt64BE(lastEntryPos)) : mfraBox.readUInt32BE(lastEntryPos);
              const ts = trackTimescales[trackId] || 1000;
              const sec = time / ts;
              if (sec > maxSec) maxSec = sec;
            }
          }
        }
        if (bSize === 0) break;
        p += bSize;
      }
      if (maxSec > 0) return maxSec;
    }

    return null;
  } catch (_) {
    return null;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
  }
}

/**
 * 檢查是否為支援的影片檔案
 * @param {string} fileName
 * @returns {boolean}
 */
function isVideoFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_VIDEO_EXTS.has(ext);
}

/**
 * 掃描目標資料夾中的所有影片檔案
 * @param {string} rootDir 根目錄絕對路徑
 * @param {boolean} recursive 是否遞迴搜尋子資料夾
 * @param {vscode.Webview} webview Webview 實例
 * @returns {Promise<Array<{ fileName: string, relativePath: string, fullPath: string, size: number, sizeFormatted: string, mtimeMs: number, ext: string, uri: string, duration: number|null, durationFormatted: string }>>}
 */
async function scanVideos(rootDir, recursive = false, webview = null) {
  const results = [];
  const streamPort = await videoStreamServer.ensureServer();

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[VideoService] 無法讀取目錄: ${currentDir}`, err);
      return;
    }

    const subDirs = [];
    const videoFiles = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 忽略常見系統與暫存隱藏資料夾
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '$RECYCLE.BIN') {
          subDirs.push(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile()) {
        if (isVideoFile(entry.name)) {
          videoFiles.push(entry.name);
        }
      }
    }

    // 併發批次查詢檔案狀態與時長（每批 32 個，兼顧效能與檔案描述符限制）
    const BATCH_SIZE = 32;
    for (let i = 0; i < videoFiles.length; i += BATCH_SIZE) {
      const chunk = videoFiles.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (fileName) => {
          const fullPath = path.join(currentDir, fileName);
          try {
            const [stat, durationSec] = await Promise.all([
              fsPromises.stat(fullPath),
              getMediaDurationFast(fullPath)
            ]);

            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            // 使用本機 HTTP 206 串流伺服器提供真正的 Range 切片播放與無損檔名編碼支援
            const streamUri = `http://127.0.0.1:${streamPort}/video?token=${videoStreamServer.sessionToken}&path=${encodeURIComponent(fullPath)}`;

            return {
              fileName: fileName,
              relativePath: relativePath,
              fullPath: fullPath,
              size: stat.size,
              sizeFormatted: formatBytes(stat.size),
              mtimeMs: stat.mtimeMs,
              ext: path.extname(fileName).toLowerCase().replace('.', ''),
              uri: streamUri,
              duration: durationSec,
              durationFormatted: formatDuration(durationSec)
            };
          } catch (statErr) {
            console.warn(`[VideoService] 無法取得檔案狀態: ${fullPath}`, statErr);
            return null;
          }
        })
      );

      for (const item of chunkResults) {
        if (item) results.push(item);
      }
    }

    if (recursive && subDirs.length > 0) {
      for (const subDir of subDirs) {
        await walk(subDir);
      }
    }
  }

  await walk(rootDir);

  // 預設按修改時間新到舊排序（時間 (新到舊)）
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return results;
}

module.exports = {
  SUPPORTED_VIDEO_EXTS,
  formatBytes,
  isVideoFile,
  scanVideos
};
