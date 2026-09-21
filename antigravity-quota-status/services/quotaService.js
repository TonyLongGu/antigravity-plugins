const vscode = require('vscode');
const antigravityQuota = require('./antigravityQuotaService');
const cursorQuota = require('./cursorQuotaService');

/**
 * 依目前 IDE 自動選擇額度後端：
 * - Antigravity：本機 Language Server RPC
 * - Cursor：本機 token + api2.cursor.sh
 */
function detectBackend() {
  try {
    const cfg = vscode.workspace.getConfiguration('aiQuota').get('backend', 'auto');
    if (cfg === 'cursor' || cfg === 'antigravity') return cfg;
  } catch (_) { /* 單元測試或尚未啟動 vscode */ }

  try {
    const app = String(vscode.env.appName || '').toLowerCase();
    if (app.includes('cursor')) return 'cursor';
    if (app.includes('antigravity')) return 'antigravity';
  } catch (_) { /* 忽略 */ }

  return 'antigravity';
}

class QuotaFacade {
  getBackend() {
    return detectBackend();
  }

  _svc() {
    return this.getBackend() === 'cursor' ? cursorQuota : antigravityQuota;
  }

  async getQuotaStatus(forceRefresh = false) {
    const backend = this.getBackend();
    const data = await this._svc().getQuotaStatus(forceRefresh);
    if (data && typeof data === 'object') {
      data.source = backend;
    }
    return data;
  }

  getAvailableServers() {
    const svc = this._svc();
    return typeof svc.getAvailableServers === 'function' ? svc.getAvailableServers() : [];
  }

  selectServer(pid) {
    const svc = this._svc();
    if (typeof svc.selectServer === 'function') svc.selectServer(pid);
  }

  getSelectedPid() {
    const svc = this._svc();
    return typeof svc.getSelectedPid === 'function' ? svc.getSelectedPid() : null;
  }

  get _cachedConnection() {
    return this._svc()._cachedConnection || null;
  }
}

module.exports = new QuotaFacade();
