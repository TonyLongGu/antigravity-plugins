// ==============================================================================
// 檔案名稱：tests/kilo-mcp-service.test.js
// 功能說明：Kilo MCP 唯讀服務的回歸測試（零相依）
//   驗證重點：
//     1. 讀取 ~/.config/kilo/kilo.jsonc 的 mcp 段（JSONC：註解＋尾逗號）
//     2. enabled: false 視為停用；缺欄位視為啟用；disabled: true 亦相容
//     3. command 陣列正規化為 command／args，remote 取 url
//     4. 不讀 headers／environment（輸出物件不含這兩個欄位）
//     5. 沒有設定檔時 stats 為 0 且不拋錯
//   執行：node tests/kilo-mcp-service.test.js
//   離開碼：0 = 全數通過、1 = 有失敗
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'antigravity-mcp-kilo-test');
const HOME = path.join(ROOT, 'home');
const CONFIG_HOME = path.join(HOME, '.config');
const KILO_DIR = path.join(CONFIG_HOME, 'kilo');
const KILO_CONFIG = path.join(KILO_DIR, 'kilo.jsonc');

process.env.USERPROFILE = HOME;
process.env.XDG_CONFIG_HOME = CONFIG_HOME;

const KiloMcpService = require(path.join(EXT_ROOT, 'services', 'kiloMcpService.js'));

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (e) {
    results.push(['FAIL', `${label} :: ${e.message}`]);
  }
};

function createFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(KILO_DIR, { recursive: true });
  fs.writeFileSync(
    KILO_CONFIG,
    `{
      // Kilo 全域 MCP（註解測試）
      "mcp": {
        "remote-on": {
          "type": "remote",
          "url": "https://mcp.example/mcp",
          "enabled": true,
          "headers": { "Authorization": "Bearer secret" },
        },
        "local-off": {
          "type": "local",
          "command": ["node", "server.js", "--flag"],
          "enabled": false,
          "environment": { "TOKEN": "secret" },
        },
        "legacy-disabled": { "type": "local", "command": "uv run mcp", "disabled": true },
        "implicit-on": { "type": "local", "command": ["npx", "thing"] },
      },
    }\n`
  );
}

async function main() {
  createFixtures();

  await check('K1 JSONC 解析與路徑解析', () => {
    assert.strictEqual(KiloMcpService.getConfigPath(), KILO_CONFIG);
    assert.strictEqual(KiloMcpService.isAvailable(), true);
  });

  await check('K2 統計：enabled:false／disabled:true 皆算停用', async () => {
    const data = await KiloMcpService.getServers();
    assert.deepStrictEqual(data.stats, { total: 4, enabled: 2, disabled: 2 });
    assert.strictEqual(data.servers['remote-on'].disabled, false);
    assert.strictEqual(data.servers['local-off'].disabled, true);
    assert.strictEqual(data.servers['legacy-disabled'].disabled, true);
    assert.strictEqual(data.servers['implicit-on'].disabled, false);
  });

  await check('K3 啟動方式正規化（陣列 command／字串 command／url）', async () => {
    const data = await KiloMcpService.getServers();
    const localOff = data.servers['local-off'];
    assert.strictEqual(localOff.command, 'node');
    assert.deepStrictEqual(localOff.args, ['server.js', '--flag']);
    assert.strictEqual(data.servers['legacy-disabled'].command, 'uv');
    assert.deepStrictEqual(data.servers['legacy-disabled'].args, ['run', 'mcp']);
    assert.strictEqual(data.servers['remote-on'].serverUrl, 'https://mcp.example/mcp');
  });

  await check('K4 不輸出 headers／environment（隱私紅線）', async () => {
    const data = await KiloMcpService.getServers();
    for (const server of Object.values(data.servers)) {
      assert.ok(!('headers' in server && server.headers), `${server.name} 洩漏 headers`);
      assert.ok(!('environment' in server && server.environment), `${server.name} 洩漏 environment`);
    }
  });

  await check('K5 沒有設定檔時回傳 0 筆、不拋錯', async () => {
    fs.rmSync(KILO_CONFIG, { force: true });
    const data = await KiloMcpService.getServers();
    assert.deepStrictEqual(data.stats, { total: 0, enabled: 0, disabled: 0 });
    assert.deepStrictEqual(data.servers, {});
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const [status, label] of results) {
    console.log(`${status}  ${label}`);
  }
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);

  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('測試執行失敗：', err);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
});
