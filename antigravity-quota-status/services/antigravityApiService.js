'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const antigravityQuota = require('./antigravityQuotaService');

const UNLIMITED = -1;
const API_HOST = 'cloudcode-pa.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_PROJECT = 'aicode-consumers';
const CACHE_MS = 30000;
const TOKEN_SKEW_MS = 60000;

function readJsonFile(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** 全域 Antigravity 設定目錄（CLI 與 IDE 共用同一個 Google 登入） */
function getAcpDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity-acp');
}

function getDefaultTokenFile() {
  return path.join(getAcpDir(), 'antigravity-oauth-token');
}

function getDefaultClientFile() {
  return path.join(getAcpDir(), 'acp_token.json');
}

/**
 * 依群組名稱判斷所屬家族（Gemini / Claude+GPT）
 * @param {string} displayName
 * @returns {'gemini'|'claude'|null}
 */
function classifyGroupName(displayName) {
  const name = String(displayName || '').toLowerCase();
  if (!name) return null;
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('claude') || name.includes('gpt') || name.includes('openai')) return 'claude';
  return null;
}

/**
 * 判斷 bucket 屬於哪一種時間窗（weekly / 5h）
 * @param {Object} bucket
 * @returns {'weekly'|'5h'|null}
 */
function matchBucketWindow(bucket) {
  if (!bucket || bucket.disabled === true) return null;
  const win = String(bucket.window || '').toLowerCase().replace(/[-_\s]/g, '');
  const id = String(bucket.bucketId || '').toLowerCase();
  const title = String(bucket.displayName || '').toLowerCase();

  if (win === 'weekly' || win === 'week' || win === '7d') return 'weekly';
  if (win === '5h' || win === 'fivehour' || win === 'fivehours') return '5h';
  if (!win) {
    if (id.includes('weekly') || title.includes('weekly')) return 'weekly';
    if (id.includes('5h') || title.includes('5 hour') || title.includes('five hour')) return '5h';
  }
  return null;
}

/**
 * 把 RetrieveUserQuotaSummary 的 groups 轉成 { gemini, claude } 兩組
 * 只回報實際存在的群組，不再用 100% 假造缺漏的配額。
 * @param {Object} response RetrieveUserQuotaSummaryResponse
 * @returns {{gemini: Object|null, claude: Object|null}}
 */
function mapSummaryGroups(response) {
  const groups = Array.isArray(response?.groups) ? response.groups : [];
  const out = { gemini: null, claude: null };

  for (const group of groups) {
    const key = classifyGroupName(group?.displayName);
    if (!key || out[key]) continue;

    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    const entry = { name: group.displayName || '', weekly: null, fiveHour: null };
    for (const bucket of buckets) {
      const windowType = matchBucketWindow(bucket);
      if (!windowType || entry[windowType === 'weekly' ? 'weekly' : 'fiveHour']) continue;
      entry[windowType === 'weekly' ? 'weekly' : 'fiveHour'] = bucket;
    }
    if (entry.weekly || entry.fiveHour) out[key] = entry;
  }

  return out;
}

/**
 * 以 fetchAvailableModels 的 quotaInfo 補上摘要缺少的群組（各家模型取最小值）
 * @param {Object} models fetchAvailableModels 回傳的 models map
 * @returns {{gemini: Object|null, claude: Object|null}}
 */
function mapModelsQuota(models) {
  const out = { gemini: null, claude: null };
  if (!models || typeof models !== 'object') return out;

  for (const model of Object.values(models)) {
    const quota = model?.quotaInfo;
    if (!quota || quota.remainingFraction === undefined || quota.remainingFraction === null) continue;

    const provider = String(model?.modelProvider || '').toUpperCase();
    let key = null;
    if (provider.includes('GOOGLE')) key = 'gemini';
    else if (provider.includes('ANTHROPIC') || provider.includes('OPENAI')) key = 'claude';
    if (!key) continue;

    const frac = Number(quota.remainingFraction);
    if (!Number.isFinite(frac)) continue;

    if (!out[key]) out[key] = { name: '', weekly: null, fiveHour: null };
    const current = out[key].weekly;
    if (!current || frac < Number(current.remainingFraction)) {
      out[key].weekly = {
        bucketId: model?.model || '',
        displayName: model?.displayName || '',
        window: 'weekly',
        remainingFraction: frac,
        resetTime: quota.resetTime || null
      };
    }
  }

  return out;
}

/**
 * 合併兩種雲端來源：摘要（retrieveUserQuotaSummary）為準，缺 Claude 才用模型層配額補。
 * ⛔ 不可用 fetchAvailableModels 的 Gemini 配額補 Gemini：那是 Gemini Code Assist 的
 * project 配額，與 Antigravity 面板顯示的 Gemini 每週額度是兩套不同的東西。
 * @param {{gemini: Object|null, claude: Object|null}} summaryGroups
 * @param {{gemini: Object|null, claude: Object|null}} modelGroups
 * @returns {{gemini: Object|null, claude: Object|null}}
 */
function mergeGroupSources(summaryGroups, modelGroups) {
  return {
    gemini: summaryGroups?.gemini || null,
    claude: summaryGroups?.claude || modelGroups?.claude || null
  };
}

/**
 * Antigravity 額度服務（雲端版）
 * 直連 Google Cloud Code API（與 IDE 自己用的同一個服務），
 * 使用 ~/.gemini/antigravity-acp 的 OAuth 憑證，必要時以 refresh token 換新。
 * 這是 Antigravity IDE 1.12 以後（不再外掛本機 language server）的資料來源。
 */
class AntigravityCloudQuotaService {
  constructor() {
    this._cachedQuota = null;
    this._lastFetchTime = null;
    this._inFlightPromise = null;
    this._token = null; // { value, expiresAt }
    this._tokenFile = process.env.AI_QUOTA_TOKEN_FILE || getDefaultTokenFile();
    this._clientFile = process.env.AI_QUOTA_CLIENT_FILE || getDefaultClientFile();
  }

  /**
   * 取得目前即時額度（具備 In-Flight Promise 與短暫快取）
   * @param {boolean} forceRefresh
   * @returns {Promise<Object>}
   */
  async getQuotaStatus(forceRefresh = false) {
    if (this._inFlightPromise) return this._inFlightPromise;
    this._inFlightPromise = this._executeGetQuotaStatus(forceRefresh);
    try {
      return await this._inFlightPromise;
    } finally {
      this._inFlightPromise = null;
    }
  }

  async _executeGetQuotaStatus(forceRefresh = false) {
    if (!forceRefresh && this._cachedQuota && this._lastFetchTime && (Date.now() - this._lastFetchTime < CACHE_MS)) {
      return this._cachedQuota;
    }

    const credentials = this.readCredentials();
    if (!credentials) {
      return this._getUnavailable('找不到 Antigravity 登入憑證，請先在 Antigravity 登入（或登入 Antigravity CLI）後重新整理。');
    }

    try {
      const accessToken = await this._getAccessToken(credentials, forceRefresh);
      if (!accessToken) {
        return this._getUnavailable('Antigravity 登入憑證已失效，請重新登入後再重新整理。');
      }

      const summary = await this._post(accessToken, 'retrieveUserQuotaSummary', { project: credentials.project });
      const summaryGroups = mapSummaryGroups(summary);
      let groups = summaryGroups;

      if (!summaryGroups.claude) {
        const modelsResponse = await this._post(accessToken, 'fetchAvailableModels', { project: credentials.project });
        const modelGroups = mapModelsQuota(modelsResponse?.models);
        groups = mergeGroupSources(summaryGroups, modelGroups);
      }

      if (!groups.gemini && !groups.claude) {
        return this._getUnavailable('Google 未回傳可用配額，請稍後再試。');
      }

      const data = this.buildQuotaResult(groups, credentials);
      this._cachedQuota = data;
      this._lastFetchTime = Date.now();
      return data;
    } catch (err) {
      console.error('[AI Quota] 雲端額度查詢失敗:', err && err.message ? err.message : err);
    }

    if (this._cachedQuota) return this._cachedQuota;
    return this._getUnavailable('無法連線到 Antigravity 額度服務。');
  }

  /**
   * 讀取本機 OAuth 憑證（CLI 與 IDE 共用同一個 Google 帳號）
   * @returns {Object|null}
   */
  readCredentials() {
    const tokenFile = this._tokenFile;
    const tokenDoc = readJsonFile(tokenFile);
    const token = tokenDoc?.token || tokenDoc || null;
    const client = readJsonFile(this._clientFile) || {};

    const accessToken = token?.access_token || token?.accessToken || '';
    const refreshToken = token?.refresh_token || token?.refreshToken || client.refresh_token || '';
    if (!accessToken && !refreshToken) return null;

    const accounts = readJsonFile(path.join(os.homedir(), '.gemini', 'google_accounts.json'));
    const email = tokenDoc?.id_token_email
      || tokenDoc?.email
      || (Array.isArray(accounts?.old) ? accounts.old[0] : '')
      || '';

    return {
      accessToken,
      refreshToken,
      expiry: token?.expiry || token?.expiry_date || null,
      clientId: client.client_id || '',
      clientSecret: client.client_secret || '',
      project: client.project_id || DEFAULT_PROJECT,
      email
    };
  }

  _isTokenFresh(credentials) {
    if (!credentials.accessToken) return false;
    if (!credentials.expiry) return true;
    const expiresAt = new Date(credentials.expiry).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt - Date.now() > TOKEN_SKEW_MS;
  }

  /**
   * 取得可用的 access token（過期則用 refresh token 換新，結果只快取在記憶體）
   * @param {Object} credentials
   * @param {boolean} forceRefresh
   * @returns {Promise<string|null>}
   */
  async _getAccessToken(credentials, forceRefresh = false) {
    if (!forceRefresh && this._token && this._token.expiresAt - Date.now() > TOKEN_SKEW_MS) {
      return this._token.value;
    }
    if (this._isTokenFresh(credentials)) {
      const expiresAt = credentials.expiry ? new Date(credentials.expiry).getTime() : Date.now() + 30 * 60 * 1000;
      this._token = { value: credentials.accessToken, expiresAt };
      return credentials.accessToken;
    }
    if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
      return this._isTokenFresh(credentials) ? credentials.accessToken : null;
    }

    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token'
    }).toString();

    const res = await this._request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, body);

    if (res.status !== 200) return null;
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch (_) { return null; }
    if (!parsed?.access_token) return null;

    const expiresIn = Number(parsed.expires_in) || 3599;
    this._token = { value: parsed.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return parsed.access_token;
  }

  async _post(accessToken, method, payload) {
    const body = JSON.stringify(payload || {});
    const res = await this._request({
      hostname: API_HOST,
      path: `/v1internal:${method}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity-quota-status',
        'Content-Length': Buffer.byteLength(body)
      }
    }, body);
    if (res.status !== 200) {
      if (res.status === 401) this._token = null;
      return null;
    }
    try { return JSON.parse(res.body); } catch (_) { return null; }
  }

  _request(options, body) {
    return new Promise((resolve) => {
      const req = https.request({ ...options, timeout: 15000 }, (res) => {
        let raw = '';
        res.on('data', (chunk) => raw += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      });
      req.on('error', (err) => resolve({ status: 0, body: String(err && err.message || err) }));
      req.on('timeout', () => { req.destroy(); resolve({ status: -1, body: 'timeout' }); });
      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * 把兩組 bucket 轉成外掛既有的資料結構
   * @param {{gemini: Object|null, claude: Object|null}} groups
   * @param {Object} credentials
   * @returns {Object}
   */
  buildQuotaResult(groups, credentials = {}) {
    const buildBucket = (bucket) => {
      if (!bucket) {
        return {
          exists: false,
          percent: null,
          rawFraction: null,
          resetTime: null,
          refreshText: '不適用',
          isWarning: false
        };
      }

      let frac = bucket.remainingFraction;
      if (frac === undefined || frac === null) {
        frac = bucket.resetTime ? 0 : 1.0;
      }
      const pct = Math.round(Number(frac) * 100);
      return {
        exists: true,
        percent: pct,
        rawFraction: Number(frac),
        resetTime: bucket.resetTime || null,
        refreshText: antigravityQuota._formatResetTime(bucket.resetTime || null, pct === UNLIMITED),
        dailyBudget: antigravityQuota.calculateDailyBudget(pct, bucket.resetTime || null),
        deviation: antigravityQuota.calculateDeviation(pct, bucket.resetTime || null),
        isWarning: pct <= 20
      };
    };

    const buildGroup = (group, defaultName) => {
      const weekly = buildBucket(group?.weekly);
      const fiveHour = buildBucket(group?.fiveHour);
      let primary;
      if (weekly.exists && fiveHour.exists) {
        primary = fiveHour.percent <= weekly.percent
          ? { ...fiveHour, type: '5h' }
          : { ...weekly, type: 'weekly' };
      } else if (weekly.exists) {
        primary = { ...weekly, type: 'weekly' };
      } else if (fiveHour.exists) {
        primary = { ...fiveHour, type: '5h' };
      } else {
        primary = { exists: false, percent: null, type: 'weekly', refreshText: '不適用', isWarning: false, resetTime: null };
      }

      return {
        name: group?.name || defaultName,
        exists: !!(weekly.exists || fiveHour.exists),
        primary,
        weekly,
        fiveHour
      };
    };

    return {
      success: true,
      detailSource: 'cloud-api',
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      account: {
        email: credentials.email || '已登入',
        name: '',
        tier: 'Antigravity',
        isPaidTier: true
      },
      gemini: buildGroup(groups.gemini, 'Gemini Models'),
      claude: buildGroup(groups.claude, 'Claude and GPT models')
    };
  }

  _getUnavailable(note) {
    const emptyGroup = (name) => ({
      name,
      exists: false,
      primary: { exists: false, percent: null, type: 'weekly', refreshText: '無法取得', isWarning: false, resetTime: null },
      weekly: { exists: false, percent: null, rawFraction: null, resetTime: null, refreshText: '無法取得', isWarning: false },
      fiveHour: { exists: false, percent: null, rawFraction: null, resetTime: null, refreshText: '不適用', isWarning: false }
    });

    return {
      success: false,
      detailSource: 'cloud-api',
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      note,
      account: { email: '—', name: '', tier: 'Antigravity', isPaidTier: false },
      gemini: emptyGroup('Gemini Models'),
      claude: emptyGroup('Claude and GPT models')
    };
  }
}

const service = new AntigravityCloudQuotaService();
service.AntigravityCloudQuotaService = AntigravityCloudQuotaService;
service.mapSummaryGroups = mapSummaryGroups;
service.mapModelsQuota = mapModelsQuota;
service.mergeGroupSources = mergeGroupSources;
service.classifyGroupName = classifyGroupName;
service.matchBucketWindow = matchBucketWindow;

module.exports = service;
