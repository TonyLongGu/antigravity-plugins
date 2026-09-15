const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 通用後台多國語言模組
 * 優先順序：scriptRunner.locale → antigravity.locale → IDE 顯示語言
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
   * 取得當前設定語系
   * 優先讀取 scriptRunner.locale，其次相容 antigravity.locale，未指定則跟隨 IDE 顯示語言
   * @returns {string}
   */
  getLocale() {
    const runnerLocale = vscode.workspace.getConfiguration('scriptRunner').get('locale');
    if (runnerLocale === 'zh-TW' || runnerLocale === 'en') {
      return runnerLocale;
    }

    const customLocale = vscode.workspace.getConfiguration('antigravity').get('locale');
    if (customLocale && typeof customLocale === 'string') {
      return customLocale;
    }

    const envLang = (vscode.env.language || '').toLowerCase();
    if (envLang.startsWith('en')) {
      return 'en';
    }
    return 'zh-TW';
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
