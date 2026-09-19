const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ContextScannerService = require('./services/contextScannerService');
const TranscriptParserService = require('./services/transcriptParserService');
const CursorTranscriptService = require('./services/cursorTranscriptService');
const VsCodeChatSessionService = require('./services/vscodeChatSessionService');
const McpDetectorService = require('./services/mcpDetectorService');

class AiContextViewProvider {
  constructor(extensionUri, context = null) {
    this._extensionUri = extensionUri;
    this._context = context;
    this._view = null;
    this._panel = null;
    const appName = vscode.env.appName || '';
    this._isVsCode = !/antigravity/i.test(appName);
    this._isCursor = /cursor/i.test(appName);
    this._currentMode = context?.workspaceState?.get('aiContext.mode') || 'live';
    this._selectedConvId = context?.workspaceState?.get('aiContext.selectedConvId') || null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 監聽前端 Webview 傳來的訊息
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      await this._handleMessage(msg);
    });

    webviewView.onDidDispose(() => {
      this._view = null;
    });

    // 監聽側邊欄視圖可見度切換（從背景切回前台時自動刷新最新上下文，切到後台時收合子卡片）
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.pushData();
      } else {
        this.collapseSubcards();
      }
    });

    // 初次載入數據
    this.pushData();
  }

  /**
   * 在編輯器分頁中開啟 AI 上下文檢視器 (向右分割 ViewColumn.Beside 並自動鎖定群組)
   * @param {vscode.ViewColumn} [column=vscode.ViewColumn.Beside]
   */
  async openInEditor(column = vscode.ViewColumn.Beside) {
    if (this._panel) {
      this._panel.reveal(column);
      this._lockEditorGroup();
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'antigravity.aiContextEditor',
      'AI 上下文檢視器',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri]
      }
    );

    // 雙主題圖示配置 (深色灰白 #CCCCCC，淺色深灰 #424242)
    this._panel.iconPath = {
      dark: vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'inspector-icon-dark.svg'),
      light: vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'inspector-icon-light.svg')
    };

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      await this._handleMessage(msg);
    });

    this._panel.onDidChangeViewState((e) => {
      if (!e.webviewPanel.active) {
        this.collapseSubcards();
      }
    });

    this._panel.onDidDispose(() => {
      this._panel = null;
    });

    this.pushData(0);

    // 自動鎖定該編輯器群組 (避免後續點選代碼檔案覆蓋檢視器)
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
   * 已安裝擴充套件中帶 skills/ 目錄者（VS Code Copilot「擴充」技能）
   */
  _listExtensionSkillDirs() {
    const dirs = [];
    const seen = new Set();
    for (const ext of vscode.extensions.all) {
      try {
        const extPath = ext.extensionUri.fsPath;
        const skillsDir = path.join(extPath, 'skills');
        const key = skillsDir.toLowerCase();
        if (seen.has(key) || !fs.existsSync(skillsDir)) continue;
        seen.add(key);
        dirs.push({
          dir: skillsDir,
          source: (ext.packageJSON && (ext.packageJSON.displayName || ext.packageJSON.name)) || ext.id
        });
      } catch {}
    }
    return dirs;
  }

  /**
   * 統一前端訊息處理器
   */
  async _handleMessage(msg) {
    switch (msg.type) {
      case 'fetchData':
        this._currentMode = msg.payload?.mode || this._currentMode;
        this._selectedConvId = msg.payload?.conversationId || this._selectedConvId;
        
        // 持久化記錄狀態
        if (this._context?.workspaceState) {
          this._context.workspaceState.update('aiContext.mode', this._currentMode);
          this._context.workspaceState.update('aiContext.selectedConvId', this._selectedConvId);
        }

        await this.pushData();
        break;

      case 'openFile':
        if (msg.payload?.filePath) {
          this.openFileInEditor(msg.payload.filePath);
        }
        break;

      case 'openMcpDir': {
        try {
          const userHome = process.env.USERPROFILE || require('node:os').homedir();
          if (this._isCursor) {
            const cursorMcpFile = path.join(userHome, '.cursor', 'mcp.json');
            if (fs.existsSync(cursorMcpFile)) {
              this.openFileInEditor(cursorMcpFile);
              break;
            }
            const cursorDir = path.join(userHome, '.cursor');
            if (!fs.existsSync(cursorDir)) {
              fs.mkdirSync(cursorDir, { recursive: true });
            }
            if (process.platform === 'win32') {
              cp.execFile('explorer.exe', [cursorDir]);
            } else {
              await vscode.env.openExternal(vscode.Uri.file(cursorDir));
            }
            break;
          }
          if (this._isVsCode) {
            const vscodeMcpFile = path.join(McpDetectorService.getVsCodeUserDir(), 'mcp.json');
            if (fs.existsSync(vscodeMcpFile)) {
              this.openFileInEditor(vscodeMcpFile);
              break;
            }
            const vscodeUserDir = McpDetectorService.getVsCodeUserDir();
            if (!fs.existsSync(vscodeUserDir)) {
              fs.mkdirSync(vscodeUserDir, { recursive: true });
            }
            if (process.platform === 'win32') {
              cp.execFile('explorer.exe', [vscodeUserDir]);
            } else {
              await vscode.env.openExternal(vscode.Uri.file(vscodeUserDir));
            }
            break;
          }
          const mcpDir = path.join(userHome, '.gemini', 'antigravity-ide', 'mcp');
          if (!fs.existsSync(mcpDir)) {
            fs.mkdirSync(mcpDir, { recursive: true });
          }
          if (process.platform === 'win32') {
            cp.execFile('explorer.exe', [mcpDir]);
          } else {
            await vscode.env.openExternal(vscode.Uri.file(mcpDir));
          }
        } catch (err) {
          vscode.window.showErrorMessage(`無法開啟 MCP 目錄: ${err.message}`);
        }
        break;
      }

      case 'revealInExplorer': {
        if (msg.payload?.targetPath) {
          try {
            if (fs.existsSync(msg.payload.targetPath)) {
              await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(msg.payload.targetPath));
            } else {
              vscode.window.showErrorMessage(`路徑不存在: ${msg.payload.targetPath}`);
            }
          } catch (err) {
            vscode.window.showErrorMessage(`無法跳轉至檔案總管: ${err.message}`);
          }
        }
        break;
      }

      case 'copyText':
      case 'copyToClipboard': {
        if (msg.payload?.text) {
          try {
            await vscode.env.clipboard.writeText(msg.payload.text);
            const label = msg.payload.label ? `已複製${msg.payload.label}：${msg.payload.text}` : `已複製至剪貼簿：${msg.payload.text}`;
            this.pushToast(label, 'success');
          } catch (err) {
            vscode.window.showErrorMessage(`複製失敗: ${err.message}`);
          }
        }
        break;
      }

      case 'refresh':
        await this.pushData();
        this.pushToast('狀態已重新整理', 'info');
        break;

      case 'setGlobalLocale': {
        const { locale } = msg.payload || msg;
        try {
          await vscode.workspace.getConfiguration('antigravity').update('locale', locale, vscode.ConfigurationTarget.Global);
        } catch (err) {
          console.error('Failed to update global locale in context inspector:', err);
        }
        break;
      }

      case 'showToast': {
        const text = msg.payload?.message || msg.message || '';
        const type = msg.payload?.type || msg.toastType || 'info';
        if (text) this.pushToast(text, type);
        break;
      }

      case 'showError': {
        const errText = msg.payload?.message || msg.message || '未知錯誤';
        vscode.window.showErrorMessage(errText);
        break;
      }
    }
  }

  async openFileInEditor(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`檔案不存在: ${filePath}`);
        return;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        if (process.platform === 'win32') {
          cp.execFile('explorer.exe', [filePath]);
        } else {
          await vscode.env.openExternal(vscode.Uri.file(filePath));
        }
      } else {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    } catch (err) {
      vscode.window.showErrorMessage(`無法開啟: ${err.message}`);
    }
  }

  collapseSubcards() {
    const payload = { type: 'collapseSubcards' };
    if (this._view) {
      this._view.webview.postMessage(payload);
    }
    if (this._panel) {
      this._panel.webview.postMessage(payload);
    }
  }

  pushToast(message, status = 'info') {
    const payload = {
      type: 'toast',
      payload: { message, status }
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

  pushData(delay = 80) {
    if (this._pushTimer) {
      clearTimeout(this._pushTimer);
    }
    this._pushTimer = setTimeout(async () => {
      this._pushTimer = null;
      if (!this._view && !this._panel) return;

      try {
        let data;
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        if (this._isCursor) {
          if (this._currentMode === 'snapshot') {
            data = await CursorTranscriptService.parseConversationSnapshot(this._selectedConvId, workspaceFolders);
          } else {
            data = await ContextScannerService.scanLiveEnvironment(workspaceFolders, {
              isVsCode: true,
              isCursor: true
            });
          }
          const convList = await CursorTranscriptService.getConversationsList(workspaceFolders);
          data.conversationsList = convList.map(c => ({
            id: c.id,
            title: c.title,
            workspace: c.workspace,
            mtime: c.mtime,
            mtimeStr: c.mtimeStr
          }));
          data.isVsCode = true;
          data.isCursor = true;
        } else if (this._isVsCode) {
          const extraUris = vscode.workspace.workspaceFile ? [vscode.workspace.workspaceFile.fsPath] : [];
          const scanOptions = {
            isVsCode: true,
            isCursor: false,
            appRoot: vscode.env.appRoot,
            extensionSkillDirs: this._listExtensionSkillDirs(),
            extraUris
          };
          if (this._currentMode === 'snapshot') {
            data = await VsCodeChatSessionService.parseConversationSnapshot(this._selectedConvId, workspaceFolders, scanOptions);
          } else {
            data = await ContextScannerService.scanLiveEnvironment(workspaceFolders, scanOptions);
          }
          const convList = await VsCodeChatSessionService.getConversationsList(workspaceFolders, extraUris);
          data.conversationsList = convList.map(c => ({
            id: c.id,
            title: c.title,
            workspace: c.workspace,
            mtime: c.mtime,
            mtimeStr: c.mtimeStr
          }));
          data.isVsCode = true;
          data.isCursor = false;
        } else {
          if (this._currentMode === 'snapshot') {
            data = await TranscriptParserService.parseConversationSnapshot(this._selectedConvId, workspaceFolders);
          } else {
            data = await ContextScannerService.scanLiveEnvironment(workspaceFolders, { isVsCode: false });
          }

          // 同時取得對話清單供前端下拉選單使用
          const convList = await TranscriptParserService.getConversationsList();
          data.conversationsList = convList.map(c => ({
            id: c.id,
            title: c.title,
            workspace: c.workspace,
            mtime: c.mtime,
            mtimeStr: c.mtimeStr
          }));
          data.isVsCode = false;
          data.isCursor = false;
        }

        const updatePayload = {
          type: 'updateData',
          payload: data
        };

        if (this._view) {
          this._view.webview.postMessage(updatePayload);
        }
        if (this._panel) {
          this._panel.webview.postMessage(updatePayload);
        }
      } catch (err) {
        console.error('Error fetching context data:', err);
        this.pushToast(`獲取資料失敗: ${err.message}`, 'danger');
      }
    }, delay);
  }

  _getHtmlForWebview(webview) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'app.js'));
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const localesPath = path.join(this._extensionUri.fsPath, 'media', 'locales.js');
    let localesJs = '';
    if (fs.existsSync(localesPath)) {
      localesJs = fs.readFileSync(localesPath, 'utf-8');
    }

    const currentLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');
    const isSnapshot = this._currentMode === 'snapshot';

    if (this._isVsCode) {
      html = html.replace('<body>', this._isCursor ? '<body class="is-vscode is-cursor">' : '<body class="is-vscode">');
    }

    return html
      .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
      .replace(/href="style\.css"/g, `href="${styleUri}"`)
      .replace(/src="app\.js"/g, `src="${scriptUri}?v=${Date.now()}"`)
      .replace(/<script src="locales\.js"><\/script>/g, `<script>window.INITIAL_LOCALE = ${JSON.stringify(currentLocale)}; window.INITIAL_IS_VSCODE = ${this._isVsCode}; window.INITIAL_IS_CURSOR = ${this._isCursor};</script><script>${localesJs}</script>`)
      .replace(/\{\{LIVE_ACTIVE\}\}/g, isSnapshot ? '' : 'active')
      .replace(/\{\{SNAPSHOT_ACTIVE\}\}/g, isSnapshot ? 'active' : '')
      .replace(/\{\{CONV_WRAPPER_CLASS\}\}/g, isSnapshot ? '' : 'is-hidden');
  }
}

let activeProvider = null;

function activate(context) {
  activeProvider = new AiContextViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('antigravity.aiContextView', activeProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // 1. 監聽工作區資料夾切換（多工作區切換或移除時自動刷新）
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (activeProvider) {
        activeProvider.pushData(150);
      }
    })
  );

  // 2. 監聽多專案工作區設定檔 (.code-workspace) 檔案變更
  if (vscode.workspace.workspaceFile?.fsPath) {
    try {
      const wsDir = path.dirname(vscode.workspace.workspaceFile.fsPath);
      const wsName = path.basename(vscode.workspace.workspaceFile.fsPath);
      const wsFileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(wsDir, wsName));
      const onWsChange = () => {
        if (activeProvider) activeProvider.pushData(100);
      };
      wsFileWatcher.onDidChange(onWsChange);
      wsFileWatcher.onDidCreate(onWsChange);
      wsFileWatcher.onDidDelete(onWsChange);
      context.subscriptions.push(wsFileWatcher);
    } catch {}
  }

  // 3. 監聽 Rules 與 Skills 檔案變更
  try {
    const agentsWatcher = vscode.workspace.createFileSystemWatcher('**/.agents/**/*.{md,json}');
    const onAgentsChange = () => {
      if (activeProvider) activeProvider.pushData(200);
    };
    agentsWatcher.onDidChange(onAgentsChange);
    agentsWatcher.onDidCreate(onAgentsChange);
    agentsWatcher.onDidDelete(onAgentsChange);
    context.subscriptions.push(agentsWatcher);
  } catch {}

  // 4b. Cursor / VS Code MCP 設定檔變更
  if (activeProvider?._isCursor) {
    try {
      const userHome = process.env.USERPROFILE || require('node:os').homedir();
      const cursorDir = path.join(userHome, '.cursor');
      const cursorMcpWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(cursorDir, 'mcp.json'));
      const onCursorMcpChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      cursorMcpWatcher.onDidChange(onCursorMcpChange);
      cursorMcpWatcher.onDidCreate(onCursorMcpChange);
      cursorMcpWatcher.onDidDelete(onCursorMcpChange);
      context.subscriptions.push(cursorMcpWatcher);
    } catch {}

    try {
      const wsCursorMcpWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/mcp.json');
      const onWsCursorMcpChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      wsCursorMcpWatcher.onDidChange(onWsCursorMcpChange);
      wsCursorMcpWatcher.onDidCreate(onWsCursorMcpChange);
      wsCursorMcpWatcher.onDidDelete(onWsCursorMcpChange);
      context.subscriptions.push(wsCursorMcpWatcher);
    } catch {}

    try {
      const userHome = process.env.USERPROFILE || require('node:os').homedir();
      const projectsDir = path.join(userHome, '.cursor', 'projects');
      const transcriptWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(projectsDir, '**/agent-transcripts/**/*.jsonl')
      );
      const onTranscriptChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      transcriptWatcher.onDidChange(onTranscriptChange);
      transcriptWatcher.onDidCreate(onTranscriptChange);
      transcriptWatcher.onDidDelete(onTranscriptChange);
      context.subscriptions.push(transcriptWatcher);
    } catch {}
  } else if (activeProvider?._isVsCode) {
    try {
      const vscodeUserDir = McpDetectorService.getVsCodeUserDir();
      const vscodeMcpWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscodeUserDir, 'mcp.json'));
      const onVsCodeMcpChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      vscodeMcpWatcher.onDidChange(onVsCodeMcpChange);
      vscodeMcpWatcher.onDidCreate(onVsCodeMcpChange);
      vscodeMcpWatcher.onDidDelete(onVsCodeMcpChange);
      context.subscriptions.push(vscodeMcpWatcher);
    } catch {}

    try {
      const wsVsCodeMcpWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/mcp.json');
      const onWsVsCodeMcpChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      wsVsCodeMcpWatcher.onDidChange(onWsVsCodeMcpChange);
      wsVsCodeMcpWatcher.onDidCreate(onWsVsCodeMcpChange);
      wsVsCodeMcpWatcher.onDidDelete(onWsVsCodeMcpChange);
      context.subscriptions.push(wsVsCodeMcpWatcher);
    } catch {}

    try {
      const wsRoot = path.join(McpDetectorService.getVsCodeUserDir(), 'workspaceStorage');
      const sessionWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(wsRoot, '**/chatSessions/*.jsonl')
      );
      const onSessionChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      sessionWatcher.onDidChange(onSessionChange);
      sessionWatcher.onDidCreate(onSessionChange);
      sessionWatcher.onDidDelete(onSessionChange);
      context.subscriptions.push(sessionWatcher);
    } catch {}

    try {
      const cliRoot = path.join(process.env.USERPROFILE || require('node:os').homedir(), '.copilot', 'session-state');
      const cliWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(cliRoot, '**/events.jsonl')
      );
      const onCliChange = () => {
        if (activeProvider) activeProvider.pushData(200);
      };
      cliWatcher.onDidChange(onCliChange);
      cliWatcher.onDidCreate(onCliChange);
      cliWatcher.onDidDelete(onCliChange);
      context.subscriptions.push(cliWatcher);
    } catch {}
  }

  // 4. 監聽 IDE 視窗焦點（切回視窗時輕量確認最新狀態；焦點離開時收合子卡片）
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && activeProvider) {
        activeProvider.pushData(80);
      } else if (!state.focused && activeProvider) {
        activeProvider.collapseSubcards();
      }
    })
  );

  // 5. 監聽活躍文字編輯器切換（切換至代碼檔案/工具時收合子卡片）
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      activeProvider?.collapseSubcards();
    })
  );

  // 6. 監聽活躍終端機切換（切換至終端機工具時收合子卡片）
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(() => {
      activeProvider?.collapseSubcards();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.aiContext.openInEditor', () => {
      if (activeProvider) {
        activeProvider.openInEditor();
      }
    }),
    vscode.commands.registerCommand('antigravity.aiContext.openInEditor.en', () => {
      if (activeProvider) {
        activeProvider.openInEditor();
      }
    }),
    vscode.commands.registerCommand('antigravity.aiContext.refresh', () => {
      if (activeProvider) {
        activeProvider.pushData(0);
        activeProvider.pushToast('已重新整理 AI 上下文狀態', 'info');
      }
    }),
    vscode.commands.registerCommand('antigravity.aiContext.focusView', () => {
      vscode.commands.executeCommand('antigravity.aiContextView.focus');
    })
  );

  // 5. 監聽全域語言變動 (跨外掛即時聯動廣播)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravity.locale')) {
        const newLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');
        activeProvider?.broadcastLocale(newLocale);
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
