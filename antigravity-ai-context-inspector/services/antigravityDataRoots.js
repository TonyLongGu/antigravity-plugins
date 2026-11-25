// ==============================================================================
// 檔案名稱：services/antigravityDataRoots.js
// 功能說明：Antigravity IDE 資料根目錄解析（1.3.2 起，三個服務共用）
//   - Antigravity 於 2026-10-29 把對話資料從 `~/.gemini/antigravity-ide` 搬遷到
//     `~/.gemini/antigravity`（舊目錄留下 `.ide_migration` 之後就凍結，只剩歷史資料）
//   - 這裡只做「根目錄 → 子目錄／檔案清單」的純路徑解析，不讀內容，
//     避免服務之間互相 require 成環（transcriptParser → contextScanner → mcpDetector）
//   - 規則：新根優先、舊根只當歷史來源；同 id 去重由各服務自行處理
// ==============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODERN_ROOT_NAME = 'antigravity';
const LEGACY_ROOT_NAME = 'antigravity-ide';

class AntigravityDataRoots {
  static getUserHome() {
    return process.env.USERPROFILE || os.homedir();
  }

  /** 兩個根目錄只要有一個有資料（brain 或 conversations）就算這個安裝有 Antigravity 資料 */
  static hasData(rootDir) {
    return fs.existsSync(path.join(rootDir, 'brain')) || fs.existsSync(path.join(rootDir, 'conversations'));
  }

  /** 依優先序回傳資料根目錄：[新 ~/.gemini/antigravity, 舊 ~/.gemini/antigravity-ide] */
  static resolveRoots(home = this.getUserHome()) {
    return [MODERN_ROOT_NAME, LEGACY_ROOT_NAME]
      .map(name => path.join(home, '.gemini', name))
      .filter(dir => this.hasData(dir));
  }

  /** 主要根目錄：優先新根；完全沒有資料時回新根路徑（供「開啟資料夾」之類的建立動作使用） */
  static getPrimaryRootDir(home = this.getUserHome()) {
    const roots = this.resolveRoots(home);
    return roots.length > 0 ? roots[0] : path.join(home, '.gemini', MODERN_ROOT_NAME);
  }

  /** 各根目錄底下實際存在的子目錄（例：'brain'、'mcp'、path.join('builtin','skills')） */
  static resolveSubDirs(relativePath, home) {
    return this.resolveRoots(home)
      .map(root => path.join(root, relativePath))
      .filter(dir => fs.existsSync(dir));
  }

  /** 各根目錄底下實際存在的檔案（例：'conversation_summaries.db'） */
  static resolveFiles(fileName, home) {
    return this.resolveRoots(home)
      .map(root => path.join(root, fileName))
      .filter(file => fs.existsSync(file));
  }

  static resolveBrainDirs(home) {
    return this.resolveSubDirs('brain', home);
  }

  static resolveConversationsDirs(home) {
    return this.resolveSubDirs('conversations', home);
  }
}

module.exports = AntigravityDataRoots;
