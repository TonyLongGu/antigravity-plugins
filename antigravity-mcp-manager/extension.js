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
// Cline 純檢視（showClineMcpViewer 直接使用）；
// 其 init(context) 已由 McpConfigService.init 統一完成，勿重複呼叫。
const ClineMcpService = require('./services/clineMcpService');

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
  try {
    await vscode.workspace.getConfiguration('scriptRunner').update('locale', locale, vscode.ConfigurationTarget.Global);
  } catch (_) {}
  try {
    const quotaLocale = vscode.workspace.getConfiguration('aiQuota').get('locale');
    if (quotaLocale && quotaLocale !== 'auto') {
      await vscode.workspace.getConfiguration('aiQuota').update('locale', locale, vscode.ConfigurationTarget.Global);
    }
  } catch (_) {}
}

/**
 * 側邊欄 WebviewViewProvider 實作
 */
class MCPManagerViewProvider {
  constructor(extensionUri, statusBarItem, context) {
    this._extensionUri = extensionUri;
    this._statusBarItem = statusBarItem;
    this._context = context;
    this._view = undefined;
    this._panel = undefined;
    this._refreshDebounceTimer = null;
    this._lastFingerprint = '';
    // 顯示範圍不再由 provider 持有：一律讀 McpConfigService.displayMode（單一真相來源），
    // 使用者在設定 UI 變更時由 onDidChangeConfiguration 觸發刷新。
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
   * Cursor / VS Code 不提供此介面。
   * @param {vscode.ViewColumn} [column=vscode.ViewColumn.Beside]
   */
  async openInEditor(column = vscode.ViewColumn.Beside) {
    if (McpConfigService.isViewOnly) return;

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
        const { name, disabled, sourceType } = message;
        try {
          await McpConfigService.toggleServer(name, disabled, sourceType);
          await this.refreshWebviewData();
          this.pushToast(I18n.t(disabled ? 'toast_toggled_off' : 'toast_toggled_on', { name }), disabled ? 'warning' : 'success');
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
          await McpConfigService.batchToggle(action);
          await this.refreshWebviewData(true); // 立即推播最新資料，繞過 120ms 防抖
          const isEnable = action === 'enableAll' || action === 'enable_all';
          const isDisable = action === 'disableAll' || action === 'disable_all';
          const actionText = I18n.t(isEnable ? 'action_enable_all' : isDisable ? 'action_disable_all' : 'action_invert');
          this.pushToast(I18n.t('toast_batch_done', { env: McpConfigService.envName, action: actionText }), 'success');
          vscode.window.setStatusBarMessage(I18n.t('status_batch_done', { env: McpConfigService.envName }), 5000);
        } catch (err) {
          this.pushToast(I18n.t('toast_batch_failed', { msg: err.message }), 'danger');
          await this.refreshWebviewData(true);
        }
        break;
      }

      case 'testServer': {
        const { name } = message;
        try {
          const globalData = await McpConfigService.getGlobalData(McpConfigService.displayMode);
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

      case 'setDisplaySource': {
        const { source } = message;
        await McpConfigService.setDisplayMode(source);
        await this.refreshWebviewData(true, 0, true);
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

  /**
   * 追加單一 MCP 來源區段（名稱 + 統計 + 已啟用清單）
   * 主要來源與次要來源共用同一種呈現，避免兩段各寫一份而再度不一致
   * @param {object|null} source { name, stats, enabledNames, parseError }
   */
  _appendSourceTooltip(tooltip, source) {
    if (!source) return;

    if (source.parseError) {
      tooltip.appendMarkdown(`**${source.name}** $(warning) ${I18n.t('tooltip_copilot_cli_parse_error')}\n\n\n---\n\n`);
      return;
    }

    const stats = source.stats || { total: 0, enabled: 0, disabled: 0 };
    const icon = stats.enabled > 0 ? '$(pass-filled)' : '$(circle-slash)';
    tooltip.appendMarkdown(`**${source.name}** ${icon} \`${stats.enabled} / ${stats.total}\`\n\n`);

    const enabledNames = source.enabledNames || [];
    if (enabledNames.length > 0) {
      enabledNames.forEach((name) => tooltip.appendMarkdown(`• \`${name}\`\n`));
      if (stats.disabled > 0) {
        tooltip.appendMarkdown(`\n*(其餘 ${stats.disabled} 個已停用)*\n`);
      }
    } else {
      tooltip.appendMarkdown(`*${I18n.t('status_tooltip_none')}*\n`);
    }

    tooltip.appendMarkdown(`\n---\n\n`);
  }

  async refreshWebviewData(immediate = false, delayMs = 120, force = false) {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }

    const doRefresh = async () => {
      try {
        const globalData = await McpConfigService.getGlobalData(McpConfigService.displayMode);
        const servers = (globalData.config && globalData.config.mcpServers) || {};
        const clineServers = globalData.clineServers || {};
        const copilotCliServers = globalData.copilotCliServers || {};
        const fingerprint = JSON.stringify({
          path: globalData.path,
          viewOnly: globalData.viewOnly === true,
          displaySource: McpConfigService.displayMode,
          stats: globalData.stats || { total: 0, enabled: 0, disabled: 0 },
          // Cline 為獨立的設定檔來源，且 Cline 端開關不受本套件控制，
          // 故其統計與清單必須納入指紋，否則只改 Cline 設定時狀態列不會更新。
          clineStats: globalData.clineStats || { total: 0, enabled: 0, disabled: 0 },
          clineServers: Object.keys(clineServers)
            .sort()
            .map((name) => [name, clineServers[name].disabled === true]),
          // Copilot CLI 同為獨立設定檔來源：清單變更（含停用數不變的增刪）也要反映
          copilotCliStats: globalData.copilotCliStats || { total: 0, enabled: 0, disabled: 0 },
          copilotCliServers: Object.keys(copilotCliServers)
            .sort()
            .map((name) => [name, copilotCliServers[name].disabled === true]),
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
          const isCline = globalData.isClineInstalled;
          // stats 已是「主要來源」的數字（VS Code 宿主在 Copilot CLI 有伺服器時即為 CLI）
          const stats = globalData.stats || { total: 0, enabled: 0, disabled: 0 };
          const clineStats = globalData.clineStats || { total: 0, enabled: 0, disabled: 0 };
          const primaryShort = globalData.primarySourceShort || McpConfigService.nativeSourceShort;

          // 狀態列簡潔文字（顯示範圍一律取自 McpConfigService.displayMode，單一真相來源）
          const currentMode = McpConfigService.displayMode;

          if (isCline) {
            if (currentMode === 'antigravity') {
              this._statusBarItem.text = `$(plug) MCP: ${primaryShort} ${stats.enabled}/${stats.total}`;
            } else if (currentMode === 'cline') {
              this._statusBarItem.text = `$(plug) MCP (Cline): ${clineStats.enabled}/${clineStats.total}`;
            } else {
              this._statusBarItem.text = `$(plug) MCP: ${primaryShort} ${stats.enabled}/${stats.total} · Cline ${clineStats.enabled}/${clineStats.total}`;
            }
          } else {
            this._statusBarItem.text = `$(plug) MCP: ${stats.enabled}/${stats.total}`;
          }

          // 懸停視窗 (MarkdownString，支援 Codicons 與 Rich Markdown)
          const tooltip = new vscode.MarkdownString('', true);
          tooltip.isTrusted = true;
          tooltip.supportThemeIcons = true;

          // 第一段 = 主要來源（VS Code 宿主可能是 Copilot CLI），第二段 = 另一個來源（若有內容）
          const primaryLabel = I18n.t('tooltip_antigravity_mcp', {
            name: globalData.primarySourceName || McpConfigService.nativeSourceName,
          });
          const primarySection = {
            name: primaryLabel,
            stats,
            enabledNames: globalData.primaryEnabledNames || globalData.agEnabledNames || [],
            parseError: false,
          };
          const secondarySection = globalData.secondarySource
            ? {
                name: I18n.t('tooltip_antigravity_mcp', { name: globalData.secondarySource.name }),
                stats: globalData.secondarySource.stats,
                enabledNames: globalData.secondarySource.enabledNames,
                parseError: globalData.secondarySource.parseError === true,
              }
            : null;

          if (isCline) {
            tooltip.appendMarkdown(`### $(plug) ${I18n.t('tooltip_mcp_dashboard')}\n\n`);

            // 1. 主要來源啟用狀態
            this._appendSourceTooltip(tooltip, primarySection);

            // 2. 次要來源（Copilot CLI 或 VS Code 自身，視主要來源而定）
            this._appendSourceTooltip(tooltip, secondarySection);

            // 3. Cline 啟用狀態
            this._appendSourceTooltip(tooltip, {
              name: I18n.t('tooltip_cline_mcp'),
              stats: clineStats,
              enabledNames: globalData.clineEnabledNames || [],
            });

            const modeNames = {
              antigravity: I18n.t('menu_mode_antigravity', {
                name: globalData.primarySourceName || McpConfigService.nativeSourceName,
              }),
              cline: I18n.t('menu_mode_cline'),
              both: I18n.t('menu_mode_both'),
            };
            const currentModeText = modeNames[McpConfigService.displayMode] || modeNames.both;
            tooltip.appendMarkdown(`$(filter) ${I18n.t('tooltip_current_display')}: **${currentModeText}**\n\n`);
            tooltip.appendMarkdown(`$(info) ${I18n.t('tooltip_click_hint')}`);
          } else {
            tooltip.appendMarkdown(`### $(plug) ${I18n.t('status_tooltip_title', { env: globalData.envName })}\n\n`);
            this._appendSourceTooltip(tooltip, primarySection);
            this._appendSourceTooltip(tooltip, secondarySection);
            tooltip.appendMarkdown(`$(info) ${I18n.t('tooltip_click_hint')}`);
          }

          this._statusBarItem.tooltip = tooltip;
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
      const cnPath = path.join(this._extensionUri.fsPath, 'locales', 'zh-CN.json');
      const enPath = path.join(this._extensionUri.fsPath, 'locales', 'en.json');
      if (fs.existsSync(zhPath)) {
        locales['zh-TW'] = JSON.parse(await fsPromises.readFile(zhPath, 'utf-8'));
      }
      if (fs.existsSync(cnPath)) {
        locales['zh-CN'] = JSON.parse(await fsPromises.readFile(cnPath, 'utf-8'));
      }
      if (fs.existsSync(enPath)) {
        locales['en'] = JSON.parse(await fsPromises.readFile(enPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load external locales:', e);
    }

    const currentLocale = resolveLocale();

    // 僅注入前端實際消費的欄位：app.js 以 hostKind / viewOnly / isCursor 決定外觀；
    // isVsCode / isClineInstalled / displaySource 皆未被消費，故不再注入。
    const initData = {
      locales,
      initialLocale: currentLocale,
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
  // 舊版顯示範圍存於 globalState，開機時一次性遷移進設定，貫徹單一真相來源
  await McpConfigService.migrateLegacyDisplayMode(context);
  // Cursor / VS Code 不能在此面板改開關，左側活動列不顯示；
  // 未設定時 when 為假，活動列預設隱藏，避免這兩個環境先閃出圖示。
  const showSidebar = !McpConfigService.isViewOnly;
  const syncLocaleContext = () => {
    vscode.commands.executeCommand('setContext', 'mcpManager.isEnglish', resolveLocale() === 'en');
    vscode.commands.executeCommand('setContext', 'mcpManager.showSidebar', showSidebar);
  };
  syncLocaleContext();

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  // 點擊下方工具列彈出選擇視窗 (不直接開啟側邊欄)
  statusBarItem.command = 'antigravity.mcp.openQuickMenu';
  statusBarItem.text = `$(plug) ${I18n.t('status_loading')}`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const provider = new MCPManagerViewProvider(context.extensionUri, statusBarItem, context);
  if (showSidebar) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('antigravity.mcpManagerView', provider, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
  }

  // 初始化載入狀態
  await provider.refreshWebviewData();

  // 註冊 VS Code 指令
  const openInEditorHandler = async () => {
    await provider.openInEditor();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.mcp.openQuickMenu', async () => {
      await showQuickMenu(provider);
    }),
    vscode.commands.registerCommand('antigravity.mcp.toggleDisplayMode', async () => {
      await promptChangeDisplayMode(provider);
    }),
    vscode.commands.registerCommand('antigravity.mcp.viewClineMcp', async () => {
      await showClineMcpViewer();
    }),
    vscode.commands.registerCommand('antigravity.mcp.openInEditor', openInEditorHandler),
    vscode.commands.registerCommand('antigravity.mcp.openInEditor.en', openInEditorHandler),
    vscode.commands.registerCommand('antigravity.mcp.refresh', async () => {
      await provider.refreshWebviewData(true, 0, true);
      if (!McpConfigService.isViewOnly) {
        provider.pushToast(I18n.t('toast_refreshed'), 'info');
      }
    }),
    vscode.commands.registerCommand('antigravity.mcp.focusView', async () => {
      if (McpConfigService.isViewOnly) return;
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

    // Cline MCP 設定檔監聽
    if (McpConfigService.isClineInstalled && McpConfigService.clineConfigPath) {
      try {
        const clinePath = McpConfigService.clineConfigPath;
        const clineDir = path.dirname(clinePath);
        const clineName = path.basename(clinePath);
        const clineWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(clineDir), clineName)
        );
        clineWatcher.onDidChange(() => provider.refreshWebviewData());
        clineWatcher.onDidCreate(() => provider.refreshWebviewData());
        clineWatcher.onDidDelete(() => provider.refreshWebviewData());
        context.subscriptions.push(clineWatcher);
      } catch (e) {}
    }

    // Copilot CLI MCP 設定檔監聽（該來源僅在 VS Code 面板並列顯示）
    if (McpConfigService.isVsCode && McpConfigService.copilotCliConfigPath) {
      try {
        const copilotPath = McpConfigService.copilotCliConfigPath;
        const copilotWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(path.dirname(copilotPath)), path.basename(copilotPath))
        );
        copilotWatcher.onDidChange(() => provider.refreshWebviewData());
        copilotWatcher.onDidCreate(() => provider.refreshWebviewData());
        copilotWatcher.onDidDelete(() => provider.refreshWebviewData());
        context.subscriptions.push(copilotWatcher);
      } catch (e) {}
    }
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
      if (e.affectsConfiguration('antigravity.mcp.displayMode')) {
        provider.refreshWebviewData(true, 0, true);
      }
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

/**
 * 彈出 MCP 快捷選擇視窗 (QuickPick)
 * 參考 aiQuota (antigravity-quota-status) 之互動典範：
 * 1. 頂層精簡清晰：重新整理、檢視 Cline MCP（純檢視）、切換顯示方式（子彈窗）、面板開啟、設定檔開啟、Antigravity 批次控制
 * 2. 側邊欄專屬 Antigravity，Cline 僅在下方工具列純檢視
 */
async function showQuickMenu(provider) {
  try {
    const globalData = await McpConfigService.getGlobalData();
    const isCline = globalData.isClineInstalled;
    const items = [];

    // 1. 重新載入
    items.push({
      label: `$(refresh) ${I18n.t('menu_refresh')}`,
      description: I18n.t('menu_refresh_desc'),
      action: 'refresh',
    });

    // 2. 若安裝了 Cline，提供專屬的「檢視 Cline MCP」與「切換狀態列顯示方式」
    if (isCline) {
      const clineStats = globalData.clineStats || { enabled: 0, total: 0 };
      items.push({
        label: `$(eye) ${I18n.t('menu_view_cline')}`,
        description: `(${clineStats.enabled}/${clineStats.total})`,
        detail: I18n.t('menu_view_cline_desc'),
        action: 'viewCline',
      });

      const currentMode = McpConfigService.displayMode;
      const nativeName = globalData.primarySourceName || McpConfigService.nativeSourceName;
      const modeLabels = {
        both: I18n.t('mode_both_label'),
        antigravity: I18n.t('mode_antigravity_label', { name: nativeName }),
        cline: I18n.t('mode_cline_label'),
      };

      items.push({
        label: `$(symbol-enum) ${I18n.t('menu_toggle_display_mode')}`,
        description: `[${modeLabels[currentMode] || currentMode}]`,
        detail: I18n.t('menu_toggle_display_mode_desc', { name: nativeName }),
        action: 'toggleDisplayMode',
      });
    }

    // 3. 儀表板面板
    items.push({
      label: I18n.t('quickmenu_group_actions'),
      kind: vscode.QuickPickItemKind.Separator,
    });

    const showSidebar = !McpConfigService.isViewOnly;
    if (showSidebar) {
      items.push({
        label: `$(layout-sidebar-left) ${I18n.t('menu_open_sidebar')}`,
        description: I18n.t('menu_open_sidebar_desc'),
        action: 'openSidebar',
      });
    }

    if (!McpConfigService.isViewOnly) {
      items.push({
        label: `$(split-horizontal) ${I18n.t('menu_open_in_editor')}`,
        description: I18n.t('menu_open_in_editor_desc'),
        action: 'openInEditor',
      });
    }

    // 4. 設定檔開啟
    items.push({
      label: I18n.t('quickmenu_group_configs'),
      kind: vscode.QuickPickItemKind.Separator,
    });

    items.push({
      label: `$(file-code) ${I18n.t('menu_open_antigravity_config', { name: McpConfigService.nativeSourceName })}`,
      description: McpConfigService.globalConfigPath,
      action: 'openConfig',
      path: McpConfigService.globalConfigPath,
    });

    if (isCline && globalData.clineConfigPath) {
      items.push({
        label: `$(file-code) ${I18n.t('menu_open_cline_config')}`,
        description: globalData.clineConfigPath,
        action: 'openConfig',
        path: globalData.clineConfigPath,
      });
    }

    // Copilot CLI 設定檔（唯讀來源；與 VS Code 的 mcp.json 是兩份不同檔案，
    // 故即使在 VS Code 宿主也要獨立列出，否則使用者找不到面板上那些 CLI 條目的來源）
    if (globalData.isCopilotCliAvailable && globalData.copilotCliConfigPath) {
      items.push({
        label: `$(file-code) ${I18n.t('menu_open_copilot_cli_config')}`,
        description: globalData.copilotCliConfigPath,
        action: 'openConfig',
        path: globalData.copilotCliConfigPath,
      });
    }

    // 5. Antigravity 批次控制
    if (!McpConfigService.isViewOnly) {
      items.push({
        label: I18n.t('quickmenu_group_batch'),
        kind: vscode.QuickPickItemKind.Separator,
      });

      items.push({
        label: `$(pass) ${I18n.t('btn_enable_all')}`,
        description: I18n.t('menu_batch_enable_desc'),
        action: 'batch',
        batchAction: 'enable_all',
      });

      items.push({
        label: `$(circle-slash) ${I18n.t('btn_disable_all')}`,
        description: I18n.t('menu_batch_disable_desc'),
        action: 'batch',
        batchAction: 'disable_all',
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: I18n.t('quickmenu_placeholder'),
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    switch (selected.action) {
      case 'refresh': {
        await provider.refreshWebviewData(true, 0, true);
        provider.pushToast(I18n.t('toast_refreshed'), 'info');
        break;
      }
      case 'viewCline': {
        await showClineMcpViewer();
        break;
      }
      case 'toggleDisplayMode': {
        await promptChangeDisplayMode(provider);
        break;
      }
      case 'openSidebar': {
        await vscode.commands.executeCommand('antigravity.mcpManagerView.focus');
        break;
      }
      case 'openInEditor': {
        await provider.openInEditor();
        break;
      }
      case 'openConfig': {
        await SystemService.openConfigFile(selected.path);
        break;
      }
      case 'batch': {
        try {
          await McpConfigService.batchToggle(selected.batchAction);
          await provider.refreshWebviewData(true, 0, true);
          const isEnable = selected.batchAction === 'enable_all';
          const actionText = I18n.t(isEnable ? 'action_enable_all' : 'action_disable_all');
          provider.pushToast(I18n.t('toast_batch_done', { env: McpConfigService.envName, action: actionText }), 'success');
        } catch (err) {
          provider.pushToast(I18n.t('toast_batch_failed', { msg: err.message }), 'danger');
        }
        break;
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`[MCP QuickMenu] ${err.message}`);
  }
}

/**
 * 切換狀態列顯示方式彈窗 (參考 antigravity-quota-status 之 promptChangeDisplayMode 規範)
 */
async function promptChangeDisplayMode(provider) {
  const current = McpConfigService.displayMode;

  const globalData = await McpConfigService.getGlobalData();
  // 「本 IDE」的標籤與數字一律跟隨主要來源（VS Code 宿主在 Copilot CLI 有伺服器時即為 CLI）
  const stats = globalData.stats || { enabled: 0, total: 0 };
  const clineStats = globalData.clineStats || { enabled: 0, total: 0 };

  const name = globalData.primarySourceName || McpConfigService.nativeSourceName;
  const modes = [
    {
      label: I18n.t('mode_both_label'),
      description: I18n.t('mode_both_desc', { name }),
      detail: `${name}: ${stats.enabled}/${stats.total} · Cline: ${clineStats.enabled}/${clineStats.total}`,
      value: 'both',
      picked: current === 'both',
    },
    {
      label: I18n.t('mode_antigravity_label', { name }),
      description: I18n.t('mode_antigravity_desc', { name }),
      detail: `${name}: ${stats.enabled}/${stats.total}`,
      value: 'antigravity',
      picked: current === 'antigravity',
    },
    {
      label: I18n.t('mode_cline_label'),
      description: I18n.t('mode_cline_desc'),
      detail: `Cline: ${clineStats.enabled}/${clineStats.total}`,
      value: 'cline',
      picked: current === 'cline',
    },
  ];

  const selected = await vscode.window.showQuickPick(modes, {
    placeHolder: I18n.t('mode_placeholder'),
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected) {
    await McpConfigService.setDisplayMode(selected.value);
    await provider.refreshWebviewData(true, 0, true);
    vscode.window.setStatusBarMessage(
      I18n.t('status_mode_updated', { mode: selected.label }),
      3000
    );
  }
}

/**
 * 下方工具列專屬：檢視 Cline MCP 工具清單與狀態 (純檢視，不提供側邊開關)
 */
async function showClineMcpViewer() {
  try {
    const clineData = await ClineMcpService.getServers();
    const servers = clineData.servers || {};
    const configPath = clineData.path || '';
    const serverKeys = Object.keys(servers);

    if (serverKeys.length === 0) {
      vscode.window.showInformationMessage(
        I18n.t('empty_no_config', { path: configPath || 'cline_mcp_settings.json' })
      );
      return;
    }

    const items = [
      {
        label: `$(file-code) ${I18n.t('cline_viewer_open_config')}`,
        description: configPath,
        detail: I18n.t('cline_viewer_open_config_desc'),
        action: 'openConfig',
        path: configPath,
      },
      {
        label: I18n.t('cline_viewer_title'),
        kind: vscode.QuickPickItemKind.Separator,
      },
    ];

    // 已啟用的排在前面，停用的排在後面
    const sortedKeys = serverKeys.sort((a, b) => {
      const aOn = servers[a].disabled !== true;
      const bOn = servers[b].disabled !== true;
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.localeCompare(b);
    });

    for (const key of sortedKeys) {
      const s = servers[key];
      const isEnabled = s.disabled !== true;
      const icon = isEnabled ? '$(pass-filled)' : '$(circle-slash)';
      const statusText = I18n.t(isEnabled ? 'cline_status_enabled' : 'cline_status_disabled');
      const targetDetail = s.serverUrl || s.url || (s.command ? `${s.command} ${(s.args || []).join(' ')}` : (s.type || ''));

      items.push({
        label: `${icon} ${key}`,
        description: `[${statusText}] ${s.description || ''}`,
        detail: targetDetail,
        action: 'viewDetail',
        server: s,
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: I18n.t('cline_viewer_placeholder'),
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    if (selected.action === 'openConfig') {
      await SystemService.openConfigFile(selected.path);
    } else if (selected.action === 'viewDetail') {
      const s = selected.server;
      const isEnabled = s.disabled !== true;
      const statusText = I18n.t(isEnabled ? 'cline_status_enabled' : 'cline_status_disabled');
      const lines = [
        `【Cline MCP: ${s.name}】`,
        `狀態: ${statusText}`,
        s.type ? `類型: ${s.type}` : '',
        s.url || s.serverUrl ? `URL: ${s.url || s.serverUrl}` : '',
        s.command ? `命令: ${s.command} ${(s.args || []).join(' ')}` : '',
        s.env ? `環境變數: ${Object.keys(s.env).join(', ')}` : '',
        s.description ? `說明: ${s.description}` : '',
      ].filter(Boolean).join('\n');

      const choice = await vscode.window.showInformationMessage(
        lines,
        { modal: true },
        I18n.t('cline_viewer_open_config')
      );
      if (choice === I18n.t('cline_viewer_open_config')) {
        await SystemService.openConfigFile(configPath);
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`[Cline MCP Viewer] ${err.message}`);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
