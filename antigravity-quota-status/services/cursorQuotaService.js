const https = require('node:https');
const authService = require('./cursorAuthService');

const UNLIMITED = -1;
const DASHBOARD_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const AUTH_USAGE_PATH = '/auth/usage';
const STRIPE_URL = 'https://cursor.com/api/auth/stripe';

/**
 * Cursor 額度狀態服務
 * 以本機 access token 呼叫 GetCurrentPeriodUsage（Pro / Ultra 美金池）
 * 並以 /auth/usage 作為 Enterprise 請求數配額的後備資料源
 */
class QuotaService {
  constructor() {
    this._cachedQuota = null;
    this._lastFetchTime = null;
    this._inFlightPromise = null;
  }

  /**
   * 獲取當前即時額度狀態（具備 In-Flight Promise 並發防護）
   * @param {boolean} forceRefresh
   * @returns {Promise<Object>}
   */
  async getQuotaStatus(forceRefresh = false) {
    if (this._inFlightPromise) {
      return this._inFlightPromise;
    }
    this._inFlightPromise = this._executeGetQuotaStatus(forceRefresh);
    try {
      return await this._inFlightPromise;
    } finally {
      this._inFlightPromise = null;
    }
  }

  async _executeGetQuotaStatus(forceRefresh = false) {
    if (!forceRefresh && this._cachedQuota && this._lastFetchTime && (Date.now() - this._lastFetchTime < 5000)) {
      return this._cachedQuota;
    }

    try {
      const data = await this._fetchLiveQuota(forceRefresh);
      if (data?.success) {
        this._cachedQuota = data;
        this._lastFetchTime = Date.now();
        return data;
      }
      if (this._cachedQuota) {
        return this._cachedQuota;
      }
      return data || this._getFallbackQuota('正在連線至 Cursor 額度服務...');
    } catch (err) {
      console.error('[Cursor Quota] 抓取額度失敗:', err && err.message ? err.message : err);
    }

    if (this._cachedQuota) {
      return this._cachedQuota;
    }
    return this._getFallbackQuota('正在連線至 Cursor 額度服務...');
  }

  async _fetchLiveQuota(forceRefresh) {
    const account = await authService.getCachedAccount();
    let token = await authService.getAccessToken(forceRefresh);
    if (!token) {
      return this._getFallbackQuota('找不到 Cursor 登入憑證，請確認已在 Cursor 登入。');
    }

    let snapshot = await this._queryApis(token, account);
    if (snapshot.unauthorized) {
      authService.clearCache();
      token = await authService.getAccessToken(true);
      if (!token) {
        return this._getFallbackQuota('Cursor 登入已過期，請重新登入後再刷新。');
      }
      snapshot = await this._queryApis(token, account);
    }

    if (snapshot.dashboard || snapshot.authUsage) {
      return this._parseSnapshot(snapshot, account);
    }

    return this._getFallbackQuota(snapshot.error || '無法取得 Cursor 額度資料。');
  }

  async _queryApis(token, account) {
    const apiBase = 'https://api2.cursor.sh';
    const [dashboard, authUsage, stripe] = await Promise.all([
      this._rpcJson('POST', `${apiBase}${DASHBOARD_PATH}`, {
        Authorization: `Bearer ${token}`,
        'Connect-Protocol-Version': '1'
      }, {}),
      this._rpcJson('GET', `${apiBase}${AUTH_USAGE_PATH}`, {
        Authorization: `Bearer ${token}`
      }),
      account?.userId
        ? this._rpcJson('GET', STRIPE_URL, {
          Cookie: `WorkosCursorSessionToken=${account.userId}%3A%3A${token}`
        })
        : Promise.resolve({ ok: false, skipped: true })
    ]);

    const unauthorized = [dashboard, authUsage].some((r) => r.status === 401 || r.status === 403);
    return {
      unauthorized,
      dashboard: dashboard.ok ? dashboard.json : null,
      authUsage: authUsage.ok ? authUsage.json : null,
      stripe: stripe.ok ? stripe.json : null,
      error: !dashboard.ok && !authUsage.ok
        ? (dashboard.error || authUsage.error || '額度 API 無回應')
        : null
    };
  }

  _parseSnapshot(snapshot, account) {
    const stripe = snapshot.stripe || {};
    const dashboard = snapshot.dashboard || {};
    const planUsage = dashboard.planUsage || {};
    const cycleStartIso = this._toIso(dashboard.billingCycleStart);
    const cycleEndIso = this._toIso(dashboard.billingCycleEnd);

    const tierName = stripe.individualMembershipType || stripe.membershipType || account?.tier || 'Pro';
    const isPaidTier = /pro|ultra|team|enterprise/i.test(String(tierName));
    const requestBucket = this._parseRequestBucket(snapshot.authUsage);
    const hasUsdPool = this._hasUsdPool(planUsage);

    const autoUsed = this._num(planUsage.autoPercentUsed);
    const apiUsed = this._num(planUsage.apiPercentUsed);
    const totalUsed = this._num(planUsage.totalPercentUsed);

    const toRemain = (used) => (used == null ? null : Math.max(0, Math.round(100 - used)));

    const buildPool = (name, usedPct, type) => {
      if (usedPct == null) {
        return {
          exists: false,
          name,
          type,
          percent: null,
          usedPercent: null,
          resetTime: cycleEndIso,
          refreshText: '不適用',
          dailyBudget: null,
          deviation: null,
          isWarning: false
        };
      }
      const remain = toRemain(usedPct);
      return {
        exists: true,
        name,
        type,
        percent: remain,
        usedPercent: Math.round(usedPct),
        resetTime: cycleEndIso,
        refreshText: this._formatResetTime(cycleEndIso),
        dailyBudget: this.calculateDailyBudget(remain, cycleEndIso, cycleStartIso),
        deviation: this.calculateDeviation(remain, cycleEndIso, cycleStartIso),
        isWarning: remain <= 20
      };
    };

    let billingModel = 'unknown';
    let auto = buildPool('Cursor Models (Auto)', null, 'auto');
    let api = buildPool('Other Models (API)', null, 'api');
    let requests = null;

    if (hasUsdPool) {
      billingModel = 'usd_credit';
      auto = buildPool('Cursor Models (Auto)', autoUsed, 'auto');
      api = buildPool('Other Models (API)', apiUsed, 'api');
    } else if (requestBucket) {
      billingModel = 'request_count';
      const remainPct = requestBucket.max > 0
        ? Math.max(0, Math.round((1 - requestBucket.used / requestBucket.max) * 100))
        : 0;
      requests = {
        exists: true,
        used: requestBucket.used,
        max: requestBucket.max,
        percent: remainPct,
        resetTime: cycleEndIso || requestBucket.cycleStart,
        refreshText: this._formatResetTime(cycleEndIso || requestBucket.cycleEnd),
        dailyBudget: this.calculateDailyBudget(remainPct, cycleEndIso || requestBucket.cycleEnd, cycleStartIso || requestBucket.cycleStart),
        deviation: this.calculateDeviation(remainPct, cycleEndIso || requestBucket.cycleEnd, cycleStartIso || requestBucket.cycleStart),
        isWarning: remainPct <= 20
      };
    }

    const includedLimit = this._num(planUsage.limit);
    const includedSpend = this._num(planUsage.includedSpend);
    const remainingCents = this._num(planUsage.remaining);
    const usedCents = includedSpend != null
      ? includedSpend
      : (includedLimit != null && remainingCents != null ? Math.max(0, includedLimit - remainingCents) : null);

    return {
      success: true,
      billingModel,
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      account: {
        email: account?.email || '已登入',
        name: '',
        tier: this._formatTier(tierName),
        status: stripe.subscriptionStatus || account?.status || '',
        isPaidTier,
        pendingCancellationDate: stripe.pendingCancellationDate || null
      },
      billing: {
        cycleStart: cycleStartIso,
        cycleEnd: cycleEndIso
      },
      auto,
      api,
      requests,
      total: {
        usedPercent: totalUsed == null ? null : Math.round(totalUsed),
        remainPercent: toRemain(totalUsed)
      },
      included: {
        usedCents,
        limitCents: includedLimit,
        remainingCents: remainingCents != null
          ? remainingCents
          : (includedLimit != null && usedCents != null ? Math.max(0, includedLimit - usedCents) : null)
      },
      bonus: {
        spendCents: this._num(planUsage.bonusSpend),
        remainingBonus: !!planUsage.remainingBonus,
        tooltip: planUsage.bonusTooltip || ''
      },
      messages: {
        display: dashboard.displayMessage || '',
        auto: dashboard.autoModelSelectedDisplayMessage || '',
        named: dashboard.namedModelSelectedDisplayMessage || ''
      }
    };
  }

  _hasUsdPool(planUsage) {
    if (!planUsage || typeof planUsage !== 'object') return false;
    const limit = this._num(planUsage.limit);
    const pct = this._num(planUsage.totalPercentUsed);
    const autoPct = this._num(planUsage.autoPercentUsed);
    const apiPct = this._num(planUsage.apiPercentUsed);
    return (limit != null && limit > 0) || pct != null || autoPct != null || apiPct != null;
  }

  _parseRequestBucket(authUsage) {
    if (!authUsage || typeof authUsage !== 'object') return null;
    const gpt4 = authUsage['gpt-4'];
    const used = this._num(gpt4?.numRequests);
    const max = this._num(gpt4?.maxRequestUsage);
    if (used == null || max == null || max <= 0) return null;
    const cycleStart = authUsage.startOfMonth || null;
    let cycleEnd = null;
    if (cycleStart) {
      const start = new Date(cycleStart);
      if (!isNaN(start.getTime())) {
        cycleEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds())).toISOString();
      }
    }
    return { used, max, cycleStart, cycleEnd };
  }

  _formatTier(raw) {
    const key = String(raw || '').toLowerCase();
    if (key === 'pro_plus' || key === 'pro+') return 'Pro+';
    if (key === 'ultra') return 'Ultra';
    if (key === 'team') return 'Team';
    if (key === 'free') return 'Free';
    if (key === 'pro') return 'Pro';
    return raw || 'Cursor';
  }

  _num(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  _toIso(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      const n = Number(value);
      if (Number.isFinite(n)) return new Date(n).toISOString();
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /**
   * 依帳單週期勻速模型計算建議今日餘額
   */
  calculateDailyBudget(remainPercent, resetTimeIso, cycleStartIso) {
    if (remainPercent === UNLIMITED || remainPercent < 0) {
      return { isUnlimited: true, usablePercent: null, displayText: '無限制' };
    }
    const { totalMs, remainMs } = this._cycleSpan(resetTimeIso, cycleStartIso);
    if (!totalMs || remainMs == null) {
      const approx = Math.round(remainPercent / 30);
      return { isUnlimited: false, usablePercent: approx, displayText: `${approx}%` };
    }
    if (remainMs <= 0) {
      return { isUnlimited: false, usablePercent: remainPercent, displayText: `${remainPercent}%` };
    }
    const totalHours = totalMs / (1000 * 60 * 60);
    const remainHours = Math.min(totalHours, remainMs / (1000 * 60 * 60));
    const futureHours = Math.max(0, remainHours - 24);
    const reservedPercent = (futureHours / totalHours) * 100;
    const todayUsable = Math.round((remainPercent - reservedPercent) * 10) / 10;
    return {
      isUnlimited: false,
      isOverdrawn: todayUsable < 0,
      usablePercent: todayUsable,
      displayText: `${todayUsable.toFixed(1)}%`
    };
  }

  /**
   * 依帳單週期勻速模型計算偏差值（實際剩餘 - 理論剩餘）
   */
  calculateDeviation(remainPercent, resetTimeIso, cycleStartIso) {
    if (remainPercent === UNLIMITED || remainPercent < 0) {
      return { isUnlimited: true, usablePercent: null, displayText: '無限制' };
    }
    const { totalMs, remainMs } = this._cycleSpan(resetTimeIso, cycleStartIso);
    if (!totalMs || remainMs == null) {
      return { isUnlimited: false, usablePercent: 0, displayText: '+0.0%' };
    }
    if (remainMs <= 0) {
      return { isUnlimited: false, isOverdrawn: false, usablePercent: 0, displayText: '+0.0%' };
    }
    const totalMinutes = totalMs / (1000 * 60);
    const remainMinutes = Math.min(totalMinutes, Math.max(0, remainMs / (1000 * 60)));
    const theoreticalRemaining = (remainMinutes / totalMinutes) * 100;
    const deviation = Math.round((remainPercent - theoreticalRemaining) * 10) / 10;
    return {
      isUnlimited: false,
      isOverdrawn: deviation < 0,
      usablePercent: deviation,
      displayText: deviation > 0 ? `+${deviation.toFixed(1)}%` : `${deviation.toFixed(1)}%`
    };
  }

  _cycleSpan(resetTimeIso, cycleStartIso) {
    const end = resetTimeIso ? new Date(resetTimeIso).getTime() : NaN;
    if (!Number.isFinite(end)) return { totalMs: null, remainMs: null };
    const start = cycleStartIso ? new Date(cycleStartIso).getTime() : NaN;
    const totalMs = Number.isFinite(start) && end > start ? (end - start) : (30 * 24 * 60 * 60 * 1000);
    return { totalMs, remainMs: end - Date.now() };
  }

  _formatResetTime(resetTimeIso, isUnlimited = false) {
    if (isUnlimited) return '無限制';
    if (!resetTimeIso) return '額度充足';
    try {
      const targetTime = new Date(resetTimeIso).getTime();
      const diffMs = targetTime - Date.now();
      if (diffMs <= 0) return '即將重置';
      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) return `${days} 天 ${hours} 小時後重置`;
      if (hours > 0) return `${hours} 小時 ${minutes} 分鐘後重置`;
      return `${minutes} 分鐘後重置`;
    } catch (_) {
      return '計算中';
    }
  }

  _rpcJson(method, urlStr, headers, body) {
    return new Promise((resolve) => {
      const url = new URL(urlStr);
      const payload = body === undefined ? null : JSON.stringify(body ?? {});
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'cursor-quota-status/1.0.0',
          ...headers,
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          } : {})
        }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            resolve({ ok: false, status, error: `HTTP ${status}` });
            return;
          }
          try {
            resolve({ ok: true, status, json: raw ? JSON.parse(raw) : {} });
          } catch (_) {
            resolve({ ok: false, status, error: '回應不是有效 JSON' });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: '連線逾時' });
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  _getFallbackQuota(note = '') {
    return {
      success: false,
      billingModel: 'unknown',
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      note,
      account: {
        email: '連線中...',
        name: '',
        tier: 'Cursor',
        status: '',
        isPaidTier: false,
        pendingCancellationDate: null
      },
      billing: { cycleStart: null, cycleEnd: null },
      auto: {
        exists: false,
        name: 'Cursor Models (Auto)',
        percent: null,
        refreshText: '檢查中...',
        dailyBudget: { displayText: '檢查中...' },
        isWarning: false
      },
      api: {
        exists: false,
        name: 'Other Models (API)',
        percent: null,
        refreshText: '檢查中...',
        dailyBudget: { displayText: '檢查中...' },
        isWarning: false
      },
      requests: null,
      total: { usedPercent: null, remainPercent: null },
      included: { usedCents: null, limitCents: null, remainingCents: null },
      bonus: { spendCents: null, remainingBonus: false, tooltip: '' },
      messages: { display: note, auto: '', named: '' }
    };
  }
}

module.exports = new QuotaService();
