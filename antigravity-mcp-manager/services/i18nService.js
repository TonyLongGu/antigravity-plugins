// ==============================================================================
// 檔案名稱：services/i18nService.js
// 功能說明：Extension Host 端語系統一入口
//   Webview 端由 media/app.js 的 I18nModule 負責；本模組供 Extension Host 的
//   原生 UI（狀態列、通知、Toast）與服務層訊息使用。
//   兩者共用同一份 locales/*.json，確保面板與原生 UI 的語言永遠一致。
// ==============================================================================

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = ['zh-TW', 'en'];
const FALLBACK = 'zh-TW';

class I18nService {
  static locales = null;

  /** 載入語系字典（首次使用時自動載入；檔案極小，讀取失敗不影響運作） */
  static ensureLoaded() {
    if (this.locales) return;
    this.locales = {};
    for (const lang of SUPPORTED) {
      try {
        const filePath = path.join(__dirname, '..', 'locales', `${lang}.json`);
        this.locales[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        this.locales[lang] = {};
      }
    }
  }

  /**
   * 目前語系
   * 順序：scriptRunner.locale（跨外掛共用）→ antigravity.locale → IDE 語系 → zh-TW
   */
  static get currentLocale() {
    try {
      const runner = vscode?.workspace?.getConfiguration('scriptRunner')?.get('locale');
      if (SUPPORTED.includes(runner)) return runner;
      const custom = vscode?.workspace?.getConfiguration('antigravity')?.get('locale');
      if (SUPPORTED.includes(custom)) return custom;
      const envLang = (vscode?.env?.language || '').toLowerCase();
      if (envLang.startsWith('en')) return 'en';
    } catch (_) {}
    return FALLBACK;
  }

  static isSupported(lang) {
    return SUPPORTED.includes(lang);
  }

  /**
   * 取字串
   * @param {string} key locales/*.json 的鍵
   * @param {Record<string, string|number>} [params] 以 {name} 形式代入
   * @returns {string} 找不到鍵時回傳鍵本身，便於察覺缺漏
   */
  static t(key, params) {
    this.ensureLoaded();
    const dict = this.locales[this.currentLocale] || this.locales[FALLBACK] || {};
    let text = dict[key] !== undefined ? dict[key] : key;
    if (typeof text === 'string' && params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return text;
  }
}

module.exports = I18nService;
