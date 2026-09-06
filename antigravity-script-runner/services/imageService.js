const fsPromises = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

// 支援之圖片副檔名清單（一律小寫）
const SUPPORTED_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.bmp',
  '.ico',
  '.avif',
  '.tif',
  '.tiff',
  '.jfif'
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
 * 檢查是否為支援的圖片檔案
 * @param {string} fileName
 * @returns {boolean}
 */
function isImageFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_IMAGE_EXTS.has(ext);
}

/**
 * 掃描目標資料夾中的所有圖片檔案
 * @param {string} rootDir 根目錄絕對路徑
 * @param {boolean} recursive 是否遞迴搜尋子資料夾
 * @param {vscode.Webview} webview Webview 實例（用於產生安全的 asWebviewUri）
 * @returns {Promise<Array<{ fileName: string, relativePath: string, fullPath: string, size: number, sizeFormatted: string, mtimeMs: number, ext: string, uri: string }>>}
 */
async function scanImages(rootDir, recursive = false, webview = null) {
  const results = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[ImageService] 無法讀取目錄: ${currentDir}`, err);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // 忽略常見系統與暫存隱藏資料夾
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '$RECYCLE.BIN') {
          continue;
        }
        if (recursive) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (isImageFile(entry.name)) {
          try {
            const stat = await fsPromises.stat(fullPath);
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            const rawUri = webview
              ? webview.asWebviewUri(vscode.Uri.file(fullPath)).toString()
              : vscode.Uri.file(fullPath).toString();
            const safeUri = `${rawUri}?v=${Math.floor(stat.mtimeMs)}`;

            results.push({
              fileName: entry.name,
              relativePath: relativePath,
              fullPath: fullPath,
              size: stat.size,
              sizeFormatted: formatBytes(stat.size),
              mtimeMs: stat.mtimeMs,
              ext: path.extname(entry.name).toLowerCase().replace('.', ''),
              uri: safeUri
            });
          } catch (statErr) {
            console.warn(`[ImageService] 無法取得檔案狀態: ${fullPath}`, statErr);
          }
        }
      }
    }
  }

  await walk(rootDir);

  // 預設按檔名自然排序（A-Z，支援數字自然順序）
  results.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));

  return results;
}

module.exports = {
  SUPPORTED_IMAGE_EXTS,
  formatBytes,
  isImageFile,
  scanImages
};
