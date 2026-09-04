const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

// 載入各模組業務服務 (Feature Services)
const systemService = require('./services/systemService');
const workspaceService = require('./services/workspaceService');
const scriptService = require('./services/scriptService');
const brainService = require('./services/brainService');

/**
 * 側邊欄 Webview View Provider (主控制器與訊息轉發層)
 */
class ToolboxViewProvider {
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
    this._view = null;
    this._panel = null;
    this._pushTimer = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 雙向訊息路由分發 (Action Message Router)
    webviewView.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));

    webviewView.onDidDispose(() => {
      this._view = null;
    });
  }

  /**
   * 在代碼編輯器分頁 (Editor Tab) 中開啟控制中心 (原生向右分割至 ViewColumn.Beside 並自動鎖定群組)
   * @param {vscode.ViewColumn} [column=vscode.ViewColumn.Beside]
   */
  openInEditor(column = vscode.ViewColumn.Beside) {
    if (this._panel) {
      this._panel.reveal(column);
      this._lockEditorGroup();
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'antigravity.toolboxEditor',
      'Antigravity 控制中心',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri],
      }
    );

    this._panel.iconPath = {
      dark: vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'toolbox-icon-dark.svg'),
      light: vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'toolbox-icon-light.svg'),
    };

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));

    this._panel.onDidDispose(() => {
      this._panel = null;
    });

    // 立即向新開啟的編輯器分頁推送當前完整狀態
    this.pushStatus(0);

    // 自動鎖定該編輯器群組 (避免後續點選代碼檔案覆蓋控制中心)
    this._lockEditorGroup();
  }

  /**
   * 鎖定當前編輯器群組
   */
  _lockEditorGroup() {
    setTimeout(async () => {
      try {
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
      } catch (err) {
        // 忽略在特定無 UI 或特殊環境下的例外
      }
    }, 100);
  }

  /**
   * 統一雙向訊息分發處理器 (支援側邊欄 WebviewView 與編輯區 WebviewPanel)
   * @param {Object} msg
   */
  async _handleMessage(msg) {
    switch (msg.type) {
      case 'fetchStatus':
        this.pushStatus();
        break;

      case 'fixWorkspace':
        workspaceService.fixWorkspaceDuplicates(this);
        this.pushStatus();
        break;

      case 'resetWorkspace':
        workspaceService.resetWorkspaceNames(this);
        this.pushStatus();
        break;

      case 'openTarget':
        await systemService.handleOpenTarget(msg.target, this);
        break;

      case 'cleanBrain':
        await brainService.cleanBrainHistory(msg.months || 3, this);
        this.pushStatus();
        break;

      case 'toggleExplorerSetting':
        await systemService.toggleExplorerSetting(msg.key, this);
        this.pushStatus();
        break;

      case 'toggleWorkspaceFolder':
      case 'setWorkspaceFolderEnabled':
        workspaceService.setWorkspaceFolderEnabled(msg.path, msg.enabled, this);
        this.pushStatus(60);
        break;

      case 'showOnlyFirstFolder':
        workspaceService.showOnlyFirstWorkspaceFolder(this);
        this.pushStatus(50);
        break;

      case 'showAllFolders':
        workspaceService.showAllWorkspaceFolders(this);
        this.pushStatus(50);
        break;

      case 'invertFolders':
        workspaceService.invertWorkspaceFolders(this);
        this.pushStatus(50);
        break;

      case 'reorderWorkspaceFolders':
        workspaceService.reorderWorkspaceFolders(msg.newOrder, this);
        this.pushStatus();
        break;

      case 'revealPath':
        if (msg.path && fs.existsSync(msg.path)) {
          systemService.openFolderInside(msg.path);
        }
        break;

      case 'pickScripts':
        await scriptService.pickAndAddScripts(this);
        break;

      case 'runScript':
        scriptService.runScript(msg.path, false, this);
        break;

      case 'runScriptAdmin':
        scriptService.runScript(msg.path, true, this);
        break;

      case 'removeScript':
        scriptService.removeScript(msg.path, this);
        break;

      case 'renameScript':
        await scriptService.renameScript(msg.path, this);
        break;

      case 'resetScriptDisplayName':
        scriptService.resetScriptDisplayName(msg.path, this);
        break;

      case 'revealScriptInExplorer':
        await scriptService.revealScriptInExplorer(msg.path, this);
        break;

      case 'setGlobalLocale': {
        const { locale } = msg;
        try {
          await vscode.workspace.getConfiguration('antigravity').update('locale', locale, vscode.ConfigurationTarget.Global);
        } catch (err) {
          console.error('Failed to update global locale in toolbox:', err);
        }
        break;
      }
    }
  }

  /**
   * 推送 In-App 浮動通知給前端 Webview (同時支援側邊欄與編輯器分頁)
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} status
   */
  pushToast(message, status = 'info') {
    const payload = {
      type: 'toast',
      payload: { message, status },
    };
    if (this._view) {
      this._view.webview.postMessage(payload);
    }
    if (this._panel) {
      this._panel.webview.postMessage(payload);
    }
  }

  broadcastLocale(locale) {
    const payload = { type: 'localeChanged', locale };
    if (this._view) {
      this._view.webview.postMessage(payload);
    }
    if (this._panel) {
      this._panel.webview.postMessage(payload);
    }
  }

  /**
   * 推送完整狀態更新給前端 Webview (智慧防抖，同步更新側邊欄與編輯器分頁)
   * @param {number} [delay=80] 防抖延遲毫秒數
   *   - 80ms：一般操作（fix/reset/refresh）
   *   - 200ms：onDidChangeWorkspaceFolders 事件專用，確保磁碟同步後再讀取
   */
  pushStatus(delay = 80) {
    if (this._pushTimer) {
      clearTimeout(this._pushTimer);
    }
    this._pushTimer = setTimeout(async () => {
      if (this._view || this._panel) {
        const workspaceStatus = workspaceService.analyzeWorkspace();
        const scriptsStatus = scriptService.getWorkspaceScripts();
        const brainStatus = await brainService.getBrainStats();
        const settingsStatus = systemService.getExplorerSettings();
        const payload = {
          type: 'updateStatus',
          payload: {
            workspace: workspaceStatus,
            scripts: scriptsStatus,
            brain: brainStatus,
            settings: settingsStatus,
          },
        };
        if (this._view) {
          this._view.webview.postMessage(payload);
        }
        if (this._panel) {
          this._panel.webview.postMessage(payload);
        }
      }
    }, delay);
  }

  /**
   * 載入與解析前端 HTML，直接 Inline 內嵌 CSS 徹底消除 FOUC 閃爍
   */
  _getHtmlForWebview(webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'app.js')
    );
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'index.html');
    const cssPath = path.join(this._extensionUri.fsPath, 'media', 'style.css');
    const localesPath = path.join(this._extensionUri.fsPath, 'media', 'locales.js');

    let html = fs.readFileSync(htmlPath, 'utf-8');
    let css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
    let localesJs = fs.existsSync(localesPath) ? fs.readFileSync(localesPath, 'utf-8') : '';
    const currentLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');

    return html
      .replace(/<link rel="stylesheet" href="style\.css">/g, `<style>${css}</style>`)
      .replace(/<script src="locales\.js"><\/script>/g, `<script>window.INITIAL_LOCALE = ${JSON.stringify(currentLocale)};</script><script>${localesJs}</script>`)
      .replace(/src="locales\.js"/g, `src="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'locales.js'))}"`)
      .replace(/src="app\.js"/g, `src="${scriptUri}"`);
  }
}

/**
 * 擴充套件進入點
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new ToolboxViewProvider(context.extensionUri);

  // 1. 註冊 Webview View Provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('antigravity.toolboxView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // 1.1 註冊 VS Code 命令：在編輯器分頁開啟控制中心
  const openInEditorHandler = () => { provider.openInEditor(); };
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.openInEditor', openInEditorHandler),
    vscode.commands.registerCommand('antigravity.toolbox.openInEditor.en', openInEditorHandler)
  );

  // 2. 註冊 VS Code 命令：重新整理
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.refresh', () => {
      workspaceService.invalidateWorkspaceCache();
      provider.pushStatus(0);
      provider.pushToast('狀態已重新整理', 'info');
      vscode.window.setStatusBarMessage('已重新整理 Antigravity 控制中心', 2000);
    })
  );

  // 3. 註冊 VS Code 命令：修正同名專案
  const fixWorkspaceHandler = () => {
    workspaceService.fixWorkspaceDuplicates(provider);
    provider.pushStatus();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.fixWorkspace', fixWorkspaceHandler),
    vscode.commands.registerCommand('antigravity.toolbox.fixWorkspace.en', fixWorkspaceHandler)
  );

  // 4. 註冊 VS Code 命令：重設為預設名稱
  const resetWorkspaceHandler = () => {
    workspaceService.resetWorkspaceNames(provider);
    provider.pushStatus();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.resetWorkspace', resetWorkspaceHandler),
    vscode.commands.registerCommand('antigravity.toolbox.resetWorkspace.en', resetWorkspaceHandler)
  );

  // 5. 註冊 VS Code 命令：開啟 settings.json
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettingsJson');
    })
  );

  // 6. 註冊 VS Code 命令：加入至專案腳本執行器 (右鍵選單 / 命令面板)
  const addScriptHandler = (uri, selectedUris) => {
    const targets = (Array.isArray(selectedUris) && selectedUris.length > 0) ? selectedUris : (uri ? [uri] : []);
    if (targets.length > 0) {
      scriptService.addScripts(targets, provider);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.addScriptToRunner', addScriptHandler),
    vscode.commands.registerCommand('antigravity.toolbox.addScriptToRunner.en', addScriptHandler)
  );

  // 6.1 註冊 VS Code 命令：聚焦控制中心側邊欄
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.toolbox.focusView', () => {
      vscode.commands.executeCommand('antigravity.toolboxView.focus');
    })
  );

  // 7. 註冊狀態列常駐按鈕
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50
  );
  const updateToolboxStatusBar = () => {
    const isEn = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW') === 'en';
    statusBar.text = isEn ? `$(symbol-property) Control Center` : `$(symbol-property) 控制中心`;
    statusBar.tooltip = isEn ? 'Click to open Antigravity Control Center' : '點擊開啟 Antigravity 控制中心側邊欄';
  };
  updateToolboxStatusBar();
  statusBar.command = 'workbench.view.extension.antigravity-toolbox-container';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // 7.1 監聽全域語言變動 (跨外掛即時聯動廣播)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravity.locale')) {
        const newLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');
        updateToolboxStatusBar();
        provider.broadcastLocale(newLocale);
      }
    })
  );

  // 8. 監聽工作區變更事件自動更新狀態 (立即清除記憶體快取以讀取最新磁碟狀態)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      workspaceService.invalidateWorkspaceCache();
      provider.pushStatus(150);
    })
  );

  // 9. 監聽多專案工作區設定檔 (.code-workspace) 檔案變更
  let wsFileWatcher = null;
  if (vscode.workspace.workspaceFile?.fsPath) {
    try {
      const wsDir = path.dirname(vscode.workspace.workspaceFile.fsPath);
      const wsName = path.basename(vscode.workspace.workspaceFile.fsPath);
      wsFileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(wsDir, wsName));
      const onWsChange = () => {
        workspaceService.invalidateWorkspaceCache();
        provider.pushStatus(100);
      };
      wsFileWatcher.onDidChange(onWsChange);
      wsFileWatcher.onDidCreate(onWsChange);
      wsFileWatcher.onDidDelete(onWsChange);
      context.subscriptions.push(wsFileWatcher);
    } catch {}
  }

  // 10. 監聽 IDE 設定變更事件自動同步開關狀態
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('files.exclude') || e.affectsConfiguration('explorer.excludeGitIgnore')) {
        provider.pushStatus();
      }
    })
  );

  // 11. 監聽 IDE 視窗聚焦狀態變更 (例如外部拖曳排序或切換視窗後返回)
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        workspaceService.invalidateWorkspaceCache();
        provider.pushStatus(100);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

