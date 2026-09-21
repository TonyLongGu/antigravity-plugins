// ==============================================================================
// 檔案名稱：extension.js
// 功能說明：Antigravity / Cursor MCP 管理儀表板 Extension Host 主進入點 (全域模式)
// 遵循規範：ide-extension-workflow 模組化服務架構與 Design System 準則
// ==============================================================================

const vscode = require('vscode');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

// 引入業務服務層模組
const McpConfigService = require('./services/mcpConfigService');
const ProbeService = require('./services/probeService');
const SystemService = require('./services/systemService');
const I18n = require('./services/i18nService');

// 原生 UI（狀態列、通知、Toast）的語言須與面板一致，
// 故統一由 I18nService 提供；解析順序見該模組。
const resolveLocale = () => I18n.currentLocale;

/**
 * 寫入全域語言設定（供面板切換語系時呼叫）
 */
async function persistGlobalLocale(locale) {
  if (!I18n.isSupported(locale)) return;
  try {
    await vscode.workspace.getConfiguration('antigravity').update('locale', locale, vscode.ConfigurationTarget.Global);
  } catch (_) {}
}

/**
 * 側邊欄 WebviewViewProvider 實作
 */
class MCPManagerViewProvider {
  constructor(extensionUri, statusBarItem) {
    this._extensionUri = extensionUri;
    this._statusBarItem = statusBarItem;
    this._view = undefined;
    this._panel = undefined;
    this._refreshDebounceTimer = null;
    this._lastFingerprint = '';
  }

  async resolveWebviewView(webviewView, _context, _token) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message, webviewView.webview);
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);
    await this.refreshWebviewData(true, 0, true);
  }

  /**
   * 在編輯器分頁中開啟 MCP 管理儀表板 (向右分割 ViewColumn.Beside 並自動鎖定群組)
   * @param {vscode.ViewColumn} [column=vscode.ViewColumn.Beside]
   */
  async openInEditor(column = vscode.ViewColumn.Beside) {
    if (this._panel) {
      this._panel.reveal(column);
      this._lockEditorGroup();
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'antigravity.mcpManagerEditor',
      I18n.t('header_title'),
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri],
      }
    );

    // 雙主題圖示配置 (深色灰白 #CCCCCC，淺色深灰 #424242)
    this._panel.iconPath = {
      dark: vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'mcp-icon-dark.svg'),
      light: vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'mcp-icon-light.svg'),
    };

    this._panel.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message, this._panel.webview);
    });

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._panel.webview.html = await this._getHtmlForWebview(this._panel.webview);
    await this.refreshWebviewData(true, 0, true);

    // 自動鎖定該編輯器群組 (避免後續點選代碼檔案覆蓋儀表板)
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
   * 寫入 mcp_config.json 後稍候，讓 Antigravity 檔案監看跟上
   */
  async _syncLiveMcp(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  /**
   * 統一訊息分發處理器
   */
  async _handleMessage(message, senderWebview) {
    switch (message.type) {
      case 'getData': {
        await this.refreshWebviewData(true, 0, true);
        break;
      }

      case 'openGlobalConfig': {
        try {
          await McpConfigService.ensureConfigFile();
          await SystemService.openConfigFile(McpConfigService.globalConfigPath);
        } catch (err) {
          this.pushToast(I18n.t('toast_open_config_failed', { msg: err.message }), 'danger');
        }
        break;
      }

      case 'toggleGlobalServer': {
        const { name, disabled } = message;
        try {
          const result = await McpConfigService.toggleServer(name, disabled);
          await this.refreshWebviewData();
          this.pushToast(I18n.t(disabled ? 'toast_toggled_off' : 'toast_toggled_on', { name }), disabled ? 'warning' : 'success');
          await this._syncLiveMcp((result && result.changes) || [{ name, disabled: !!disabled }]);
        } catch (err) {
          this.pushToast(I18n.t('toast_toggle_failed', { msg: err.message }), 'danger');
          await this.refreshWebviewData();
        }
        break;
      }

      case 'updateServerDescription': {
        const { name, description } = message;
        try {
          await McpConfigService.updateServerDescription(name, description);
          await this.refreshWebviewData();
          this.pushToast(I18n.t('toast_desc_updated', { name }), 'success');
        } catch (err) {
          this.pushToast(I18n.t('toast_desc_failed', { msg: err.message }), 'danger');
        }
        break;
      }

      case 'batchToggleGlobal': {
        const { action } = message;
        try {
          const result = await McpConfigService.batchToggle(action);
          await this.refreshWebviewData(true); // 立即推播最新資料，繞過 120ms 防抖
          const isEnable = action === 'enableAll' || action === 'enable_all';
          const isDisable = action === 'disableAll' || action === 'disable_all';
          const actionText = I18n.t(isEnable ? 'action_enable_all' : isDisable ? 'action_disable_all' : 'action_invert');
          this.pushToast(I18n.t('toast_batch_done', { env: McpConfigService.envName, action: actionText }), 'success');
          vscode.window.setStatusBarMessage(I18n.t('status_batch_done', { env: McpConfigService.envName }), 5000);
          await this._syncLiveMcp((result && result.changes) || []);
        } catch (err) {
          this.pushToast(I18n.t('toast_batch_failed', { msg: err.message }), 'danger');
          await this.refreshWebviewData(true);
        }
        break;
      }

      case 'testServer': {
        const { name } = message;
        try {
          const globalData = await McpConfigService.getGlobalData();
          const serverConfig = globalData.config.mcpServers && globalData.config.mcpServers[name];

          if (!serverConfig) {
            throw new Error(I18n.t('err_server_not_found', { name }));
          }

          const result = await ProbeService.testServerConnection(serverConfig);
          const responseMsg = { type: 'testResult', name, result };
          if (this._view) this._view.webview.postMessage(responseMsg);
          if (this._panel) this._panel.webview.postMessage(responseMsg);
        } catch (err) {
          const responseMsg = { type: 'testResult', name, result: { ok: false, message: err.message } };
          if (this._view) this._view.webview.postMessage(responseMsg);
          if (this._panel) this._panel.webview.postMessage(responseMsg);
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

      case 'setGlobalLocale': {
        const { locale } = message;
        try {
            await persistGlobalLocale(locale);
        } catch (err) {
          console.error('Failed to update global locale:', err);
        }
        break;
      }
    }
  }

  pushToast(message, status = 'info') {
    const payload = { type: 'toast', payload: { message, status } };
    if (this._view) {
      this._view.webview.postMessage(payload);
    }
    if (this._panel) {
      this._panel.webview.postMessage(payload);
    }
  }

  async refreshWebviewData(immediate = false, delayMs = 120, force = false) {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }

    const doRefresh = async () => {
      try {
        const globalData = await McpConfigService.getGlobalData();
        const servers = (globalData.config && globalData.config.mcpServers) || {};
        const fingerprint = JSON.stringify({
          path: globalData.path,
          viewOnly: globalData.viewOnly === true,
          stats: globalData.stats || { total: 0, enabled: 0, disabled: 0 },
          servers: Object.keys(servers)
            .sort()
            .map((name) => [
              name,
              servers[name].disabled === true,
              servers[name].effectiveDisabled === true,
              servers[name].workspaceOverride || 'inherit',
              servers[name].description || '',
            ]),
        });
        const hasTarget = !!(this._view || this._panel);
        if (!force && hasTarget && fingerprint === this._lastFingerprint) {
          return;
        }

        // 更新 IDE 底部 Status Bar
        if (this._statusBarItem) {
          const viewOnly = globalData.viewOnly === true;
          const stats = globalData.stats || { total: 0, enabled: 0, disabled: 0 };

          this._statusBarItem.text = `$(plug) MCP: ${stats.enabled}/${stats.total}`;

          const listedServers = Object.keys(servers).filter((name) => servers[name].disabled !== true);

          const tooltipLines = [];
          tooltipLines.push(I18n.t('status_tooltip_title', { env: globalData.envName }));
          if (viewOnly) {
            // 唯讀提示：與面板橫幅使用同一組語系鍵，確保兩處文字一致
            const hintKey = McpConfigService.isVsCode ? 'view_only_hint_vscode' : 'view_only_hint';
            tooltipLines.push(I18n.t(hintKey));
          }
          if (listedServers.length > 0) {
            tooltipLines.push(I18n.t('status_tooltip_enabled'));
            listedServers.forEach((name) => {
              const override = servers[name].workspaceOverride;
              const mark = override === 'off'
                ? I18n.t('status_tooltip_ws_off')
                : override === 'on'
                  ? I18n.t('status_tooltip_ws_on')
                  : '';
              tooltipLines.push(`• ${name}${mark}`);
            });
          } else {
            tooltipLines.push(I18n.t('status_tooltip_none'));
          }

          tooltipLines.push(I18n.t('status_tooltip_click'));

          this._statusBarItem.tooltip = tooltipLines.join('\n');
          this._statusBarItem.show();
        }

        if (!hasTarget) {
          return;
        }

        this._lastFingerprint = fingerprint;

        // 推送最新完整資料至 Webview 前端 (同時廣播至側邊欄與編輯分頁)
        const updatePayload = {
          type: 'updateAllData',
          payload: {
            global: globalData,
          },
        };
        if (this._view) {
          this._view.webview.postMessage(updatePayload);
        }
        if (this._panel) {
          this._panel.webview.postMessage(updatePayload);
        }
      } catch (err) {
        console.error('MCP Manager Data Refresh Error:', err);
        if (this._statusBarItem) {
          this._statusBarItem.text = `$(plug) ${I18n.t('status_bar_error')}`;
          this._statusBarItem.tooltip = I18n.t('status_read_failed', { msg: err.message });
          this._statusBarItem.show();
        }
        const errorPayload = { type: 'error', message: err.message };
        if (this._view) this._view.webview.postMessage(errorPayload);
        if (this._panel) this._panel.webview.postMessage(errorPayload);
      }
    };

    if (immediate) {
      return await doRefresh();
    }

    return new Promise((resolve) => {
      this._refreshDebounceTimer = setTimeout(async () => {
        this._refreshDebounceTimer = null;
        await doRefresh();
        resolve();
      }, delayMs);
    });
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

  async _getHtmlForWebview(webview) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'app.js'));
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'index.html');

    let html = '';
    try {
      html = await fsPromises.readFile(htmlPath, 'utf-8');
    } catch {
      html = `<!DOCTYPE html><html><body><h3>${I18n.t('err_index_missing')}</h3></body></html>`;
    }

    // 讀取外部純 JSON 字典 (Qt 風格解耦翻譯檔)
    const locales = {};
    try {
      const zhPath = path.join(this._extensionUri.fsPath, 'locales', 'zh-TW.json');
      const enPath = path.join(this._extensionUri.fsPath, 'locales', 'en.json');
      if (fs.existsSync(zhPath)) {
        locales['zh-TW'] = JSON.parse(await fsPromises.readFile(zhPath, 'utf-8'));
      }
      if (fs.existsSync(enPath)) {
        locales['en'] = JSON.parse(await fsPromises.readFile(enPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load external locales:', e);
    }

    const currentLocale = resolveLocale();

    const initData = {
      locales,
      initialLocale: currentLocale,
      isVsCode: McpConfigService.isVsCode,
      hostKind: McpConfigService.hostKind,
      envName: McpConfigService.envName,
      viewOnly: McpConfigService.isViewOnly,
      isCursor: McpConfigService.isCursor,
    };
    const jsonSafeString = JSON.stringify(initData).replace(/</g, '\\u003c');

    return html
      .replace(/href="style\.css"/g, `href="${styleUri}"`)
      .replace(/src="app\.js"/g, `src="${scriptUri}?v=${Date.now()}"`)
      .replace(
        /<script id="i18n-locales-data" type="application\/json">\{\}<\/script>/g,
        `<script id="i18n-locales-data" type="application/json">${jsonSafeString}</script>`
      );
  }
}

/**
 * 擴充套件啟動進入點
 */
async function activate(context) {
  McpConfigService.init(context);
  const syncLocaleContext = () => {
    vscode.commands.executeCommand('setContext', 'mcpManager.isEnglish', resolveLocale() === 'en');
  };
  syncLocaleContext();

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  statusBarItem.command = 'antigravity.mcp.focusView';
  statusBarItem.text = `$(plug) ${I18n.t('status_loading')}`;
  statusBarItem.show();
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
  const openInEditorHandler = async () => {
    await provider.openInEditor();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.mcp.openInEditor', openInEditorHandler),
    vscode.commands.registerCommand('antigravity.mcp.openInEditor.en', openInEditorHandler),
    vscode.commands.registerCommand('antigravity.mcp.refresh', async () => {
      await provider.refreshWebviewData(true, 0, true);
      provider.pushToast(I18n.t('toast_refreshed'), 'info');
    }),
    vscode.commands.registerCommand('antigravity.mcp.focusView', async () => {
      await vscode.commands.executeCommand('antigravity.mcpManagerView.focus');
    })
  );

  // 全域設定檔與狀態資料庫檔案監聽 (即時熱重載)
  if (!McpConfigService.isUnsupportedHost) {
    try {
      const configPath = McpConfigService.globalConfigPath;
      const configDir = path.dirname(configPath);
      const configName = path.basename(configPath);
      const configWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(configDir), configName)
      );
      configWatcher.onDidChange(() => provider.refreshWebviewData());
      configWatcher.onDidCreate(() => provider.refreshWebviewData());
      configWatcher.onDidDelete(() => provider.refreshWebviewData());
      context.subscriptions.push(configWatcher);
    } catch (e) {}
  }

  if (McpConfigService.isCursor) {
    const refreshEnablement = () => provider.refreshWebviewData();
    const poll = setInterval(() => {
      if (vscode.window.state.focused) refreshEnablement();
    }, 2500);
    context.subscriptions.push({ dispose: () => clearInterval(poll) });
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) refreshEnablement();
      })
    );
  }

  // VS Code 原生開關連動：
  // 開關存在 state.vscdb（非設定檔），且該檔位於工作區外，
  // createFileSystemWatcher 對其不可靠，故以「變更簽章輪詢」偵測外部變更。
  // 簽章僅由 stat 取得，成本極低；唯有實際變動才重新解析 SQLite。
  if (McpConfigService.isVsCode) {
    let lastSignature = McpConfigService.enablementSignature();

    const syncNativeEnablement = () => {
      const signature = McpConfigService.enablementSignature();
      if (signature === lastSignature) return;
      lastSignature = signature;
      // 使用者於 VS Code 原生 UI 切換開關後，面板即時跟進
      provider.refreshWebviewData(true, 0, true);
    };

    const poll = setInterval(() => {
      if (vscode.window.state.focused) syncNativeEnablement();
    }, 1500);
    context.subscriptions.push({ dispose: () => clearInterval(poll) });

    // 回到 VS Code 視窗時立即校正，避免等待輪詢週期
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) syncNativeEnablement();
      })
    );
  }

  // 監聽全域語言變動設定 (支援跨外掛即時聯動廣播)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravity.locale') || e.affectsConfiguration('scriptRunner.locale')) {
        syncLocaleContext();
        provider.broadcastLocale(resolveLocale());
        // 狀態列提示由 Extension Host 產生，不會隨 webview 重繪，
        // 故語言變更時主動重算一次（force 略過指紋比對）。
        provider.refreshWebviewData(true, 0, true);
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
