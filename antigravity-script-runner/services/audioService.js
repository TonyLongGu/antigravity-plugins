const fsPromises = require('node:fs/promises');
const path = require('node:path');
let vscode = null;
try {
  vscode = require('vscode');
} catch (_) {}
const { audioStreamServer } = require('./audioStreamServer');

// 支援之音訊副檔名清單（一律小寫）
const SUPPORTED_AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.aif',
  '.aiff',
  '.opus',
  '.weba'
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
 * 檢查是否為支援的音訊檔案
 * @param {string} fileName
 * @returns {boolean}
 */
function isAudioFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_AUDIO_EXTS.has(ext);
}

/**
 * 解析 MP4 / M4A 中的 mvhd 時長
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
 * 極速非同步解析 WAV 表頭時長 (RIFF/WAVE)
 */
function parseWavDuration(buf) {
  if (buf.length < 44) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') {
    return null;
  }

  let byteRate = 0;
  let dataSize = 0;
  let pos = 12;

  while (pos < buf.length - 8) {
    const chunkId = buf.toString('latin1', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);

    if (chunkId === 'fmt ' && pos + 8 + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(pos + 8 + 8);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
    // 偶數字節對齊
    if (chunkSize % 2 !== 0) pos++;
  }

  if (byteRate > 0 && dataSize > 0) {
    return dataSize / byteRate;
  }
  return null;
}

/**
 * 極速非同步解析 FLAC 表頭時長 (STREAMINFO)
 */
function parseFlacDuration(buf) {
  if (buf.length < 42) return null;
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return null;

  // 第一個 metadata block header: byte 4, block type = (header & 0x7F)
  const blockType = buf.readUInt8(4) & 0x7F;
  if (blockType !== 0) return null; // 0 為 STREAMINFO

  // STREAMINFO 結構:
  // offset 18: sample_rate (20 bits), channels (3 bits), bps (5 bits), total_samples (36 bits)
  const b0 = buf.readUInt8(18);
  const b1 = buf.readUInt8(19);
  const b2 = buf.readUInt8(20);
  const sampleRate = (b0 << 12) | (b1 << 4) | (b2 >> 4);

  const b3 = buf.readUInt8(21);
  const b4 = buf.readUInt8(22);
  const b5 = buf.readUInt8(23);
  const b6 = buf.readUInt8(24);
  const b7 = buf.readUInt8(25);

  const totalSamplesHigh = b3 & 0x0F;
  const totalSamplesLow = (b4 * 16777216) + (b5 << 16) + (b6 << 8) + b7;
  const totalSamples = (totalSamplesHigh * 4294967296) + totalSamplesLow;

  if (sampleRate > 0 && totalSamples > 0) {
    return totalSamples / sampleRate;
  }
  return null;
}

/**
 * 極速非同步解析 MP3 表頭時長 (Xing/Info 或 CBR 預估)
 */
function parseMp3Duration(buf, fileSize) {
  if (buf.length < 128) return null;
  let offset = 0;

  // 略過 ID3v2 標頭
  if (buf.toString('latin1', 0, 3) === 'ID3') {
    const b0 = buf.readUInt8(6);
    const b1 = buf.readUInt8(7);
    const b2 = buf.readUInt8(8);
    const b3 = buf.readUInt8(9);
    const tagSize = (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
    offset = 10 + tagSize;
  }

  if (offset >= buf.length - 64) return null;

  // 尋找第一個 MPEG sync 訊框 (0xFF 配合高 3 位為 1)
  let framePos = -1;
  for (let i = offset; i < Math.min(buf.length - 4, offset + 4096); i++) {
    if (buf.readUInt8(i) === 0xFF && (buf.readUInt8(i + 1) & 0xE0) === 0xE0) {
      framePos = i;
      break;
    }
  }

  if (framePos === -1) return null;

  const b1 = buf.readUInt8(framePos + 1);
  const b2 = buf.readUInt8(framePos + 2);
  const b3 = buf.readUInt8(framePos + 3);

  const mpegVersion = (b1 >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b1 >> 1) & 0x03; // 1 = Layer III
  const sampleRateIdx = (b2 >> 2) & 0x03;
  const channelMode = (b3 >> 6) & 0x03;

  const sampleRates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000]
  };

  const srTable = sampleRates[mpegVersion];
  if (!srTable || sampleRateIdx > 2) return null;
  const sampleRate = srTable[sampleRateIdx];

  // 檢查 Xing / Info 標頭
  const isMono = channelMode === 3;
  const xingOffset = framePos + 4 + (mpegVersion === 3 ? (isMono ? 17 : 32) : (isMono ? 9 : 17));

  if (xingOffset + 16 <= buf.length) {
    const id = buf.toString('latin1', xingOffset, xingOffset + 4);
    if (id === 'Xing' || id === 'Info') {
      const flags = buf.readUInt32BE(xingOffset + 4);
      if (flags & 0x0001) { // FRAMES_FLAG
        const frames = buf.readUInt32BE(xingOffset + 8);
        const samplesPerFrame = layer === 1 ? (mpegVersion === 3 ? 1152 : 576) : 1152;
        if (frames > 0 && sampleRate > 0) {
          return (frames * samplesPerFrame) / sampleRate;
        }
      }
    }
  }

  // 若無 Xing 標頭，嘗試以訊框 Bitrate 估計 CBR 總時長
  const bitrateIdx = (b2 >> 4) & 0x0F;
  const bitratesMpeg1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  if (mpegVersion === 3 && layer === 1 && bitrateIdx > 0 && bitrateIdx < 15) {
    const kbps = bitratesMpeg1L3[bitrateIdx];
    const audioDataBytes = Math.max(1024, fileSize - offset);
    return (audioDataBytes * 8) / (kbps * 1000);
  }

  return null;
}

/**
 * 極速非同步解析各格式音訊真實時長
 * @param {string} filePath
 * @returns {Promise<number|null>}
 */
async function getAudioDurationFast(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  let handle;
  try {
    handle = await fsPromises.open(filePath, 'r');
    const stat = await handle.stat();
    if (stat.size < 64) return null;

    // 1. WAV 解析
    if (ext === '.wav') {
      const len = Math.min(stat.size, 8192);
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, 0);
      return parseWavDuration(buf);
    }

    // 2. FLAC 解析
    if (ext === '.flac') {
      const len = Math.min(stat.size, 1024);
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, 0);
      return parseFlacDuration(buf);
    }

    // 3. M4A / AAC (MP4 container) 解析
    if (ext === '.m4a' || ext === '.aac') {
      const headLen = Math.min(stat.size, 32768);
      const headBuf = Buffer.alloc(headLen);
      await handle.read(headBuf, 0, headLen, 0);
      const dur = parseMvhdFromBuf(headBuf);
      if (dur) return dur;

      // 若 moov 在尾部
      if (stat.size > 32768) {
        const tailLen = Math.min(stat.size, 262144);
        const tailBuf = Buffer.alloc(tailLen);
        await handle.read(tailBuf, 0, tailLen, stat.size - tailLen);
        const tailDur = parseMvhdFromBuf(tailBuf);
        if (tailDur) return tailDur;
      }
    }

    // 4. MP3 解析
    if (ext === '.mp3') {
      const len = Math.min(stat.size, 65536);
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, 0);
      return parseMp3Duration(buf, stat.size);
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
 * 掃描目標資料夾中的所有音訊檔案
 * @param {string} rootDir 根目錄絕對路徑
 * @param {boolean} recursive 是否遞迴搜尋子資料夾
 * @param {vscode.Webview} webview Webview 實例
 * @returns {Promise<Array<{ fileName: string, relativePath: string, fullPath: string, size: number, sizeFormatted: string, mtimeMs: number, ext: string, uri: string, duration: number|null, durationFormatted: string }>>}
 */
async function scanAudios(rootDir, recursive = false, webview = null) {
  const results = [];
  const streamPort = await audioStreamServer.ensureServer();

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[AudioService] 無法讀取目錄: ${currentDir}`, err);
      return;
    }

    const subDirs = [];
    const audioFiles = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '$RECYCLE.BIN') {
          subDirs.push(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile()) {
        if (isAudioFile(entry.name)) {
          audioFiles.push(entry.name);
        }
      }
    }

    const BATCH_SIZE = 32;
    for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
      const chunk = audioFiles.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (fileName) => {
          const fullPath = path.join(currentDir, fileName);
          try {
            const [stat, durationSec] = await Promise.all([
              fsPromises.stat(fullPath),
              getAudioDurationFast(fullPath)
            ]);

            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            const streamUri = `http://127.0.0.1:${streamPort}/audio?token=${audioStreamServer.sessionToken}&path=${encodeURIComponent(fullPath)}`;
            let localUri = streamUri;
            if (webview && vscode && vscode.Uri) {
              try {
                localUri = `${webview.asWebviewUri(vscode.Uri.file(fullPath)).toString()}?v=${Math.floor(stat.mtimeMs)}`;
              } catch (_) {
                localUri = streamUri;
              }
            }

            return {
              fileName: fileName,
              relativePath: relativePath,
              fullPath: fullPath,
              size: stat.size,
              sizeFormatted: formatBytes(stat.size),
              mtimeMs: stat.mtimeMs,
              ext: path.extname(fileName).toLowerCase().replace('.', ''),
              uri: streamUri,
              localUri: localUri,
              duration: durationSec,
              durationFormatted: formatDuration(durationSec)
            };
          } catch (statErr) {
            console.warn(`[AudioService] 無法取得檔案狀態: ${fullPath}`, statErr);
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
  SUPPORTED_AUDIO_EXTS,
  formatBytes,
  formatDuration,
  isAudioFile,
  getAudioDurationFast,
  scanAudios
};
