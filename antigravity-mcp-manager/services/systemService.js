// ==============================================================================
// 檔案名稱：services/systemService.js
// 功能說明：IDE 系統與編輯器整合服務 (開啟設定檔、總管定位)
// ==============================================================================

const vscode = require('vscode');
const fsPromises = require('node:fs/promises');

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
      vscode.window.showWarningMessage(`找不到設定檔：${targetPath || '未指定路徑'}`);
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (e) {
      vscode.window.showErrorMessage(`開啟設定檔失敗：${e.message}`);
    }
  }

  /**
   * 在編輯器開啟檔案並在檔案總管 (Explorer) 中定位
   */
  static async revealProjectFile(targetPath) {
    if (!targetPath || !(await this._exists(targetPath))) {
      vscode.window.showWarningMessage(`找不到該檔案：${targetPath || '未指定路徑'}`);
      return;
    }
    try {
      const uri = vscode.Uri.file(targetPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      await vscode.commands.executeCommand('revealInExplorer', uri);
    } catch (e) {
      vscode.window.showErrorMessage(`開啟檔案失敗：${e.message}`);
    }
  }
}

module.exports = SystemService;
