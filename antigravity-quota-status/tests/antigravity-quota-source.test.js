// ==============================================================================
// 檔案名稱：tests/antigravity-quota-source.test.js
// 功能說明：Antigravity 額度資料源的迴歸測試（零相依、不打網路、不讀真實憑證）
//   驗證重點：
//     1. Antigravity IDE 1.12 起，額度由本機語言伺服器（agy.exe，hub 狀態檔
//        ~/.gemini/antigravity/daemon/hub_*.json 提供 port／csrf）回傳，與 IDE 面板同源；
//        取不到才退回 Cloud Code API（retrieveUserQuotaSummary / fetchAvailableModels）
//     2. 只有真的回傳的群組才算存在；缺漏不得再用 100% 假造
//     3. 取不到任何資料時回 success:false，狀態列必須顯示「無法取得」而不是 100%
//     4. 語言伺服器休眠時沿用最後一次成功值的快照（標記 stale），不退回假 100%
//   執行：node tests/antigravity-quota-source.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_ROOT = path.join(os.tmpdir(), 'antigravity-quota-source-test');

// ── vscode stub（只有 quotaService 這個門面會用到） ─────────────────────────
const vscodeStub = {
  env: { appName: 'Antigravity IDE' },
  workspace: {
    getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue })
  }
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.apply(this, arguments);
};

const api = require(path.join(EXT_ROOT, 'services', 'antigravityApiService.js'));
const local = require(path.join(EXT_ROOT, 'services', 'antigravityQuotaService.js'));
const facade = require(path.join(EXT_ROOT, 'services', 'quotaService.js'));

// 真實帳號回傳的形狀（2026-11-24 實測，值已改寫成測試夾具）
const REAL_SUMMARY = {
  groups: [
    {
      displayName: 'Claude and GPT models',
      description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
      buckets: [
        {
          bucketId: '3p-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          resetTime: '2030-12-01T12:19:27Z',
          remainingFraction: 0.9
        }
      ]
    }
  ]
};

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', `${label} :: ${e.message}`]);
  }
};

async function main() {
  await check('Q1 摘要只回 Claude 群組時，Gemini 不得憑空生成', async () => {
    const groups = api.mapSummaryGroups(REAL_SUMMARY);
    assert.strictEqual(groups.claude.name, 'Claude and GPT models');
    assert.ok(groups.claude.weekly, 'Claude 週配額應存在');
    assert.strictEqual(groups.claude.fiveHour, null, '沒有 5h bucket 就不該有 5h');
    assert.strictEqual(groups.gemini, null, 'Gemini 未回傳應為 null');
  });

  await check('Q2 週配額與 5 小時配額並存時，primary 取較低者', async () => {
    const groups = api.mapSummaryGroups({
      groups: [{
        displayName: 'Gemini Models',
        buckets: [
          { bucketId: 'g-weekly', displayName: 'Weekly', window: 'weekly', remainingFraction: 0.8, resetTime: '2030-12-01T00:00:00Z' },
          { bucketId: 'g-5h', displayName: 'Five Hour', window: '5h', remainingFraction: 0.3, resetTime: '2030-11-25T00:00:00Z' }
        ]
      }]
    });
    assert.ok(groups.gemini.weekly && groups.gemini.fiveHour);
    const built = api.buildQuotaResult(groups, { email: 'test@example.com' });
    assert.strictEqual(built.gemini.weekly.percent, 80);
    assert.strictEqual(built.gemini.fiveHour.percent, 30);
    assert.strictEqual(built.gemini.primary.type, '5h');
    assert.strictEqual(built.gemini.primary.isWarning, false, '30% 還不到 20% 警戒線');
  });

  await check('Q3 disabled 或不認識的 window 不得算成配額', async () => {
    assert.strictEqual(api.matchBucketWindow({ window: 'weekly', disabled: true }), null);
    assert.strictEqual(api.matchBucketWindow({ window: 'monthly' }), null);
    assert.strictEqual(api.matchBucketWindow({ bucketId: '3p-weekly' }), 'weekly');
    assert.strictEqual(api.matchBucketWindow({ bucketId: '3p-5h' }), '5h');

    const groups = api.mapSummaryGroups({
      groups: [{
        displayName: 'Claude and GPT models',
        buckets: [{ bucketId: 'x', window: 'weekly', disabled: true, remainingFraction: 0.1 }]
      }]
    });
    assert.strictEqual(groups.claude, null, '全部 bucket 停用時整組不算存在');
  });

  await check('Q4 沒有週配額的群組不得顯示 100%', async () => {
    const groups = api.mapSummaryGroups({
      groups: [{
        displayName: 'Gemini Models',
        buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.5, resetTime: '2030-11-25T00:00:00Z' }]
      }]
    });
    const built = api.buildQuotaResult(groups, {});
    assert.strictEqual(built.gemini.weekly.exists, false);
    assert.strictEqual(built.gemini.weekly.percent, null);
    assert.strictEqual(built.gemini.primary.type, '5h');
    assert.strictEqual(built.claude.exists, false, 'Claude 未回傳時不該有資料');
    assert.strictEqual(built.claude.weekly.percent, null);
  });

  await check('Q5 fetchAvailableModels 只補 Claude，Gemini 不得由模型層配額補上', async () => {
    const models = api.mapModelsQuota({
      'gemini-3-flash': { modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.7, resetTime: '2030-12-01T00:00:00Z' } },
      'gemini-3.8-flash-tiered': { modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.5, resetTime: '2030-12-01T00:00:00Z' } },
      'claude-sonnet-4-6': { modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { remainingFraction: 0.9, resetTime: '2030-12-01T00:00:00Z' } },
      'tab_flash_lite_preview': { modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: {} }
    });
    assert.ok(groupsOf(models).includes('gemini'));
    assert.strictEqual(Math.round(models.gemini.weekly.remainingFraction * 100), 50);
    assert.strictEqual(Math.round(models.claude.weekly.remainingFraction * 100), 90);

    const merged = api.mergeGroupSources({ gemini: null, claude: null }, models);
    assert.strictEqual(merged.gemini, null, '模型層 Gemini 配額屬於 Gemini Code Assist，不可拿來冒充 Antigravity 額度');
    assert.ok(merged.claude, '摘要缺 Claude 時才用模型層補');

    const keep = api.mergeGroupSources({ gemini: null, claude: { name: 'Claude and GPT models', weekly: {}, fiveHour: null } }, models);
    assert.strictEqual(keep.claude.name, 'Claude and GPT models', '摘要已有 Claude 時以摘要為準');
  });

  await check('Q6 本機 language server 解析：缺週配額不得假造 100%', async () => {
    const parsed = local._parseQuotaSummary({
      groups: [{
        displayName: 'Gemini Models',
        buckets: [{ bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.4, resetTime: '2030-11-25T00:00:00Z' }]
      }]
    }, { email: 'test@example.com' });
    assert.ok(parsed, '應回傳解析結果');
    assert.strictEqual(parsed.gemini.weekly.exists, false);
    assert.strictEqual(parsed.gemini.weekly.percent, null);
    assert.strictEqual(parsed.gemini.fiveHour.percent, 40);
  });

  await check('Q7 本機 language server 解析：完全認不出群組時回 null（換資料源）', async () => {
    const parsed = local._parseQuotaSummary({
      groups: [{ displayName: 'Some New Family', buckets: [{ bucketId: 'x', window: 'weekly', remainingFraction: 1 }] }]
    }, {});
    assert.strictEqual(parsed, null);
    assert.strictEqual(local._parseQuotaSummary({ groups: [] }, {}), null);
  });

  await check('Q8 完全取不到資料時，回 unavailable 而不是 100%', async () => {
    const fallback = local._getFallbackQuota('測試用：連不到語言伺服器');
    assert.strictEqual(fallback.success, false);
    assert.strictEqual(fallback.gemini.weekly.percent, null);
    assert.strictEqual(fallback.claude.primary.percent, null);
    assert.strictEqual(fallback.note, '測試用：連不到語言伺服器');

    const unavailable = api._getUnavailable('沒有憑證');
    assert.strictEqual(unavailable.success, false);
    assert.strictEqual(unavailable.gemini.weekly.percent, null);
    assert.strictEqual(unavailable.claude.weekly.percent, null);
    assert.strictEqual(local.calculateDailyBudget(null, null).displayText, '—');
    assert.strictEqual(local.calculateDeviation(null, null).displayText, '—');
  });

  await check('Q9 讀取 ~/.gemini/antigravity-acp 憑證（含 client 與 email）', async () => {
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
    const tokenFile = path.join(FIXTURE_ROOT, 'antigravity-oauth-token');
    const clientFile = path.join(FIXTURE_ROOT, 'acp_token.json');
    fs.writeFileSync(tokenFile, JSON.stringify({
      token: { access_token: 'ya29.fake', refresh_token: '1//fake', expiry: '2030-01-01T00:00:00Z' },
      id_token_email: 'tester@example.com'
    }));
    fs.writeFileSync(clientFile, JSON.stringify({
      client_id: 'cid', client_secret: 'csecret', project_id: 'aicode-consumers', refresh_token: '1//fake'
    }));

    const svc = new api.AntigravityCloudQuotaService();
    svc._tokenFile = tokenFile;
    svc._clientFile = clientFile;
    const creds = svc.readCredentials();
    assert.ok(creds, '應讀到憑證');
    assert.strictEqual(creds.email, 'tester@example.com');
    assert.strictEqual(creds.clientId, 'cid');
    assert.strictEqual(creds.project, 'aicode-consumers');
    assert.strictEqual(svc._isTokenFresh(creds), true, '未過期的 access token 應直接可用');
    assert.strictEqual(svc._isTokenFresh({ ...creds, expiry: '2000-01-01T00:00:00Z' }), false, '過期需換新');
  });

  await check('Q10 門面：本機語言伺服器優先（與 IDE 同源），失敗才退回雲端 API', async () => {
    const cloudSaved = { get: api.getQuotaStatus, cached: api._cachedQuota, t: api._lastFetchTime };
    const localSaved = local.getQuotaStatus;

    const localOk = { success: true, detailSource: 'language-server', gemini: { primary: { percent: 91 } }, claude: { primary: { percent: 100 } } };
    local.getQuotaStatus = async () => localOk;
    api.getQuotaStatus = async () => { throw new Error('本機成功時不該打雲端 API'); };
    const first = await facade.getQuotaStatus(true);
    assert.strictEqual(first.gemini.primary.percent, 91);
    assert.strictEqual(first.source, 'antigravity');

    local.getQuotaStatus = async () => ({ success: false, note: '找不到 LS' });
    const cloudOk = { success: true, gemini: { primary: { percent: 100 } }, claude: { primary: { percent: 100 } } };
    api.getQuotaStatus = async () => cloudOk;
    const second = await facade.getQuotaStatus(true);
    assert.strictEqual(second.claude.primary.percent, 100, '本機失敗時才用雲端 API');

    api.getQuotaStatus = async () => ({ success: false, note: '沒有憑證' });
    const third = await facade.getQuotaStatus(true);
    assert.strictEqual(third.success, false);
    assert.strictEqual(third.note, '沒有憑證', '兩邊都失敗時回雲端的原因（比較可行動）');

    api.getQuotaStatus = cloudSaved.get;
    api._cachedQuota = cloudSaved.cached;
    api._lastFetchTime = cloudSaved.t;
    local.getQuotaStatus = localSaved;
  });

  await check('Q11 hub 狀態檔：只認活著的 pid，優先 httpsPort', async () => {
    const hubDir = path.join(FIXTURE_ROOT, 'hub-https');
    fs.mkdirSync(hubDir, { recursive: true });
    fs.writeFileSync(path.join(hubDir, 'hub_18081.json'), JSON.stringify({
      pid: process.pid,
      httpPort: 18080,
      httpsPort: 18081,
      csrfToken: 'csrf-live',
      lsVersion: '2.35.0'
    }));
    fs.writeFileSync(path.join(hubDir, 'hub_18091.json'), JSON.stringify({
      pid: 999999,
      httpPort: 18090,
      httpsPort: 18091,
      csrfToken: 'csrf-dead',
      lsVersion: '2.35.0'
    }));

    const svc = new local.constructor();
    svc._hubDirsOverride = [hubDir];
    const hubs = svc._getHubServers();
    assert.strictEqual(hubs.length, 1, '死掉的 pid 不得列入');
    assert.strictEqual(hubs[0].pid, process.pid);
    assert.strictEqual(hubs[0].port, 18081, '有 httpsPort 就用它');
    assert.strictEqual(hubs[0].secure, true);
    assert.strictEqual(hubs[0].csrf, 'csrf-live');

    const httpOnlyDir = path.join(FIXTURE_ROOT, 'hub-http');
    fs.mkdirSync(httpOnlyDir, { recursive: true });
    fs.writeFileSync(path.join(httpOnlyDir, 'hub_18080.json'), JSON.stringify({
      pid: process.pid, httpPort: 18080, csrfToken: 'csrf-http'
    }));
    svc._hubDirsOverride = [httpOnlyDir];
    const httpHubs = svc._getHubServers();
    assert.strictEqual(httpHubs[0].port, 18080);
    assert.strictEqual(httpHubs[0].secure, false, '只有 httpPort 時走 http');
  });

  await check('Q12 hub 真實回應：Gemini 91%、Claude 100%、方案 Pro', async () => {
    const parsed = local._parseQuotaSummary({
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [{
            bucketId: 'gemini-weekly',
            displayName: 'Weekly Limit Remaining',
            window: 'weekly',
            remainingFraction: 0.911068,
            resetTime: '2030-12-01T11:43:08Z'
          }]
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [{
            bucketId: '3p-weekly',
            displayName: 'Weekly Limit Remaining',
            window: 'weekly',
            remainingFraction: 1,
            resetTime: '2030-12-01T13:11:42Z'
          }]
        }
      ]
    }, {
      email: 'tester@example.com',
      name: 'Tester',
      planStatus: { planInfo: { planName: 'Pro' } }
    });

    assert.ok(parsed);
    assert.strictEqual(parsed.detailSource, 'language-server');
    assert.strictEqual(parsed.gemini.weekly.percent, 91);
    assert.strictEqual(parsed.claude.weekly.percent, 100);
    assert.strictEqual(parsed.account.tier, 'Pro');
    assert.strictEqual(parsed.account.isPaidTier, true);
    assert.strictEqual(parsed.account.email, 'tester@example.com');
  });

  await check('Q13 hub 優先：不掃進程，直接用 hub 的 port／csrf／protocol', async () => {
    const svc = new local.constructor();
    const calls = [];
    svc._getHubServers = () => [{ pid: process.pid, port: 18080, secure: false, csrf: 'csrf-http' }];
    svc._getLsProcesses = async () => { throw new Error('有 hub 時不該掃進程'); };
    svc._getAllListeningPortsMap = async () => { throw new Error('有 hub 時不該跑 netstat'); };
    svc._tryFetchFromPort = async (port, csrf, secure) => {
      calls.push({ port, csrf, secure });
      return { success: true, gemini: { primary: { percent: 91 } } };
    };
    const data = await svc._fetchFromLanguageServer();
    assert.strictEqual(data.gemini.primary.percent, 91);
    assert.deepStrictEqual(calls, [{ port: 18080, csrf: 'csrf-http', secure: false }]);
  });

  await check('Q14 快照：語言伺服器休眠時沿用最後成功值，過期或不存在則不用', async () => {
    const cacheDir = path.join(FIXTURE_ROOT, 'cache');
    const svc = new local.constructor();
    svc._cacheDir = cacheDir;
    assert.strictEqual(svc._readSnapshot(), null, '沒有快照時回 null');

    svc._writeSnapshot({
      success: true,
      lastUpdated: '21:30:00',
      account: { email: 'tester@example.com', name: '', tier: 'Pro', isPaidTier: true },
      gemini: { primary: { percent: 91 }, weekly: { percent: 91 }, fiveHour: { exists: false, percent: null } },
      claude: { primary: { percent: 100 }, weekly: { percent: 100 }, fiveHour: { exists: false, percent: null } }
    });
    const snap = svc._readSnapshot();
    assert.ok(snap, '有效快照應可讀回');
    assert.strictEqual(snap.stale, true);
    assert.strictEqual(snap.gemini.weekly.percent, 91);
    assert.strictEqual(snap.detailSource, 'language-server-cache');
    assert.ok(snap.capturedAtLocal, '要帶讀取時間給 tooltip');

    const file = svc._snapshotFile();
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.capturedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(doc), 'utf8');
    assert.strictEqual(svc._readSnapshot(), null, '超過 24 小時的快照視為過期');
  });

  await check('Q15 官方 client 優先：用 IDE 的 RPC client，失敗才退回 hub／快照', async () => {
    const svc = new local.constructor();
    let used = 0;
    svc._rpcClientProvider = async () => ({
      retrieveUserQuotaSummary: async () => {
        used++;
        return {
          response: {
            groups: [{
              displayName: 'Gemini Models',
              buckets: [{ bucketId: 'gemini-weekly', displayName: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 0.91 }]
            }]
          }
        };
      },
      getUserStatus: async () => ({
        userStatus: { email: 'tester@example.com', planStatus: { planInfo: { planName: 'Pro' } } }
      })
    });
    svc._getHubServers = () => { throw new Error('官方 client 成功時不該走到 hub'); };
    const data = await svc._fetchFromLanguageServer();
    assert.strictEqual(used, 1);
    assert.strictEqual(data.gemini.weekly.percent, 91);
    assert.strictEqual(data.account.tier, 'Pro');
    assert.strictEqual(data.detailSource, 'language-server');

    const failing = new local.constructor();
    failing._rpcClientProvider = async () => { throw new Error('client not initialized'); };
    failing._getHubServers = () => [];
    failing._getLsProcesses = async () => [];
    failing._getAllListeningPortsMap = async () => new Map();
    assert.strictEqual(await failing._fetchFromLanguageServer(), null, '官方 client 失敗時回 null，讓上層用快照／雲端');
  });

  // ── 結果輸出 ───────────────────────────────────────────────────────────────
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });

  let failed = 0;
  for (const [state, label] of results) {
    console.log(`${state === 'PASS' ? 'PASS' : 'FAIL'}  ${label}`);
    if (state === 'FAIL') failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

function groupsOf(obj) {
  return Object.keys(obj || {}).filter((k) => obj[k]);
}

main();
