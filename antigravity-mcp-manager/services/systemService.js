// ==============================================================================
// 檔案名稱：services/systemService.js
// 功能說明：IDE 系統與編輯器整合服務 (開啟設定檔、總管定位)
// ==============================================================================

const vscode = require('vscode');
const fsPromises = require('node:fs/promises');
const I18n = require('./i18nService');

class SystemService {
  /**
   * 內部非同步檢查檔案是否存在
   */
  static async _exists(targetPath) {
    try {
      await fsPromises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 在 VS Code 編輯器中開啟指定 MCP 設定檔
   */
  static async openConfigFile(targetPath) {
    if (!targetPath || !(await this._exists(targetPath))) {
      vscode.window.showWarningMessage(
        I18n.t('msg_config_not_found', { path: targetPath || I18n.t('msg_path_unspecified') })
      );
      return;
    }
    try {
      await this._showInEditor(targetPath);
    } catch (e) {
      vscode.window.showErrorMessage(I18n.t('toast_open_config_failed', { msg: e.message }));
    }
  }

  /**
   * 在編輯器開啟檔案並在檔案總管 (Explorer) 中定位
   */
  static async revealProjectFile(targetPath) {
    if (!targetPath || !(await this._exists(targetPath))) {
      vscode.window.showWarningMessage(
        I18n.t('msg_file_not_found', { path: targetPath || I18n.t('msg_path_unspecified') })
      );
      return;
    }
    try {
      const uri = await this._showInEditor(targetPath);
      await vscode.commands.executeCommand('revealInExplorer', uri);
    } catch (e) {
      vscode.window.showErrorMessage(I18n.t('msg_file_open_failed', { msg: e.message }));
    }
  }

  /**
   * 在編輯器開啟檔案，不把全文同步進 Extension Host。
   * openTextDocument 會要求把檔案登記成可同步模型。
   * 工作區外的 ~/.cursor/mcp.json 過不了這關，Cursor 丟出
   * "Documents above the size limit cannot be synchronized with extensions."
   * （與實際大小無關，本機這份只有約 2.6 KB 也會中）。
   * vscode.open 只開編輯器分頁。
   */
  static async _showInEditor(targetPath) {
    const uri = vscode.Uri.file(targetPath);
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    return uri;
  }
}

module.exports = SystemService;
