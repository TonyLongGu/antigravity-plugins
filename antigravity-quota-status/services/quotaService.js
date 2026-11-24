const vscode = require('vscode');
const antigravityQuota = require('./antigravityQuotaService');
const antigravityCloudQuota = require('./antigravityApiService');
const cursorQuota = require('./cursorQuotaService');

/**
 * 依目前 IDE 自動選擇額度後端：
 * - Antigravity：本機語言伺服器（IDE 面板同源，回傳 Gemini + Claude 兩種配額）優先，
 *   取不到才走 Google Cloud Code API（只有 Claude 群組，沒有 IDE 時的備援）
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
    const data = backend === 'cursor'
      ? await cursorQuota.getQuotaStatus(forceRefresh)
      : await this._getAntigravityQuota(forceRefresh);
    if (data && typeof data === 'object') {
      data.source = backend;
    }
    return data;
  }

  /**
   * Antigravity 額度：本機語言伺服器優先（與 IDE 面板同一個 hub，數字一致），
   * 取不到才退回 Google Cloud Code API（例如只裝 CLI、IDE 沒開）。
   */
  async _getAntigravityQuota(forceRefresh) {
    const local = await antigravityQuota.getQuotaStatus(forceRefresh);
    if (local?.success) return local;

    const cloud = await antigravityCloudQuota.getQuotaStatus(forceRefresh);
    if (cloud?.success) return cloud;

    return cloud || local;
  }

  getAvailableServers() {
    const svc = this._svc();
    return typeof svc.getAvailableServers === 'function' ? svc.getAvailableServers() : [];
  }

  selectServer(pid) {
    const svc = this._svc();
    if (typeof svc.selectServer === 'function') svc.selectServer(pid);
    // 切換帳號後雲端快取也要失效，避免繼續顯示舊帳號
    antigravityCloudQuota._cachedQuota = null;
    antigravityCloudQuota._lastFetchTime = null;
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
