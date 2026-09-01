// ==============================================================================
// 檔案名稱：extension.js
// 功能說明：Google Antigravity IDE - MCP 管理儀表板 Extension Host 主進入點 (全域模式)
// 遵循規範：ide-extension-workflow 模組化服務架構與 Design System 準則
// ==============================================================================

const vscode = require('vscode');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

// 引入業務服務層模組
const McpConfigService = require('./services/mcpConfigService');
const ProbeService = require('./services/probeService');
const SystemService = require('./services/systemService');

/**
 * 側邊欄 WebviewViewProvider 實作
 */
class MCPManagerViewProvider {
  constructor(extensionUri, statusBarItem) {
    this._extensionUri = extensionUri;
    this._statusBarItem = statusBarItem;
    this._view = undefined;
  }

  async resolveWebviewView(webviewView, _context, _token) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

    // 監聽來自 Webview 前端的訊息分發
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'getData': {
          await this.refreshWebviewData();
          break;
        }

        case 'openGlobalConfig': {
          await SystemService.openConfigFile(McpConfigService.globalConfigPath);
          break;
        }

        case 'toggleGlobalServer': {
          const { name, disabled } = message;
          try {
            await McpConfigService.toggleServer(McpConfigService.globalConfigPath, name, disabled);
            await this.refreshWebviewData();
            this.pushToast(`已${disabled ? '停用' : '啟用'} ${name}`, disabled ? 'warning' : 'success');
            vscode.window.setStatusBarMessage(`全域 MCP: 已${disabled ? '停用' : '啟用'} ${name}`, 3000);
          } catch (err) {
            this.pushToast(`切換失敗：${err.message}`, 'danger');
            await this.refreshWebviewData();
          }
          break;
        }

        case 'batchToggleGlobal': {
          const { action } = message;
          try {
            await McpConfigService.batchToggle(McpConfigService.globalConfigPath, action);
            await this.refreshWebviewData();
            const actionText = action === 'enableAll' ? '全部啟用' : action === 'disableAll' ? '全部停用' : '反向切換';
            this.pushToast(`全域 MCP 伺服器已${actionText}`, 'success');
            vscode.window.setStatusBarMessage(`全域 MCP 批次操作完成`, 3000);
          } catch (err) {
            this.pushToast(`批次操作失敗：${err.message}`, 'danger');
          }
          break;
        }

        case 'testServer': {
          const { name } = message;
          try {
            const globalData = await McpConfigService.getGlobalData();
            const serverConfig = globalData.config.mcpServers && globalData.config.mcpServers[name];

            if (!serverConfig) {
              throw new Error(`找不到伺服器設定：${name}`);
            }

            const result = await ProbeService.testServerConnection(serverConfig);
            if (this._view) {
              this._view.webview.postMessage({
                type: 'testResult',
                name,
                result,
              });
            }
          } catch (err) {
            if (this._view) {
              this._view.webview.postMessage({
                type: 'testResult',
                name,
                result: { ok: false, message: err.message },
              });
            }
          }
          break;
        }

        case 'showInfo': {
          vscode.window.showInformationMessage(message.message);
          break;
        }

        case 'showError': {
          vscode.window.showErrorMessage(message.message);
          break;
        }
      }
    });
  }

  pushToast(message, status = 'info') {
    if (this._view) {
      this._view.webview.postMessage({ type: 'toast', payload: { message, status } });
    }
  }

  async refreshWebviewData() {
    try {
      const globalData = await McpConfigService.getGlobalData();

      // 更新 IDE 底部 Status Bar
      if (this._statusBarItem) {
        this._statusBarItem.text = `$(plug) MCP: ${globalData.stats.enabled}/${globalData.stats.total}`;

        const servers = (globalData.config && globalData.config.mcpServers) || {};
        const enabledServers = Object.keys(servers).filter((name) => servers[name].disabled !== true);

        const tooltipLines = [];

        if (enabledServers.length > 0) {
          tooltipLines.push('已啟用的 MCP 工具:');
          enabledServers.forEach((name) => {
            tooltipLines.push(`• ${name}`);
          });
        } else {
          tooltipLines.push('(目前無啟用的 MCP 工具)');
        }

        tooltipLines.push('點擊展開側邊欄');

        this._statusBarItem.tooltip = tooltipLines.join('\n');
        this._statusBarItem.show();
      }

      // 推送最新完整資料至 Webview 前端
      if (this._view) {
        this._view.webview.postMessage({
          type: 'updateAllData',
          payload: {
            global: globalData,
          },
        });
      }
    } catch (err) {
      console.error('MCP Manager Data Refresh Error:', err);
      if (this._view) {
        this._view.webview.postMessage({
          type: 'error',
          message: err.message,
        });
      } else {
        vscode.window.showErrorMessage(`MCP 狀態更新失敗: ${err.message}`);
      }
    }
  }

  async _getHtmlForWebview(webview) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'app.js'));
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'index.html');

    let html = '';
    try {
      html = await fsPromises.readFile(htmlPath, 'utf-8');
    } catch {
      html = `<!DOCTYPE html><html><body><h3>找不到 index.html</h3></body></html>`;
    }

    return html
      .replace(/href="style\.css"/g, `href="${styleUri}"`)
      .replace(/src="app\.js"/g, `src="${scriptUri}"`);
  }
}

/**
 * 擴充套件啟動進入點
 */
async function activate(context) {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  statusBarItem.command = 'antigravity.mcp.focusView';
  statusBarItem.text = `$(plug) MCP: 載入中...`;
  context.subscriptions.push(statusBarItem);

  const provider = new MCPManagerViewProvider(context.extensionUri, statusBarItem);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('antigravity.mcpManagerView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // 初始化載入狀態
  await provider.refreshWebviewData();

  // 註冊 VS Code 指令
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.mcp.refresh', async () => {
      await provider.refreshWebviewData();
      provider.pushToast('狀態已重新整理', 'info');
    }),
    vscode.commands.registerCommand('antigravity.mcp.focusView', async () => {
      await vscode.commands.executeCommand('antigravity.mcpManagerView.focus');
    })
  );

  // 全域設定檔檔案監聽 (即時熱重載)
  const dir = path.dirname(McpConfigService.globalConfigPath);
  try {
    await fsPromises.access(dir);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dir), 'mcp_config.json')
    );
    watcher.onDidChange(() => provider.refreshWebviewData());
    watcher.onDidCreate(() => provider.refreshWebviewData());
    watcher.onDidDelete(() => provider.refreshWebviewData());
    context.subscriptions.push(watcher);
  } catch (e) {}
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
