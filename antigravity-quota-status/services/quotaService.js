const { exec } = require('node:child_process');
const https = require('node:https');

const UNLIMITED = -1; // -1 代表付費版或無限制額度

/**
 * AI 模型額度狀態服務 (Quota Service)
 * 直連 Antigravity IDE 內部的 Language Server 即時 gRPC-Web 服務
 * 支援付費版/免費版的每週配額 (Weekly Limit) 與 5 小時配額 (Five Hour Limit) 雙層監控
 */
class QuotaService {
  constructor() {
    this._cachedQuota = null;
    this._lastFetchTime = null;
    this._cachedConnection = null; // { port, csrf, pid }
  }

  /**
   * 獲取當前即時額度狀態
   * @param {boolean} forceRefresh 是否強制重新向 Language Server 查詢
   * @returns {Promise<Object>}
   */
  async getQuotaStatus(forceRefresh = false) {
    // 強制刷新時一併清除連線快取，確保帳號切換後重新掃描新 Language Server
    if (forceRefresh) {
      this._cachedConnection = null;
    }
    if (!forceRefresh && this._cachedQuota && this._lastFetchTime && (Date.now() - this._lastFetchTime < 5000)) {
      return this._cachedQuota;
    }

    try {
      const data = await this._fetchFromLanguageServer();
      if (data) {
        this._cachedQuota = data;
        this._lastFetchTime = Date.now();
        return data;
      }
    } catch (err) {
      console.error('[AI Quota] 抓取額度失敗:', err);
    }

    if (this._cachedQuota) {
      return this._cachedQuota;
    }

    return this._getFallbackQuota('正在連線至本地語言伺服器...');
  }

  /**
   * 從本地 Language Server 抓取資料
   * @private
   */
  async _fetchFromLanguageServer() {
    if (this._cachedConnection) {
      const fastResult = await this._tryFetchFromPort(this._cachedConnection.port, this._cachedConnection.csrf);
      if (fastResult) {
        return fastResult;
      }
      this._cachedConnection = null;
    }

    const procs = await this._getLsProcesses();
    if (!procs || procs.length === 0) {
      return null;
    }

    for (const proc of procs) {
      const ports = await this._getListeningPorts(proc.pid);
      for (const port of ports) {
        const result = await this._tryFetchFromPort(port, proc.csrf);
        if (result) {
          this._cachedConnection = { port, csrf: proc.csrf, pid: proc.pid };
          return result;
        }
      }
    }

    return null;
  }

  /**
   * 向指定連接埠發送 RPC 請求
   * @private
   */
  async _tryFetchFromPort(port, csrf) {
    try {
      // 1. 優先使用 IDE 官方底層 RetrieveUserQuotaSummary (包含精確的 4 項目雙層配額)
      const [quotaSummaryData, userStatusData] = await Promise.all([
        this._rpcCall(port, csrf, 'RetrieveUserQuotaSummary'),
        this._rpcCall(port, csrf, 'GetUserStatus')
      ]);

      if (quotaSummaryData?.response?.groups && quotaSummaryData.response.groups.length > 0) {
        return this._parseQuotaSummary(quotaSummaryData.response, userStatusData?.userStatus);
      }

      // 2. Fallback: 使用 GetCascadeModelConfigData 兼容舊版
      const modelConfigData = await this._rpcCall(port, csrf, 'GetCascadeModelConfigData');
      if (modelConfigData?.clientModelConfigs) {
        return this._parseFallbackModelConfigs(modelConfigData.clientModelConfigs, userStatusData?.userStatus);
      }
    } catch (_) {}
    return null;
  }

  /**
   * 取得所有 Language Server 的 PID 與 CSRF Token
   * @private
   */
  _getLsProcesses() {
    return new Promise((resolve) => {
      const cmd = `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'language_server_windows_x64.exe'\\" | Sort-Object CreationDate -Descending | Select-Object ProcessId, CommandLine | ConvertTo-Json"`;
      exec(cmd, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          let parsed = JSON.parse(stdout.trim());
          if (!Array.isArray(parsed)) parsed = [parsed];
          const list = [];
          for (const item of parsed) {
            const csrfMatch = item.CommandLine ? item.CommandLine.match(/--csrf_token\s+([a-f0-9-]+)/) : null;
            if (csrfMatch && item.ProcessId) {
              list.push({ pid: item.ProcessId, csrf: csrfMatch[1] });
            }
          }
          resolve(list);
        } catch {
          resolve([]);
        }
      });
    });
  }

  /**
   * 取得指定 PID 所監聽的 TCP 本地埠口清單
   * @private
   */
  _getListeningPorts(pid) {
    return new Promise((resolve) => {
      const cmd = `powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort"`;
      exec(cmd, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const ports = stdout.trim().split(/\r?\n/).map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p));
        resolve(ports);
      });
    });
  }

  /**
   * 通用 RPC 呼叫
   * @private
   */
  _rpcCall(port, csrf, methodName) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        metadata: {
          ideName: 'antigravity-ide',
          extensionVersion: '0.2.0'
        }
      });

      const req = https.request({
        hostname: '127.0.0.1',
        port: port,
        path: `/exa.language_server_pb.LanguageServerService/${methodName}`,
        method: 'POST',
        rejectUnauthorized: false,
        timeout: 3000,
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf,
          'connect-protocol-version': '1',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * 解析官方 RetrieveUserQuotaSummary 結構 (最準確的雙層配額資料源)
   * @private
   */
  _parseQuotaSummary(summaryResponse, userStatus) {
    const email = userStatus?.email || '已登入';
    const name = userStatus?.name || '';
    const tierName = userStatus?.planStatus?.planInfo?.planName || userStatus?.userTier?.name || 'Pro';
    const isPaidTier = !userStatus?.userTier?.id?.includes('free') && /pro|team|enterprise|ultimate/i.test(tierName);

    const groups = summaryResponse?.groups || [];
    let geminiGroup = null;
    let claudeGroup = null;

    for (const g of groups) {
      const gName = (g.displayName || '').toLowerCase();
      if (gName.includes('gemini')) {
        geminiGroup = g;
      } else if (gName.includes('claude') || gName.includes('gpt')) {
        claudeGroup = g;
      }
    }

    const extractBucket = (group, windowType) => {
      const targetWindow = (windowType || '').toLowerCase();
      const bucket = group?.buckets?.find(b => {
        const win = (b.window || '').toLowerCase();
        const id = (b.bucketId || '').toLowerCase();
        const title = (b.displayName || '').toLowerCase();
        return win === targetWindow || id.includes(targetWindow) || title.includes(targetWindow);
      });

      if (!bucket) {
        const isWeekly = targetWindow === 'weekly';
        // 若該帳號方案根本未提供 5 小時配額 (例如非 Pro 帳號)，標記為 exists: false
        if (!isWeekly) {
          return {
            exists: false,
            percent: null,
            rawFraction: null,
            resetTime: null,
            refreshText: '不適用',
            dailyBudget: null,
            deviation: null,
            isWarning: false
          };
        }

        // 若為每週配額但找不到，嘗試歷史快取
        const groupKey = (group?.displayName || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
        const cachedGroup = this._cachedQuota?.[groupKey];
        const cachedBucket = cachedGroup?.weekly;

        if (cachedBucket && cachedBucket.percent !== undefined && cachedBucket.percent !== UNLIMITED && cachedBucket.percent !== -1) {
          return {
            ...cachedBucket,
            exists: true,
            refreshText: cachedBucket.refreshText || '額度充足'
          };
        }

        return {
          exists: true,
          percent: 100,
          rawFraction: 1.0,
          resetTime: null,
          refreshText: '額度充足',
          dailyBudget: { isUnlimited: false, usablePercent: 100, displayText: '100%' },
          deviation: { isUnlimited: false, usablePercent: 0, displayText: '+0.0%' },
          isWarning: false
        };
      }

      let frac = bucket.remainingFraction;
      // proto3 0 值缺省處理：若無 remainingFraction 但有 resetTime，代表 0% 額度用盡
      if (frac === undefined || frac === null) {
        frac = bucket.resetTime ? 0 : 1.0;
      }

      const pct = Math.round(frac * 100);
      return {
        exists: true,
        percent: pct,
        rawFraction: frac,
        resetTime: bucket.resetTime || null,
        refreshText: this._formatResetTime(bucket.resetTime, pct === UNLIMITED),
        dailyBudget: this.calculateDailyBudget(pct, bucket.resetTime || null),
        deviation: this.calculateDeviation(pct, bucket.resetTime || null),
        isWarning: pct <= 20
      };
    };

    const gWk = extractBucket(geminiGroup, 'weekly');
    const g5h = extractBucket(geminiGroup, '5h');
    const cWk = extractBucket(claudeGroup, 'weekly');
    const c5h = extractBucket(claudeGroup, '5h');

    // 計算主要即時受限配額 (Primary Active Quota: 取較低/有實質約束的那個)
    const getPrimary = (bWk, b5h, defaultType = 'weekly') => {
      if (bWk?.exists && b5h?.exists && bWk.percent !== null && b5h.percent !== null) {
        return b5h.percent <= bWk.percent
          ? { ...b5h, type: '5h' }
          : { ...bWk, type: 'weekly' };
      }
      if (bWk?.exists && bWk.percent !== null) return { ...bWk, type: 'weekly' };
      if (b5h?.exists && b5h.percent !== null) return { ...b5h, type: '5h' };
      return { exists: false, percent: 100, type: defaultType, refreshText: '額度充足', isWarning: false, resetTime: null };
    };

    const gPri = getPrimary(gWk, g5h, 'weekly');
    const cPri = getPrimary(cWk, c5h, 'weekly');

    return {
      success: true,
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      account: {
        email: email,
        name: name,
        tier: tierName,
        isPaidTier: isPaidTier
      },
      gemini: {
        name: geminiGroup?.displayName || 'Gemini Models',
        primary: gPri,
        weekly: gWk,
        fiveHour: g5h
      },
      claude: {
        name: claudeGroup?.displayName || 'Claude and GPT models',
        primary: cPri,
        weekly: cWk,
        fiveHour: c5h
      }
    };
  }

  /**
   * Fallback: 解析 GetCascadeModelConfigData
   * @private
   */
  _parseFallbackModelConfigs(clientModels, userStatus) {
    const email = userStatus?.email || '已登入';
    const name = userStatus?.name || '';
    const tierName = userStatus?.planStatus?.planInfo?.planName || userStatus?.userTier?.name || 'Pro';
    const isPaidTier = !userStatus?.userTier?.id?.includes('free') && /pro|team|enterprise|ultimate/i.test(tierName);

    // 優先繼承歷史快取的每週配額與重置時間（Last Known Good State）
    const cachedGeminiWeekly = this._cachedQuota?.gemini?.weekly;
    const cachedClaudeWeekly = this._cachedQuota?.claude?.weekly;

    let geminiFiveHourFraction = UNLIMITED;
    let geminiFiveHourReset = null;
    let geminiWeeklyFraction = (cachedGeminiWeekly && cachedGeminiWeekly.rawFraction !== undefined && cachedGeminiWeekly.rawFraction !== UNLIMITED && cachedGeminiWeekly.rawFraction !== -1)
      ? cachedGeminiWeekly.rawFraction
      : 1.0;
    let geminiWeeklyReset = cachedGeminiWeekly?.resetTime || null;

    let claudeFiveHourFraction = UNLIMITED;
    let claudeFiveHourReset = null;
    let claudeWeeklyFraction = (cachedClaudeWeekly && cachedClaudeWeekly.rawFraction !== undefined && cachedClaudeWeekly.rawFraction !== UNLIMITED && cachedClaudeWeekly.rawFraction !== -1)
      ? cachedClaudeWeekly.rawFraction
      : 1.0;
    let claudeWeeklyReset = cachedClaudeWeekly?.resetTime || null;

    const extractFraction = (quota) => {
      if (quota.remainingFraction !== undefined && quota.remainingFraction !== null) {
        return Number(quota.remainingFraction);
      }
      if (quota.resetTime) return 0;
      return null;
    };

    for (const model of clientModels) {
      const label = model.label || '';
      const quota = model.quotaInfo;
      if (!quota) continue;

      const fraction = extractFraction(quota);
      const resetIso = quota.resetTime || '';
      const isShortTerm = this._isShortTermReset(resetIso);

      if (label.includes('Gemini')) {
        if (fraction !== null) {
          if (isShortTerm) {
            geminiFiveHourFraction = geminiFiveHourFraction === UNLIMITED ? fraction : Math.min(geminiFiveHourFraction, fraction);
            geminiFiveHourReset = resetIso;
          } else {
            geminiWeeklyFraction = geminiWeeklyFraction === UNLIMITED ? fraction : Math.min(geminiWeeklyFraction, fraction);
            geminiWeeklyReset = resetIso;
          }
        }
      } else if (label.includes('Claude') || label.includes('GPT')) {
        if (fraction !== null) {
          if (isShortTerm) {
            claudeFiveHourFraction = claudeFiveHourFraction === UNLIMITED ? fraction : Math.min(claudeFiveHourFraction, fraction);
            claudeFiveHourReset = resetIso;
          } else {
            claudeWeeklyFraction = Math.min(claudeWeeklyFraction, fraction);
            claudeWeeklyReset = resetIso;
          }
        }
      }
    }

    const toPercent = (f) => (f === UNLIMITED || f === null) ? UNLIMITED : Math.round(f * 100);
    const gemini5hPct = toPercent(geminiFiveHourFraction);
    const geminiWeeklyPct = toPercent(geminiWeeklyFraction);
    const claude5hPct = toPercent(claudeFiveHourFraction);
    const claudeWeeklyPct = toPercent(claudeWeeklyFraction);

    const cachedG5hExists = this._cachedQuota?.gemini?.fiveHour?.exists;
    const cachedC5hExists = this._cachedQuota?.claude?.fiveHour?.exists;
    const geminiHas5h = cachedG5hExists !== undefined ? cachedG5hExists : (geminiFiveHourFraction !== UNLIMITED && geminiFiveHourReset !== null);
    const claudeHas5h = cachedC5hExists !== undefined ? cachedC5hExists : (claudeFiveHourFraction !== UNLIMITED && claudeFiveHourReset !== null);

    const getFallbackPrimary = (pctWk, resetWk, has5h, pct5h, reset5h, defaultType = 'weekly') => {
      if (pctWk !== UNLIMITED && has5h && pct5h !== UNLIMITED) {
        return pct5h <= pctWk
          ? { exists: true, percent: pct5h, type: '5h', refreshText: this._formatResetTime(reset5h), resetTime: reset5h, isWarning: pct5h <= 20 }
          : { exists: true, percent: pctWk, type: 'weekly', refreshText: this._formatResetTime(resetWk, pctWk === UNLIMITED), resetTime: resetWk, isWarning: pctWk <= 20 };
      }
      if (pctWk !== UNLIMITED) {
        return { exists: true, percent: pctWk, type: 'weekly', refreshText: this._formatResetTime(resetWk, pctWk === UNLIMITED), resetTime: resetWk, isWarning: pctWk <= 20 };
      }
      if (has5h && pct5h !== UNLIMITED) {
        return { exists: true, percent: pct5h, type: '5h', refreshText: this._formatResetTime(reset5h), resetTime: reset5h, isWarning: pct5h <= 20 };
      }
      return { exists: false, percent: 100, type: defaultType, refreshText: '額度充足', isWarning: false, resetTime: null };
    };

    const gPri = getFallbackPrimary(geminiWeeklyPct, geminiWeeklyReset, geminiHas5h, gemini5hPct, geminiFiveHourReset, 'weekly');
    const cPri = getFallbackPrimary(claudeWeeklyPct, claudeWeeklyReset, claudeHas5h, claude5hPct, claudeFiveHourReset, 'weekly');

    return {
      success: true,
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      account: { email, name, tier: tierName, isPaidTier },
      gemini: {
        name: 'Gemini Models',
        primary: gPri,
        fiveHour: {
          exists: geminiHas5h,
          percent: geminiHas5h ? gemini5hPct : null,
          rawFraction: geminiHas5h ? geminiFiveHourFraction : null,
          refreshText: geminiHas5h ? this._formatResetTime(geminiFiveHourReset) : '不適用',
          resetTime: geminiHas5h ? geminiFiveHourReset : null,
          isWarning: geminiHas5h ? gemini5hPct <= 20 : false
        },
        weekly: {
          exists: true,
          percent: geminiWeeklyPct,
          rawFraction: geminiWeeklyFraction,
          refreshText: this._formatResetTime(geminiWeeklyReset, geminiWeeklyPct === UNLIMITED),
          resetTime: geminiWeeklyReset,
          dailyBudget: this.calculateDailyBudget(geminiWeeklyPct, geminiWeeklyReset),
          deviation: this.calculateDeviation(geminiWeeklyPct, geminiWeeklyReset),
          isWarning: geminiWeeklyPct <= 20
        }
      },
      claude: {
        name: 'Claude and GPT models',
        primary: cPri,
        fiveHour: {
          exists: claudeHas5h,
          percent: claudeHas5h ? claude5hPct : null,
          rawFraction: claudeHas5h ? claudeFiveHourFraction : null,
          refreshText: claudeHas5h ? this._formatResetTime(claudeFiveHourReset) : '不適用',
          resetTime: claudeHas5h ? claudeFiveHourReset : null,
          isWarning: claudeHas5h ? claude5hPct <= 20 : false
        },
        weekly: {
          exists: true,
          percent: claudeWeeklyPct,
          rawFraction: claudeWeeklyFraction,
          refreshText: this._formatResetTime(claudeWeeklyReset),
          resetTime: claudeWeeklyReset,
          dailyBudget: this.calculateDailyBudget(claudeWeeklyPct, claudeWeeklyReset),
          deviation: this.calculateDeviation(claudeWeeklyPct, claudeWeeklyReset),
          isWarning: claudeWeeklyPct <= 20
        }
      }
    };
  }

  /**
   * 計算每週額度的「建議今日餘額」（依每週 168 小時勻速消耗模型精密計算）
   * 保留給未來天數的安全基準配額，計算當日安全可用上限
   * @param {number} weeklyPercent 當前每週剩餘百分比
   * @param {string|null} resetTimeIso 重置時間 ISO 字串
   * @returns {Object} { isUnlimited, isOverdrawn, usablePercent, displayText }
   */
  calculateDailyBudget(weeklyPercent, resetTimeIso) {
    if (weeklyPercent === UNLIMITED || weeklyPercent < 0) {
      return {
        isUnlimited: true,
        usablePercent: null,
        displayText: '無限制'
      };
    }

    if (!resetTimeIso) {
      const approx = Math.round(weeklyPercent / 7);
      return {
        isUnlimited: false,
        usablePercent: approx,
        displayText: `${approx}%`
      };
    }

    try {
      const targetTime = new Date(resetTimeIso).getTime();
      const now = Date.now();
      const diffMs = targetTime - now;

      if (diffMs <= 0) {
        return {
          isUnlimited: false,
          usablePercent: weeklyPercent,
          displayText: `${weeklyPercent}%`
        };
      }

      const totalHours = 168; // 每週 7 天 = 168 小時
      const remainHours = Math.min(totalHours, Math.max(0, diffMs / (1000 * 60 * 60)));

      // 保留給未來天數 (24 小時之後) 的安全基準配額
      const futureHours = Math.max(0, remainHours - 24);
      const reservedPercent = (futureHours / totalHours) * 100;

      // 建議今日餘額 = 當前剩餘 - 未來需保留額度
      const todayUsable = Math.round((weeklyPercent - reservedPercent) * 10) / 10;

      return {
        isUnlimited: false,
        isOverdrawn: todayUsable < 0,
        usablePercent: todayUsable,
        displayText: `${todayUsable.toFixed(1)}%`
      };
    } catch (_) {
      const approx = Math.round(weeklyPercent / 7);
      return {
        isUnlimited: false,
        usablePercent: approx,
        displayText: `${approx}%`
      };
    }
  }

  /**
   * 計算每週額度的「偏差值」（依每週 10080 分鐘勻速消耗模型精密計算）
   * 公式：
   * 一週總分鐘數 = 10080 (7 * 24 * 60)
   * 剩餘分鐘數 = resetTimeIso - now
   * 每分鐘額度 = 100 / 10080
   * 理論花掉額度 = (10080 - 剩餘分鐘數) * 每分鐘額度
   * 理論剩餘額度 = 100 - 理論花掉額度 = 剩餘分鐘數 * 每分鐘額度
   * 偏差值 = 實際剩餘額度 - 理論剩餘額度
   *
   * @param {number} weeklyPercent 當前每週剩餘百分比
   * @param {string|null} resetTimeIso 重置時間 ISO 字串
   * @returns {Object} { isUnlimited, isOverdrawn, usablePercent, displayText }
   */
  calculateDeviation(weeklyPercent, resetTimeIso) {
    if (weeklyPercent === UNLIMITED || weeklyPercent < 0) {
      return {
        isUnlimited: true,
        usablePercent: null,
        displayText: '無限制'
      };
    }

    if (!resetTimeIso) {
      return {
        isUnlimited: false,
        usablePercent: 0,
        displayText: '+0.0%'
      };
    }

    try {
      const targetTime = new Date(resetTimeIso).getTime();
      const now = Date.now();
      const diffMs = targetTime - now;

      if (diffMs <= 0) {
        return {
          isUnlimited: false,
          isOverdrawn: false,
          usablePercent: 0,
          displayText: '+0.0%'
        };
      }

      const totalMinutes = 10080; // 7 天 * 24 小時 * 60 分鐘 = 10080
      const remainMinutes = Math.min(totalMinutes, Math.max(0, diffMs / (1000 * 60)));
      const perMinuteQuota = 100 / totalMinutes;
      const theoreticalRemaining = remainMinutes * perMinuteQuota;

      // 偏差值 = 實際剩餘額度 - 理論剩餘額度
      const deviation = Math.round((weeklyPercent - theoreticalRemaining) * 10) / 10;
      const formattedText = deviation > 0 ? `+${deviation.toFixed(1)}%` : `${deviation.toFixed(1)}%`;

      return {
        isUnlimited: false,
        isOverdrawn: deviation < 0,
        usablePercent: deviation,
        displayText: formattedText
      };
    } catch (_) {
      return {
        isUnlimited: false,
        usablePercent: 0,
        displayText: '+0.0%'
      };
    }
  }

  /**
   * 判斷是否為 5 小時內之短期重置
   * @private
   */
  _isShortTermReset(resetTimeIso) {
    if (!resetTimeIso) return true;
    try {
      const targetTime = new Date(resetTimeIso).getTime();
      const now = Date.now();
      const diffHours = (targetTime - now) / (1000 * 60 * 60);
      return diffHours <= 6; // 小於等於 6 小時視為 5-Hour 額度
    } catch {
      return true;
    }
  }

  /**
   * 格式化倒數時間
   * @param {string|null} resetTimeIso 重置時間 ISO 字串
   * @param {boolean} isUnlimited 是否為無限制
   * @param {string} fallbackText 無 resetTime 時的回退文字
   * @private
   */
  _formatResetTime(resetTimeIso, isUnlimited = false, fallbackText = '額度充足') {
    if (isUnlimited) return '無限制';
    if (!resetTimeIso) return fallbackText;

    try {
      const targetTime = new Date(resetTimeIso).getTime();
      const now = Date.now();
      const diffMs = targetTime - now;

      if (diffMs <= 0) {
        return '即將重置';
      }

      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;

      if (days > 0) {
        return `${days} 天 ${hours} 小時後重置`;
      } else if (hours > 0) {
        return `${hours} 小時 ${minutes} 分鐘後重置`;
      } else {
        return `${minutes} 分鐘後重置`;
      }
    } catch (_) {
      return '計算中';
    }
  }

  /**
   * 預設回退結構
   * @private
   */
  _getFallbackQuota(note = '') {
    return {
      success: false,
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      note: note,
      account: {
        email: '連線中...',
        name: '',
        tier: 'Standard',
        isPaidTier: false
      },
      gemini: {
        name: 'Gemini Models',
        primary: { exists: true, percent: 100, type: 'weekly', refreshText: '檢查中...', isWarning: false },
        fiveHour: { exists: false, percent: null, refreshText: '檢查中...', isWarning: false },
        weekly: { exists: true, percent: 100, refreshText: '檢查中...', dailyBudget: { displayText: '檢查中...' }, isWarning: false }
      },
      claude: {
        name: 'Claude and GPT models',
        primary: { exists: true, percent: 100, type: 'weekly', refreshText: '檢查中...', isWarning: false },
        fiveHour: { exists: false, percent: null, refreshText: '檢查中...', isWarning: false },
        weekly: { exists: true, percent: 100, refreshText: '檢查中...', dailyBudget: { displayText: '檢查中...' }, isWarning: false }
      }
    };
  }
}

module.exports = new QuotaService();
