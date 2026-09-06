const http = require('node:http');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

// 支援影片串流之 MIME 類型映射
const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.ogv': 'video/ogg'
};

class VideoStreamServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.startPromise = null;
  }

  /**
   * 啟動本機 HTTP 206 串流伺服器（動態隨機可用連接埠）
   * @returns {Promise<number>} 回傳監聽連接埠號
   */
  async ensureServer() {
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
        console.error('[VideoStreamServer] 伺服器錯誤:', err);
        this.startPromise = null;
        reject(err);
      });

      // 監聽 127.0.0.1 隨機可用高位連接埠
      srv.listen(0, '127.0.0.1', () => {
        this.server = srv;
        this.port = srv.address().port;
        this.startPromise = null;
        console.log(`[VideoStreamServer] 本機 HTTP 206 串流伺服器已啟動於 127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });

    return this.startPromise;
  }

  /**
   * 處理傳入之 HTTP 請求（包含 CORS、OPTIONS 預檢與 HTTP 206 Range 串流）
   * 遵循 web-video-player-guide：不破壞 Keep-Alive 連線池，中斷時僅銷毀檔案讀取串流
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
      if (reqUrl.pathname !== '/video') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 Not Found');
        return;
      }

      const rawFilePath = reqUrl.searchParams.get('path');
      if (!rawFilePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('400 Missing path parameter');
        return;
      }

      const filePath = path.normalize(rawFilePath);

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
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'video/mp4';
      const range = req.headers.range;

      // 串流傳輸分塊上限：單次回應上限 4MB (4,194,304 位元組)
      // 遵循標準視訊 CDN / Streaming 規範：避免開放式 Range (bytes=0-) 對 1GB~2GB 超大檔無腦灌注全檔資料流卡死連線池與磁碟 I/O
      const MAX_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

      // 支援影片 HTTP 206 範圍請求 (Range Requests for streaming)
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

        // 分塊限制：若單次回應長度超過 MAX_CHUNK_SIZE，截斷至 MAX_CHUNK_SIZE
        // 保障 Chromium 能即刻接收到資料並復用 Keep-Alive 連線，絕不阻塞 Socket 池
        let end = requestedEnd;
        if ((end - start + 1) > MAX_CHUNK_SIZE) {
          end = start + MAX_CHUNK_SIZE - 1;
        }

        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        // 客戶端跳轉或切換時，僅需銷毀檔案讀取串流，切勿暴力 destroy Socket，以保護 HTTP/1.1 Keep-Alive 連線池
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

        // 若為影片大檔（大於 MAX_CHUNK_SIZE）且無 Range 標頭，回傳 206 首個切片，杜絕意外灌入 2GB
        if (fileSize > MAX_CHUNK_SIZE) {
          const end = MAX_CHUNK_SIZE - 1;
          const chunksize = MAX_CHUNK_SIZE;
          const fileStream = fs.createReadStream(filePath, { start: 0, end });
          req.on('close', () => {
            if (!fileStream.destroyed) fileStream.destroy();
          });
          fileStream.on('error', () => {
            if (!fileStream.destroyed) fileStream.destroy();
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
          res.writeHead(206, {
            'Content-Range': `bytes 0-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
          });
          fileStream.pipe(res);
          return;
        }

        // 小檔案正常輸出
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
      console.error('[VideoStreamServer] 處理請求例外:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
      }
      res.end('500 Internal Server Error');
    }
  }

  /**
   * 取得指定檔案於本機串流伺服器之安全 URL
   * @param {string} filePath 檔案實體絕對路徑
   * @returns {Promise<string>}
   */
  async getStreamUrl(filePath) {
    const port = await this.ensureServer();
    return `http://127.0.0.1:${port}/video?path=${encodeURIComponent(filePath)}`;
  }

  /**
   * 關閉串流伺服器（於擴充套件停用時調用）
   */
  dispose() {
    if (this.server) {
      try {
        this.server.close();
      } catch (_) {}
      this.server = null;
      this.port = null;
      this.startPromise = null;
    }
  }
}

// 導出單例
const videoStreamServer = new VideoStreamServer();

module.exports = {
  VideoStreamServer,
  videoStreamServer
};
