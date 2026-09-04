const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

class I18n {
  constructor(extensionUri = null) {
    this.extensionUri = extensionUri;
    this.locales = {};
    this.loadLocales();
  }

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
    } catch (e) {
      console.error('Failed to load locales in quota-status:', e);
    }
  }

  getLocale() {
    return vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');
  }

  t(key, params = {}) {
    const lang = this.getLocale();
    const dict = this.locales[lang] || this.locales['zh-TW'] || {};
    let text = dict[key] !== undefined ? dict[key] : key;
    if (typeof text === 'string') {
      Object.keys(params).forEach((p) => {
        text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
      });
    }
    return text;
  }
}

module.exports = I18n;
