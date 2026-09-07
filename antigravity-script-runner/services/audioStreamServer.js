const http = require('node:http');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// 支援音訊串流之 MIME 類型映射
const AUDIO_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.weba': 'audio/webm',
  '.wma': 'audio/x-ms-wma',
  '.aif': 'audio/x-aiff',
  '.aiff': 'audio/x-aiff'
};

class AudioStreamServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.startPromise = null;
    this.sessionToken = crypto.randomBytes(16).toString('hex');
    this.activePanelsCount = 0;
    this.shutdownTimer = null;
  }

  /**
   * 增加使用中的面板引用計數
   */
  retain() {
    this.activePanelsCount++;
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
  }

  /**
   * 減少使用中的面板引用計數；若歸零則 15 秒後自動休眠關閉伺服器
   */
  release() {
    this.activePanelsCount = Math.max(0, this.activePanelsCount - 1);
    if (this.activePanelsCount === 0 && this.server && this.server.listening) {
      if (this.shutdownTimer) {
        clearTimeout(this.shutdownTimer);
      }
      this.shutdownTimer = setTimeout(() => {
        if (this.activePanelsCount === 0) {
          console.log('[AudioStreamServer] 所有聲音檢視面板已關閉，自動休眠伺服器釋放通訊埠');
          this.dispose();
        }
      }, 15000);
    }
  }

  /**
   * 啟動本機 HTTP 206 串流伺服器（動態隨機可用連接埠）
   * @returns {Promise<number>} 回傳監聽連接埠號
   */
  async ensureServer() {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }

    if (this.port && this.server && this.server.listening) {
      return this.port;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      // 伺服器錯誤保護
      srv.on('error', (err) => {
        console.error('[AudioStreamServer] 伺服器錯誤:', err);
        this.startPromise = null;
        reject(err);
      });

      // 監聽 127.0.0.1 隨機可用高位連接埠
      srv.listen(0, '127.0.0.1', () => {
        this.server = srv;
        this.port = srv.address().port;
        this.sessionToken = crypto.randomBytes(16).toString('hex');
        this.startPromise = null;
        console.log(`[AudioStreamServer] 本機 HTTP 206 串流伺服器已啟動於 127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });

    return this.startPromise;
  }

  /**
   * 處理傳入之 HTTP 請求（包含 CORS、OPTIONS 預檢與 HTTP 206 Range 串流）
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async _handleRequest(req, res) {
    // 跨來源存取授權（允許 VS Code Webview 沙盒存取本機串流）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept-Encoding');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const reqUrl = new URL(req.url, `http://127.0.0.1:${this.port}`);
      if (reqUrl.pathname !== '/audio') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 Not Found');
        return;
      }

      // 1. 安全校驗：驗證 Session Token
      const token = reqUrl.searchParams.get('token');
      if (!token || token !== this.sessionToken) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('403 Forbidden: Invalid or missing stream token');
        return;
      }

      const rawFilePath = reqUrl.searchParams.get('path');
      if (!rawFilePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('400 Missing path parameter');
        return;
      }

      const filePath = path.normalize(rawFilePath);
      const ext = path.extname(filePath).toLowerCase();

      // 2. 安全校驗：限制副檔名白名單
      if (!Object.prototype.hasOwnProperty.call(AUDIO_MIME_TYPES, ext)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('403 Forbidden: File type not allowed for audio streaming');
        return;
      }

      let stat;
      try {
        stat = await fsPromises.stat(filePath);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 File Not Found');
        return;
      }

      if (!stat.isFile()) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('400 Not a file');
        return;
      }

      const fileSize = stat.size;
      const contentType = AUDIO_MIME_TYPES[ext] || 'audio/mpeg';
      const range = req.headers.range;

      // 串流傳輸分塊上限：單次回應上限 4MB
      const MAX_CHUNK_SIZE = 4 * 1024 * 1024;

      // 支援 HTTP 206 範圍請求
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        let requestedEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || start < 0) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`,
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          });
          res.end();
          return;
        }

        if (requestedEnd >= fileSize) {
          requestedEnd = fileSize - 1;
        }

        const end = requestedEnd;

        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        // 中斷時僅銷毀檔案讀取串流，保護 HTTP Keep-Alive 連線池
        req.on('close', () => {
          if (!fileStream.destroyed) fileStream.destroy();
        });

        fileStream.on('error', (streamErr) => {
          if (!fileStream.destroyed) fileStream.destroy();
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          res.end();
        });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });

        fileStream.pipe(res);
      } else {
        // 全檔或 HEAD 探測請求
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          });
          res.end();
          return;
        }

        // 無 Range 標頭之完整音訊 GET 串流請求，回傳標準 200 OK
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        });

        const fileStream = fs.createReadStream(filePath);
        req.on('close', () => {
          if (!fileStream.destroyed) fileStream.destroy();
        });

        fileStream.on('error', () => {
          if (!fileStream.destroyed) fileStream.destroy();
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });

        fileStream.pipe(res);
      }
    } catch (err) {
      console.error('[AudioStreamServer] 處理請求例外:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
      }
      res.end('500 Internal Server Error');
    }
  }

  /**
   * 取得指定音訊檔案於本機串流伺服器之安全 URL
   * @param {string} filePath 檔案實體絕對路徑
   * @returns {Promise<string>}
   */
  async getStreamUrl(filePath) {
    const port = await this.ensureServer();
    return `http://127.0.0.1:${port}/audio?token=${this.sessionToken}&path=${encodeURIComponent(filePath)}`;
  }

  /**
   * 關閉串流伺服器
   */
  dispose() {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    if (this.server) {
      try {
        if (typeof this.server.closeAllConnections === 'function') {
          this.server.closeAllConnections();
        }
        this.server.close();
      } catch (_) {}
      this.server = null;
      this.port = null;
      this.startPromise = null;
    }
  }
}

// 導出單例
const audioStreamServer = new AudioStreamServer();

module.exports = {
  AUDIO_MIME_TYPES,
  AudioStreamServer,
  audioStreamServer
};
