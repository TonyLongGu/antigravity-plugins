const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 通用後台多國語言模組 (讀取全域配置 antigravity.locale)
 */
class I18n {
  /**
   * @param {vscode.Uri} [extensionUri]
   */
  constructor(extensionUri = null) {
    this.extensionUri = extensionUri;
    this.locales = {};
    this.loadLocales();
  }

  /**
   * 載入 locales 資料夾下的字典檔
   */
  loadLocales() {
    try {
      const baseDir = this.extensionUri?.fsPath || path.resolve(__dirname);
      const zhPath = path.join(baseDir, 'locales', 'zh-TW.json');
      const enPath = path.join(baseDir, 'locales', 'en.json');

      if (fs.existsSync(zhPath)) {
        this.locales['zh-TW'] = JSON.parse(fs.readFileSync(zhPath, 'utf-8'));
      }
      if (fs.existsSync(enPath)) {
        this.locales['en'] = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[QuickAccess][i18n] Failed to load locales:', err);
    }
  }

  /**
   * 取得當前設定語系 (預設 'zh-TW')
   * @returns {string}
   */
  getLocale() {
    const config = vscode.workspace.getConfiguration('antigravity');
    return config.get('locale', 'zh-TW');
  }

  /**
   * 翻譯字串並支援 {param} 參數插值
   * @param {string} key
   * @param {Record<string, any>} [params]
   * @returns {string}
   */
  t(key, params = {}) {
    const lang = this.getLocale();
    const dict = this.locales[lang] || this.locales['zh-TW'] || {};
    let text = dict[key] !== undefined ? dict[key] : key;

    if (typeof text === 'string' && params && typeof params === 'object') {
      for (const [pKey, pVal] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
      }
    }
    return text;
  }
}

module.exports = I18n;
