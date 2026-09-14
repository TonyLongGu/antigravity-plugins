// ==============================================================================
// 檔案名稱：services/probeService.js
// 功能說明：MCP 伺服器探針測試服務 (支援 CLI 進程探針、JSON-RPC Ping 與遠端 HTTP/SSE 測速)
// ==============================================================================

const { exec, spawn } = require('node:child_process');

class ProbeService {
  /**
   * 測試 MCP 伺服器連線/回應狀態
   * @param {Object} serverConfig 伺服器設定 (含 command, args, env 或 serverUrl, headers)
   * @returns {Promise<{ ok: boolean, type?: string, latency?: number, status?: number, message: string }>}
   */
  static async testServerConnection(serverConfig) {
    if (!serverConfig) {
      return { ok: false, messageKey: 'probe_no_config', message: '未提供伺服器設定' };
    }

    const startTime = Date.now();

    // 1. 遠端 URL 測試 (HTTP / SSE)
    const targetUrl = serverConfig.serverUrl || serverConfig.url;
    if (targetUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const headers = { ...(serverConfig.headers || {}) };
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latency = Date.now() - startTime;
        return {
          ok: true,
          type: 'remote',
          status: res.status,
          latency,
          messageKey: 'probe_http_ok',
          messageParams: { status: res.status },
          message: `連線正常 (HTTP ${res.status})`,
        };
      } catch (err) {
        const latency = Date.now() - startTime;
        const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
        return {
          ok: false,
          type: 'remote',
          latency: isTimeout ? 4000 : latency,
          messageKey: isTimeout ? 'probe_timeout' : 'probe_http_fail',
          messageParams: { error: err.message || '連線失敗' },
          message: isTimeout ? '連線超時 (4s)' : `無法連線 (${err.message || '連線失敗'})`,
        };
      }
    }

    // 2. 本地 CLI 命令測試 (Node / UV / NPX / Python 等)
    if (serverConfig.command) {
      return new Promise((resolve) => {
        let isResolved = false;
        let child = null;
        let timer = null;

        const finish = (result) => {
          if (isResolved) return;
          isResolved = true;
          if (timer) clearTimeout(timer);
          if (child && child.exitCode === null && !child.killed) {
            try {
              if (process.platform === 'win32' && child.pid) {
                exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, () => {});
              } else {
                child.kill('SIGKILL');
              }
            } catch (e) {}
          }
          resolve(result);
        };

        try {
          const cmd = serverConfig.command;
          const args = serverConfig.args || [];
          const env = { ...process.env, ...(serverConfig.env || {}) };

          child = spawn(cmd, args, {
            env,
            shell: process.platform === 'win32',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let stderrBuffer = '';
          let hasFatalStderr = false;

          child.on('error', (err) => {
            finish({
              ok: false,
              type: 'cli',
              latency: Date.now() - startTime,
              messageKey: 'probe_spawn_fail',
              messageParams: { cmd },
              message: `啟動失敗: 找不到指令 [${cmd}] 或權限不足 (${err.message})`,
            });
          });

          try {
            // 發送標準 MCP ping 指令
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
          } catch (e) {}

          child.stdout.on('data', () => {
            // 收到標準輸出，確認進程正常響應
            finish({
              ok: true,
              type: 'cli',
              latency: Date.now() - startTime,
              messageKey: 'probe_response_ok',
              message: '回應正常',
            });
          });

          child.stderr.on('data', (d) => {
            const text = d.toString();
            stderrBuffer = (stderrBuffer + text).slice(-500); // 保留最新 500 字元

            // 檢驗致命錯誤標記
            const isFatal = /(error|fatal|exception|traceback|cannot find module|command not found|failed to start|enoent|eacces)/i.test(text);
            if (isFatal) {
              hasFatalStderr = true;
            }
          });

          child.on('exit', (code) => {
            if (code === 0) {
              finish({
                ok: true,
                type: 'cli',
                latency: Date.now() - startTime,
                messageKey: 'probe_exit_ok',
                message: '指令可正常執行 (Exit 0)',
              });
            } else {
              const summaryErr = stderrBuffer.trim().split('\n').pop() || '';
              finish({
                ok: false,
                type: 'cli',
                latency: Date.now() - startTime,
                messageKey: 'probe_exit_fail',
                messageParams: { code },
                message: summaryErr ? `進程異常結束 (${summaryErr.slice(0, 60)})` : `進程異常結束 (Exit code: ${code})`,
              });
            }
          });

          timer = setTimeout(() => {
            if (hasFatalStderr) {
              const summaryErr = stderrBuffer.trim().split('\n').pop() || '發現錯誤輸出';
              finish({
                ok: false,
                type: 'cli',
                latency: Date.now() - startTime,
                messageKey: 'probe_error',
                messageParams: { error: summaryErr },
                message: `啟動異常: ${summaryErr.slice(0, 60)}`,
              });
            } else {
              finish({
                ok: true,
                type: 'cli',
                latency: Date.now() - startTime,
                messageKey: 'probe_daemon_running',
                message: '服務常駐運作中',
              });
            }
          }, 1500);

        } catch (err) {
          finish({
            ok: false,
            type: 'cli',
            latency: Date.now() - startTime,
            messageKey: 'probe_error',
            messageParams: { error: err.message },
            message: `測試異常: ${err.message}`,
          });
        }
      });
    }

    return { ok: false, messageKey: 'probe_undefined_config', message: '未定義 command 或 serverUrl' };
  }
}

module.exports = ProbeService;
