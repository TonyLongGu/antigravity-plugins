const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const I18n = require('./i18n');
const imageService = require('./services/imageService');
const audioService = require('./services/audioService');
const videoService = require('./services/videoService');
const { audioStreamServer } = require('./services/audioStreamServer');
const { videoStreamServer } = require('./services/videoStreamServer');

/**
 * 轉義 PowerShell 單引號字串中的單引號
 * @param {string} str
 * @returns {string}
 */
function escapePs(str) {
  return str.replace(/'/g, "''");
}

/**
 * 取得或建立專屬的 PowerShell 腳本執行終端機
 * @param {string} cwd 工作目錄
 * @param {I18n} i18n
 * @returns {vscode.Terminal}
 */
function getOrCreateTerminal(cwd, i18n) {
  const terminalName = i18n ? i18n.t('terminal_name') : '腳本執行器 (Script Runner)';
  let terminal = vscode.window.terminals.find((t) => t.name === terminalName);
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name: terminalName,
      shellPath: 'powershell.exe',
      cwd: cwd,
    });
  }
  return terminal;
}

/**
 * 解析目標檔案路徑與目錄
 * @param {vscode.Uri} uri
 * @param {I18n} i18n
 * @returns {Promise<{ filePath: string, fileDir: string, fileName: string } | null>}
 */
async function resolveTarget(uri, i18n) {
  let targetUri = uri;
  if (targetUri && !targetUri.scheme && (targetUri.resourceUri || targetUri.fsPath)) {
    targetUri = targetUri.resourceUri || vscode.Uri.file(targetUri.fsPath);
  }
  if (!targetUri && vscode.window.activeTextEditor) {
    targetUri = vscode.window.activeTextEditor.document.uri;
  }
  if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath) {
    vscode.window.showWarningMessage(i18n ? i18n.t('warning_select_file') : '請先在檔案總管中選取或開啟已儲存的實體腳本檔案！');
    return null;
  }
  const filePath = targetUri.fsPath;
  try {
    await fsPromises.access(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      vscode.window.showErrorMessage(i18n ? i18n.t('error_file_not_found', { filePath }) : `檔案不存在：${filePath}`);
      return null;
    }
  }
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  return { filePath, fileDir, fileName };
}

/**
 * 取得腳本執行設定
 * @returns {{ runAsAdmin: boolean, keepWindowOpen: boolean }}
 */
function getRunnerConfig() {
  const config = vscode.workspace.getConfiguration('scriptRunner');
  const runAsAdmin = config.get('runAsAdmin', true);
  const keepWindowOpen = config.get('keepWindowOpen', true);
  return { runAsAdmin, keepWindowOpen };
}

/**
 * 擴充套件啟動進入點
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const i18n = new I18n(context.extensionUri);

  // 1. 執行 Python 腳本 (.py)
  const runPyHandler = async (uri) => {
    const target = await resolveTarget(uri, i18n);
    if (!target) return;

    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.isDirty) {
      await vscode.window.activeTextEditor.document.save();
    }

    const { runAsAdmin, keepWindowOpen } = getRunnerConfig();
    const terminal = getOrCreateTerminal(target.fileDir, i18n);
    terminal.show(true);

    const psSafeDir = escapePs(target.fileDir);
    const psSafePath = escapePs(target.filePath);

    let commandStr = '';
    if (runAsAdmin) {
      const pyArgs = keepWindowOpen
        ? `'-i', '-u', '""${psSafePath}""'`
        : `'-u', '""${psSafePath}""'`;
      commandStr = `Start-Process py.exe -ArgumentList ${pyArgs} -WorkingDirectory '${psSafeDir}' -Verb RunAs`;
    } else {
      commandStr = `Set-Location -LiteralPath '${psSafeDir}'; py -u '${psSafePath}'`;
    }

    terminal.sendText('');
    terminal.sendText(commandStr);

    const statusMsg = runAsAdmin
      ? i18n.t('status_started_admin', { fileName: target.fileName })
      : i18n.t('status_started_terminal', { fileName: target.fileName });
    vscode.window.setStatusBarMessage(statusMsg, 3000);
  };

  // 2. 執行批次檔 (.bat / .cmd) 核心邏輯
  const executeBat = async (uri, asAdmin = false) => {
    const target = await resolveTarget(uri, i18n);
    if (!target) return;

    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.isDirty) {
      await vscode.window.activeTextEditor.document.save();
    }

    const { keepWindowOpen } = getRunnerConfig();
    const terminal = getOrCreateTerminal(target.fileDir, i18n);
    terminal.show(true);

    const psSafeDir = escapePs(target.fileDir);
    const psSafePath = escapePs(target.filePath);

    let commandStr = '';
    if (asAdmin) {
      const cmdFlag = keepWindowOpen ? '/k' : '/c';
      commandStr = `Start-Process cmd.exe -ArgumentList '${cmdFlag}', '""${psSafePath}""' -WorkingDirectory '${psSafeDir}' -Verb RunAs`;
    } else {
      commandStr = `Set-Location -LiteralPath '${psSafeDir}'; & '${psSafePath}'`;
    }

    terminal.sendText('');
    terminal.sendText(commandStr);

    const statusMsg = asAdmin
      ? i18n.t('status_started_admin', { fileName: target.fileName })
      : i18n.t('status_started_terminal', { fileName: target.fileName });
    vscode.window.setStatusBarMessage(statusMsg, 3000);
  };

  const runBatHandler = async (uri) => executeBat(uri, false);
  const runBatAdminHandler = async (uri) => executeBat(uri, true);

  // 3. 執行 PowerShell 腳本 (.ps1) 核心邏輯
  const executePs1 = async (uri, asAdmin = false) => {
    const target = await resolveTarget(uri, i18n);
    if (!target) return;

    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.isDirty) {
      await vscode.window.activeTextEditor.document.save();
    }

    const { keepWindowOpen } = getRunnerConfig();
    const terminal = getOrCreateTerminal(target.fileDir, i18n);
    terminal.show(true);

    const psSafeDir = escapePs(target.fileDir);
    const psSafePath = escapePs(target.filePath);

    let commandStr = '';
    if (asAdmin) {
      const psArgs = keepWindowOpen
        ? `'-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', '""${psSafePath}""'`
        : `'-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', '""${psSafePath}""'`;
      commandStr = `Start-Process powershell.exe -ArgumentList ${psArgs} -WorkingDirectory '${psSafeDir}' -Verb RunAs`;
    } else {
      commandStr = `Set-Location -LiteralPath '${psSafeDir}'; powershell.exe -NoLogo -ExecutionPolicy Bypass -File '${psSafePath}'`;
    }

    terminal.sendText('');
    terminal.sendText(commandStr);

    const statusMsg = asAdmin
      ? i18n.t('status_started_admin', { fileName: target.fileName })
      : i18n.t('status_started_terminal', { fileName: target.fileName });
    vscode.window.setStatusBarMessage(statusMsg, 3000);
  };

  const runPs1Handler = async (uri) => executePs1(uri, false);
  const runPs1AdminHandler = async (uri) => executePs1(uri, true);

  // 4. 檢視資料夾圖片 (內容區工具視窗)
  const viewFolderImagesHandler = async (uri) => {
    let targetUri = uri;
    let initialImagePath = null;
    if (targetUri && !targetUri.scheme && (targetUri.resourceUri || targetUri.fsPath)) {
      targetUri = targetUri.resourceUri || vscode.Uri.file(targetUri.fsPath);
    }
    if (!targetUri) {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '選擇要檢視圖片的資料夾'
      });
      if (selected && selected.length > 0) {
        targetUri = selected[0];
      }
    }

    if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath) {
      vscode.window.showWarningMessage('請選取實體資料夾或圖片檔案以檢視圖片！');
      return;
    }

    try {
      const stat = await fsPromises.stat(targetUri.fsPath);
      if (!stat.isDirectory()) {
        initialImagePath = targetUri.fsPath;
        targetUri = vscode.Uri.file(path.dirname(targetUri.fsPath));
      }
    } catch (err) {
      vscode.window.showErrorMessage(`無法存取路徑：${targetUri.fsPath}`);
      return;
    }

    await ImageViewerPanel.createOrShow(context.extensionUri, targetUri, initialImagePath);
  };

  // 5. 檢視資料夾聲音 (內容區工具視窗)
  const viewFolderAudiosHandler = async (uri) => {
    let targetUri = uri;
    let initialAudioPath = null;
    if (targetUri && !targetUri.scheme && (targetUri.resourceUri || targetUri.fsPath)) {
      targetUri = targetUri.resourceUri || vscode.Uri.file(targetUri.fsPath);
    }
    if (!targetUri) {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '選擇要檢視聲音的資料夾'
      });
      if (selected && selected.length > 0) {
        targetUri = selected[0];
      }
    }

    if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath) {
      vscode.window.showWarningMessage('請選取實體資料夾或聲音檔案以檢視聲音！');
      return;
    }

    try {
      const stat = await fsPromises.stat(targetUri.fsPath);
      if (!stat.isDirectory()) {
        initialAudioPath = targetUri.fsPath;
        targetUri = vscode.Uri.file(path.dirname(targetUri.fsPath));
      }
    } catch (err) {
      vscode.window.showErrorMessage(`無法存取路徑：${targetUri.fsPath}`);
      return;
    }

    await AudioViewerPanel.createOrShow(context.extensionUri, targetUri, initialAudioPath);
  };

  // 6. 檢視資料夾影片 (內容區工具視窗)
  const viewFolderVideosHandler = async (uri) => {
    let targetUri = uri;
    let initialVideoPath = null;
    if (targetUri && !targetUri.scheme && (targetUri.resourceUri || targetUri.fsPath)) {
      targetUri = targetUri.resourceUri || vscode.Uri.file(targetUri.fsPath);
    }
    if (!targetUri) {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '選擇要檢視影片的資料夾'
      });
      if (selected && selected.length > 0) {
        targetUri = selected[0];
      }
    }

    if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath) {
      vscode.window.showWarningMessage('請選取實體資料夾或影片檔案以檢視影片！');
      return;
    }

    try {
      const stat = await fsPromises.stat(targetUri.fsPath);
      if (!stat.isDirectory()) {
        initialVideoPath = targetUri.fsPath;
        targetUri = vscode.Uri.file(path.dirname(targetUri.fsPath));
      }
    } catch (err) {
      vscode.window.showErrorMessage(`無法存取路徑：${targetUri.fsPath}`);
      return;
    }

    await VideoViewerPanel.createOrShow(context.extensionUri, targetUri, initialVideoPath);
  };

  ImageViewerPanel.globalState = context.globalState;
  AudioViewerPanel.globalState = context.globalState;
  VideoViewerPanel.globalState = context.globalState;

  context.subscriptions.push(
    vscode.commands.registerCommand('scriptRunner.viewFolderImages', viewFolderImagesHandler),
    vscode.commands.registerCommand('scriptRunner.viewFolderImages.en', viewFolderImagesHandler),
    vscode.commands.registerCommand('scriptRunner.viewFolderAudios', viewFolderAudiosHandler),
    vscode.commands.registerCommand('scriptRunner.viewFolderAudios.en', viewFolderAudiosHandler),
    vscode.commands.registerCommand('scriptRunner.viewFolderVideos', viewFolderVideosHandler),
    vscode.commands.registerCommand('scriptRunner.viewFolderVideos.en', viewFolderVideosHandler),
    vscode.commands.registerCommand('scriptRunner.runPy', runPyHandler),
    vscode.commands.registerCommand('scriptRunner.runPy.en', runPyHandler),
    vscode.commands.registerCommand('scriptRunner.runBat', runBatHandler),
    vscode.commands.registerCommand('scriptRunner.runBat.en', runBatHandler),
    vscode.commands.registerCommand('scriptRunner.runBatAdmin', runBatAdminHandler),
    vscode.commands.registerCommand('scriptRunner.runBatAdmin.en', runBatAdminHandler),
    vscode.commands.registerCommand('scriptRunner.runPs1', runPs1Handler),
    vscode.commands.registerCommand('scriptRunner.runPs1.en', runPs1Handler),
    vscode.commands.registerCommand('scriptRunner.runPs1Admin', runPs1AdminHandler),
    vscode.commands.registerCommand('scriptRunner.runPs1Admin.en', runPs1AdminHandler),
    // 監聽全域語言變動 (跨外掛即時聯動廣播)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravity.locale')) {
        const newLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');
        ImageViewerPanel.broadcastLocale(newLocale);
        AudioViewerPanel.broadcastLocale(newLocale);
        VideoViewerPanel.broadcastLocale(newLocale);
      }
    })
  );
}

/**
 * 輕量資料夾檔案異動監聽器 (支援 Windows 遞迴監聽與智慧防抖)
 */
class FolderWatcher {
  /**
   * @param {string} folderPath 欲監聽的資料夾絕對路徑
   * @param {Function} onChange 當檢測到相符變更時的回呼函式
   * @param {Set<string>|null} filterExts 關注的副檔名集合
   * @param {number} debounceMs 防抖毫秒數，預設 600ms
   */
  constructor(folderPath, onChange, filterExts = null, debounceMs = 600) {
    this.folderPath = folderPath;
    this.onChange = onChange;
    this.filterExts = filterExts;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.watcher = null;
    this._isDisposed = false;

    this._start();
  }

  _start() {
    try {
      if (!fs.existsSync(this.folderPath)) return;

      // 在 Windows 環境下，{ recursive: true } 底層調用 ReadDirectoryChangesW，支援遞迴監聽
      this.watcher = fs.watch(this.folderPath, { recursive: true }, (eventType, filename) => {
        if (this._isDisposed) return;

        if (filename) {
          const lower = filename.toLowerCase();
          // 過濾常見系統暫存檔、編輯器鎖定檔與版本控制目錄
          if (
            lower.startsWith('.') ||
            lower.includes('/.') ||
            lower.includes('\\.') ||
            lower.endsWith('.tmp') ||
            lower.endsWith('.crdownload') ||
            lower.endsWith('.part') ||
            lower.endsWith('~')
          ) {
            return;
          }

          // 若指定了副檔名白名單，且檔案具有副檔名，非白名單副檔名則略過
          if (this.filterExts) {
            const ext = path.extname(lower);
            // 注意：若沒有副檔名 (ext === '')，可能是資料夾被新增/重命名/刪除，仍需觸發重新整理
            if (ext && !this.filterExts.has(ext)) {
              return;
            }
          }
        }

        // 防抖節流 (Debounce)
        if (this.timer) {
          clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
          if (!this._isDisposed) {
            this.onChange();
          }
        }, this.debounceMs);
      });

      this.watcher.on('error', (err) => {
        console.warn(`[FolderWatcher] 監聽器警告 (${this.folderPath}):`, err);
      });
    } catch (err) {
      console.warn(`[FolderWatcher] 無法建立監聽器 (${this.folderPath}):`, err);
    }
  }

  dispose() {
    this._isDisposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (_) {}
      this.watcher = null;
    }
  }
}

/**
 * 內容區圖片檢視器 WebviewPanel 控制器
 */
class ImageViewerPanel {
  static currentPanels = new Map();
  static globalState = null;

  /**
   * 廣播語言變更通知至所有作用中的圖片檢視面板
   * @param {string} locale
   */
  static broadcastLocale(locale) {
    for (const panelInstance of ImageViewerPanel.currentPanels.values()) {
      if (panelInstance && panelInstance.panel) {
        panelInstance.panel.webview.postMessage({ type: 'localeChanged', locale });
      }
    }
  }

  /**
   * 建立或喚醒指定資料夾之圖片檢視視窗
   * @param {vscode.Uri} extensionUri
   * @param {vscode.Uri} folderUri
   * @param {string|null} initialImagePath
   */
  static async createOrShow(extensionUri, folderUri, initialImagePath = null) {
    const folderPath = folderUri.fsPath;
    const existing = ImageViewerPanel.currentPanels.get(folderPath);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (initialImagePath) {
        existing.panel.webview.postMessage({
          type: 'openTargetImage',
          filePath: initialImagePath
        });
      }
      return;
    }

    const folderName = path.basename(folderPath);
    const panel = vscode.window.createWebviewPanel(
      'antigravity.folderImageViewer',
      `圖片: ${folderName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          extensionUri,
          folderUri
        ]
      }
    );

    const instance = new ImageViewerPanel(panel, extensionUri, folderUri, initialImagePath);
    ImageViewerPanel.currentPanels.set(folderPath, instance);
  }

  constructor(panel, extensionUri, folderUri, initialImagePath = null) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.folderUri = folderUri;
    this.folderPath = folderUri.fsPath;
    this.folderName = path.basename(this.folderPath);
    this.initialImagePath = initialImagePath;
    this.isRecursive = false;
    this._disposables = [];

    // 自動監聽資料夾內容異動（防抖節流並靜默無感重新整理）
    this.folderWatcher = new FolderWatcher(
      this.folderPath,
      () => this._sendImages(true, true),
      imageService.SUPPORTED_IMAGE_EXTS
    );

    this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), null, this._disposables);

    this.panel.webview.html = this._getHtmlForWebview(this.panel.webview);
  }

  dispose() {
    if (this.folderWatcher) {
      this.folderWatcher.dispose();
      this.folderWatcher = null;
    }
    ImageViewerPanel.currentPanels.delete(this.folderPath);
    this.panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  async _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        await this._sendImages(false);
        break;
      case 'refresh':
        await this._sendImages(true);
        break;
      case 'toggleRecursive':
        this.isRecursive = !!msg.recursive;
        await this._sendImages(true);
        break;
      case 'revealFolder':
        await vscode.commands.executeCommand('revealFileInOS', this.folderUri);
        break;
      case 'revealFile':
        if (msg.filePath) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.filePath));
        }
        break;
      case 'saveThumbSize':
        if (ImageViewerPanel.globalState && typeof msg.size === 'number' && !isNaN(msg.size)) {
          await ImageViewerPanel.globalState.update('antigravity.imageViewer.thumbSize', msg.size);
        }
        break;
      case 'deleteFiles':
        if (Array.isArray(msg.filePaths) && msg.filePaths.length > 0) {
          const count = msg.filePaths.length;
          const confirmText = count === 1
            ? `確定要將「${path.basename(msg.filePaths[0])}」移至系統資源回收筒嗎？`
            : `確定要將選取的 ${count} 個圖片檔案移至系統資源回收筒嗎？`;
          const action = await vscode.window.showWarningMessage(
            confirmText,
            { modal: true },
            '移至資源回收筒'
          );
          if (action === '移至資源回收筒') {
            let deletedCount = 0;
            for (const filePath of msg.filePaths) {
              try {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: true });
                deletedCount++;
              } catch (err) {
                console.error(`[ImageViewer] 刪除檔案失敗: ${filePath}`, err);
              }
            }
            this.panel.webview.postMessage({
              type: 'toast',
              text: `已成功將 ${deletedCount} 個檔案移至資源回收筒`,
              level: 'success'
            });
            await this._sendImages(true);
          }
        }
        break;
      case 'saveRotatedImages':
        if (Array.isArray(msg.updates) && msg.updates.length > 0) {
          let updatedCount = 0;
          for (const item of msg.updates) {
            try {
              const { fullPath, base64Data } = item;
              if (!fullPath || !base64Data) continue;
              const buffer = Buffer.from(base64Data, 'base64');
              await fsPromises.writeFile(fullPath, buffer);
              updatedCount++;
            } catch (err) {
              console.error(`[ImageViewer] 旋轉存檔失敗: ${item.fullPath}`, err);
            }
          }
          this.panel.webview.postMessage({
            type: 'toast',
            text: `已成功旋轉並儲存 ${updatedCount} 張圖片`,
            level: 'success'
          });
          await this._sendImages(true);
        }
        break;
      case 'setGlobalLocale': {
        const { locale } = msg.payload || msg;
        if (locale === 'zh-TW' || locale === 'en') {
          try {
            await vscode.workspace.getConfiguration('antigravity').update('locale', locale, vscode.ConfigurationTarget.Global);
          } catch (err) {
            console.error('[ImageViewer] 設定全域語系失敗:', err);
          }
        }
        break;
      }
    }
  }

  async _sendImages(isUpdate = false, isSilent = false) {
    try {
      const images = await imageService.scanImages(this.folderPath, this.isRecursive, this.panel.webview);
      if (isUpdate) {
        this.panel.webview.postMessage({
          type: 'updateImages',
          images,
          isSilent
        });
      } else {
        const savedThumbSize = ImageViewerPanel.globalState
          ? ImageViewerPanel.globalState.get('antigravity.imageViewer.thumbSize', null)
          : null;
        this.panel.webview.postMessage({
          type: 'initData',
          folderPath: this.folderPath,
          folderName: this.folderName,
          images,
          recursive: this.isRecursive,
          thumbSize: savedThumbSize,
          targetFilePath: this.initialImagePath
        });
        this.initialImagePath = null;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`讀取圖片失敗: ${err.message}`);
    }
  }

  _getHtmlForWebview(webview) {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'image-viewer', 'index.html').fsPath;
    let html = fs.readFileSync(htmlPath, 'utf8');

    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'image-viewer', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'image-viewer', 'viewer.js'));

    const localesPath = path.join(this.extensionUri.fsPath, 'media', 'image-viewer', 'locales.js');
    let localesJs = '';
    if (fs.existsSync(localesPath)) {
      localesJs = fs.readFileSync(localesPath, 'utf8');
    }
    const currentLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');

    html = html
      .replace(/href="style\.css"/g, `href="${styleUri}"`)
      .replace(/src="viewer\.js"/g, `src="${scriptUri}"`)
      .replace(/<script src="locales\.js"><\/script>/g, () => `<script>window.INITIAL_LOCALE = ${JSON.stringify(currentLocale)};</script>\n  <script>${localesJs}</script>`);

    // 注入安全 CSP
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data: blob:;">`;
    html = html.replace('</head>', `${csp}\n</head>`);

    return html;
  }
}

/**
 * 內容區影片檢視器 WebviewPanel 控制器
 */
class VideoViewerPanel {
  static currentPanels = new Map();
  static globalState = null;

  /**
   * 廣播語言變更通知至所有作用中的影片檢視面板
   * @param {string} locale
   */
  static broadcastLocale(locale) {
    for (const panelInstance of VideoViewerPanel.currentPanels.values()) {
      if (panelInstance && panelInstance.panel) {
        panelInstance.panel.webview.postMessage({ type: 'localeChanged', locale });
      }
    }
  }

  /**
   * 建立或喚醒指定資料夾之影片檢視視窗
   * @param {vscode.Uri} extensionUri
   * @param {vscode.Uri} folderUri
   * @param {string|null} initialVideoPath
   */
  static async createOrShow(extensionUri, folderUri, initialVideoPath = null) {
    const folderPath = folderUri.fsPath;
    const existing = VideoViewerPanel.currentPanels.get(folderPath);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (initialVideoPath) {
        existing.panel.webview.postMessage({
          type: 'openTargetVideo',
          filePath: initialVideoPath
        });
      }
      return;
    }

    const folderName = path.basename(folderPath);
    const panel = vscode.window.createWebviewPanel(
      'antigravity.folderVideoViewer',
      `影片: ${folderName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          extensionUri,
          folderUri
        ]
      }
    );

    const instance = new VideoViewerPanel(panel, extensionUri, folderUri, initialVideoPath);
    VideoViewerPanel.currentPanels.set(folderPath, instance);
  }

  constructor(panel, extensionUri, folderUri, initialVideoPath = null) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.folderUri = folderUri;
    this.folderPath = folderUri.fsPath;
    this.folderName = path.basename(this.folderPath);
    this.initialVideoPath = initialVideoPath;
    this.isRecursive = false;
    this._disposables = [];

    // 增加伺服器活躍引用計數
    videoStreamServer.retain();

    // 自動監聽資料夾內容異動（防抖節流並靜默無感重新整理）
    this.folderWatcher = new FolderWatcher(
      this.folderPath,
      () => this._sendVideos(true, true),
      videoService.SUPPORTED_VIDEO_EXTS
    );

    this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), null, this._disposables);

    this.panel.webview.html = this._getHtmlForWebview(this.panel.webview);
  }

  dispose() {
    if (this.folderWatcher) {
      this.folderWatcher.dispose();
      this.folderWatcher = null;
    }
    // 釋放伺服器活躍引用計數（歸零則啟動延遲自動休眠）
    videoStreamServer.release();
    VideoViewerPanel.currentPanels.delete(this.folderPath);
    this.panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  async _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        await this._sendVideos(false);
        break;
      case 'refresh':
        await this._sendVideos(true);
        break;
      case 'toggleRecursive':
        this.isRecursive = !!msg.recursive;
        await this._sendVideos(true);
        break;
      case 'revealFolder':
        await vscode.commands.executeCommand('revealFileInOS', this.folderUri);
        break;
      case 'revealFile':
        if (msg.filePath) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.filePath));
        }
        break;
      case 'saveThumbSize':
        if (VideoViewerPanel.globalState && typeof msg.size === 'number' && !isNaN(msg.size)) {
          await VideoViewerPanel.globalState.update('antigravity.videoViewer.thumbSize', msg.size);
        }
        break;
      case 'saveShowThumbs':
        if (VideoViewerPanel.globalState && typeof msg.showThumbs === 'boolean') {
          await VideoViewerPanel.globalState.update('antigravity.videoViewer.showThumbs', msg.showThumbs);
        }
        break;
      case 'saveVolume':
        if (VideoViewerPanel.globalState) {
          if (typeof msg.volume === 'number' && !isNaN(msg.volume)) {
            const clamped = Math.max(0, Math.min(1, msg.volume));
            await VideoViewerPanel.globalState.update('antigravity.videoViewer.volume', clamped);
          }
          if (typeof msg.muted === 'boolean') {
            await VideoViewerPanel.globalState.update('antigravity.videoViewer.muted', msg.muted);
          }
          if (typeof msg.lastVolume === 'number' && !isNaN(msg.lastVolume) && msg.lastVolume > 0) {
            const clamped = Math.max(0.05, Math.min(1, msg.lastVolume));
            await VideoViewerPanel.globalState.update('antigravity.videoViewer.lastVolume', clamped);
          }
        }
        break;
      case 'saveAutoNext':
        if (VideoViewerPanel.globalState && typeof msg.autoNext === 'boolean') {
          await VideoViewerPanel.globalState.update('antigravity.videoViewer.autoNext', msg.autoNext);
        }
        break;
      case 'saveLoop':
        if (VideoViewerPanel.globalState && typeof msg.loop === 'boolean') {
          await VideoViewerPanel.globalState.update('antigravity.videoViewer.loop', msg.loop);
        }
        break;
      case 'deleteFiles':
        if (Array.isArray(msg.filePaths) && msg.filePaths.length > 0) {
          const count = msg.filePaths.length;
          const confirmText = count === 1
            ? `確定要將「${path.basename(msg.filePaths[0])}」移至系統資源回收筒嗎？`
            : `確定要將選取的 ${count} 個影片檔案移至系統資源回收筒嗎？`;
          const action = await vscode.window.showWarningMessage(
            confirmText,
            { modal: true },
            '移至資源回收筒'
          );
          if (action === '移至資源回收筒') {
            let deletedCount = 0;
            for (const filePath of msg.filePaths) {
              try {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: true });
                deletedCount++;
              } catch (err) {
                console.error(`[VideoViewer] 刪除檔案失敗: ${filePath}`, err);
              }
            }
            this.panel.webview.postMessage({
              type: 'toast',
              text: `已成功將 ${deletedCount} 個影片移至資源回收筒`,
              level: 'success'
            });
            await this._sendVideos(true);
          }
        }
        break;
      case 'openWithDefaultApp':
        if (msg.filePath) {
          try {
            const cp = require('child_process');
            if (process.platform === 'win32') {
              cp.exec(`start "" "${msg.filePath.replace(/"/g, '""')}"`, { windowsHide: true }, (err) => {
                if (err) {
                  cp.execFile('explorer.exe', [msg.filePath], () => {});
                }
              });
            } else if (process.platform === 'darwin') {
              cp.execFile('open', [msg.filePath]);
            } else {
              cp.execFile('xdg-open', [msg.filePath]);
            }
          } catch (err) {
            console.error('[VideoViewer] 開啟外部播放器失敗:', err);
            vscode.window.showErrorMessage(`無法開啟外部播放器: ${err.message}`);
          }
        }
        break;
      case 'setGlobalLocale': {
        const { locale } = msg.payload || msg;
        if (locale === 'zh-TW' || locale === 'en') {
          try {
            await vscode.workspace.getConfiguration('antigravity').update('locale', locale, vscode.ConfigurationTarget.Global);
          } catch (err) {
            console.error('[VideoViewer] 設定全域語系失敗:', err);
          }
        }
        break;
      }
    }
  }

  async _sendVideos(isUpdate = false, isSilent = false) {
    try {
      const videos = await videoService.scanVideos(this.folderPath, this.isRecursive, this.panel.webview);
      if (isUpdate) {
        this.panel.webview.postMessage({
          type: 'updateVideos',
          videos,
          isSilent
        });
      } else {
        const savedThumbSize = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.thumbSize', null)
          : null;
        const savedShowThumbs = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.showThumbs', true)
          : true;
        const savedVolume = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.volume', 0.5)
          : 0.5;
        const savedMuted = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.muted', false)
          : false;
        const savedLastVolume = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.lastVolume', 0.5)
          : 0.5;
        const savedAutoNext = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.autoNext', false)
          : false;
        const savedLoop = VideoViewerPanel.globalState
          ? VideoViewerPanel.globalState.get('antigravity.videoViewer.loop', false)
          : false;
        this.panel.webview.postMessage({
          type: 'initData',
          folderPath: this.folderPath,
          folderName: this.folderName,
          videos,
          recursive: this.isRecursive,
          thumbSize: savedThumbSize,
          showThumbs: savedShowThumbs,
          volume: savedVolume,
          muted: savedMuted,
          lastVolume: savedLastVolume,
          autoNext: savedAutoNext,
          loop: savedLoop,
          targetFilePath: this.initialVideoPath
        });
        this.initialVideoPath = null;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`讀取影片失敗: ${err.message}`);
    }
  }

  _getHtmlForWebview(webview) {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'video-viewer', 'index.html').fsPath;
    let html = fs.readFileSync(htmlPath, 'utf8');

    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'video-viewer', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'video-viewer', 'viewer.js'));

    const localesPath = path.join(this.extensionUri.fsPath, 'media', 'video-viewer', 'locales.js');
    let localesJs = '';
    if (fs.existsSync(localesPath)) {
      localesJs = fs.readFileSync(localesPath, 'utf8');
    }
    const currentLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');

    html = html
      .replace(/href="style\.css"/g, `href="${styleUri}"`)
      .replace(/src="viewer\.js"/g, `src="${scriptUri}"`)
      .replace(/<script src="locales\.js"><\/script>/g, () => `<script>window.INITIAL_LOCALE = ${JSON.stringify(currentLocale)};</script>\n  <script>${localesJs}</script>`);

    // 注入安全 CSP，加入 media-src 支援本機 HTTP 206 串流播放
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: http://127.0.0.1:* http://localhost:* data: blob:; media-src ${webview.cspSource} http://127.0.0.1:* http://localhost:* blob: data:;">`;
    html = html.replace('</head>', `${csp}\n</head>`);

    return html;
  }
}

/**
 * 內容區聲音檢視器 WebviewPanel 控制器
 */
class AudioViewerPanel {
  static currentPanels = new Map();
  static globalState = null;

  /**
   * 廣播語言變更通知至所有作用中的聲音檢視面板
   * @param {string} locale
   */
  static broadcastLocale(locale) {
    for (const panelInstance of AudioViewerPanel.currentPanels.values()) {
      if (panelInstance && panelInstance.panel) {
        panelInstance.panel.webview.postMessage({ type: 'localeChanged', locale });
      }
    }
  }

  /**
   * 建立或喚醒指定資料夾之聲音檢視視窗
   * @param {vscode.Uri} extensionUri
   * @param {vscode.Uri} folderUri
   * @param {string|null} initialAudioPath
   */
  static async createOrShow(extensionUri, folderUri, initialAudioPath = null) {
    const folderPath = folderUri.fsPath;
    const existing = AudioViewerPanel.currentPanels.get(folderPath);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (initialAudioPath) {
        existing.panel.webview.postMessage({
          type: 'openTargetAudio',
          filePath: initialAudioPath
        });
      }
      return;
    }

    const folderName = path.basename(folderPath);
    const panel = vscode.window.createWebviewPanel(
      'antigravity.folderAudioViewer',
      `聲音: ${folderName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          extensionUri,
          folderUri
        ]
      }
    );

    const instance = new AudioViewerPanel(panel, extensionUri, folderUri, initialAudioPath);
    AudioViewerPanel.currentPanels.set(folderPath, instance);
  }

  constructor(panel, extensionUri, folderUri, initialAudioPath = null) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.folderUri = folderUri;
    this.folderPath = folderUri.fsPath;
    this.folderName = path.basename(this.folderPath);
    this.initialAudioPath = initialAudioPath;
    this.isRecursive = false;
    this._disposables = [];

    // 增加伺服器活躍引用計數
    audioStreamServer.retain();

    // 自動監聽資料夾內容異動（防抖節流並靜默無感重新整理）
    this.folderWatcher = new FolderWatcher(
      this.folderPath,
      () => this._sendAudios(true, true),
      audioService.SUPPORTED_AUDIO_EXTS
    );

    this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), null, this._disposables);

    this.panel.webview.html = this._getHtmlForWebview(this.panel.webview);
  }

  dispose() {
    if (this.folderWatcher) {
      this.folderWatcher.dispose();
      this.folderWatcher = null;
    }
    // 釋放伺服器活躍引用計數（歸零則啟動延遲自動休眠）
    audioStreamServer.release();
    AudioViewerPanel.currentPanels.delete(this.folderPath);
    this.panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  async _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        await this._sendAudios(false);
        break;
      case 'refresh':
        await this._sendAudios(true);
        break;
      case 'toggleRecursive':
        this.isRecursive = !!msg.recursive;
        await this._sendAudios(true);
        break;
      case 'revealFolder':
        await vscode.commands.executeCommand('revealFileInOS', this.folderUri);
        break;
      case 'revealFile':
        if (msg.filePath) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.filePath));
        }
        break;
      case 'saveCardSize':
        if (AudioViewerPanel.globalState && typeof msg.size === 'number' && !isNaN(msg.size)) {
          await AudioViewerPanel.globalState.update('antigravity.audioViewer.cardSize', msg.size);
        }
        break;
      case 'saveVolume':
        if (AudioViewerPanel.globalState) {
          if (typeof msg.volume === 'number' && !isNaN(msg.volume)) {
            const clamped = Math.max(0, Math.min(1, msg.volume));
            await AudioViewerPanel.globalState.update('antigravity.audioViewer.volume', clamped);
          }
          if (typeof msg.muted === 'boolean') {
            await AudioViewerPanel.globalState.update('antigravity.audioViewer.muted', msg.muted);
          }
          if (typeof msg.lastVolume === 'number' && !isNaN(msg.lastVolume) && msg.lastVolume > 0) {
            const clamped = Math.max(0.05, Math.min(1, msg.lastVolume));
            await AudioViewerPanel.globalState.update('antigravity.audioViewer.lastVolume', clamped);
          }
        }
        break;
      case 'saveAutoNext':
        if (AudioViewerPanel.globalState && typeof msg.autoNext === 'boolean') {
          await AudioViewerPanel.globalState.update('antigravity.audioViewer.autoNext', msg.autoNext);
        }
        break;
      case 'saveLoop':
        if (AudioViewerPanel.globalState && typeof msg.loop === 'boolean') {
          await AudioViewerPanel.globalState.update('antigravity.audioViewer.loop', msg.loop);
        }
        break;
      case 'deleteFiles':
        if (Array.isArray(msg.filePaths) && msg.filePaths.length > 0) {
          const count = msg.filePaths.length;
          const confirmText = count === 1
            ? `確定要將「${path.basename(msg.filePaths[0])}」移至系統資源回收筒嗎？`
            : `確定要將選取的 ${count} 個聲音檔案移至系統資源回收筒嗎？`;
          const action = await vscode.window.showWarningMessage(
            confirmText,
            { modal: true },
            '移至資源回收筒'
          );
          if (action === '移至資源回收筒') {
            let deletedCount = 0;
            for (const filePath of msg.filePaths) {
              try {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: true });
                deletedCount++;
              } catch (err) {
                console.error(`[AudioViewer] 刪除檔案失敗: ${filePath}`, err);
              }
            }
            this.panel.webview.postMessage({
              type: 'toast',
              text: `已成功將 ${deletedCount} 個聲音檔案移至資源回收筒`,
              level: 'success'
            });
            await this._sendAudios(true);
          }
        }
        break;
      case 'openWithDefaultApp':
        if (msg.filePath) {
          try {
            const cp = require('child_process');
            if (process.platform === 'win32') {
              cp.exec(`start "" "${msg.filePath.replace(/"/g, '""')}"`, { windowsHide: true }, (err) => {
                if (err) {
                  cp.execFile('explorer.exe', [msg.filePath], () => {});
                }
              });
            } else if (process.platform === 'darwin') {
              cp.execFile('open', [msg.filePath]);
            } else {
              cp.execFile('xdg-open', [msg.filePath]);
            }
          } catch (err) {
            console.error('[AudioViewer] 開啟外部播放器失敗:', err);
            vscode.window.showErrorMessage(`無法開啟外部播放器: ${err.message}`);
          }
        }
        break;
      case 'setGlobalLocale': {
        const { locale } = msg.payload || msg;
        if (locale === 'zh-TW' || locale === 'en') {
          try {
            await vscode.workspace.getConfiguration('antigravity').update('locale', locale, vscode.ConfigurationTarget.Global);
          } catch (err) {
            console.error('[AudioViewer] 設定全域語系失敗:', err);
          }
        }
        break;
      }
    }
  }

  async _sendAudios(isUpdate = false, isSilent = false) {
    try {
      const audios = await audioService.scanAudios(this.folderPath, this.isRecursive, this.panel.webview);
      if (isUpdate) {
        this.panel.webview.postMessage({
          type: 'updateAudios',
          audios,
          isSilent
        });
      } else {
        const savedCardSize = AudioViewerPanel.globalState
          ? AudioViewerPanel.globalState.get('antigravity.audioViewer.cardSize', 220)
          : 220;
        const savedVolume = AudioViewerPanel.globalState
          ? AudioViewerPanel.globalState.get('antigravity.audioViewer.volume', 0.5)
          : 0.5;
        const savedMuted = AudioViewerPanel.globalState
          ? AudioViewerPanel.globalState.get('antigravity.audioViewer.muted', false)
          : false;
        const savedLastVolume = AudioViewerPanel.globalState
          ? AudioViewerPanel.globalState.get('antigravity.audioViewer.lastVolume', 0.5)
          : 0.5;
        const savedAutoNext = AudioViewerPanel.globalState
          ? AudioViewerPanel.globalState.get('antigravity.audioViewer.autoNext', false)
          : false;
        const savedLoop = AudioViewerPanel.globalState
          ? AudioViewerPanel.globalState.get('antigravity.audioViewer.loop', false)
          : false;
        this.panel.webview.postMessage({
          type: 'initData',
          folderPath: this.folderPath,
          folderName: this.folderName,
          audios,
          recursive: this.isRecursive,
          cardSize: savedCardSize,
          volume: savedVolume,
          muted: savedMuted,
          lastVolume: savedLastVolume,
          autoNext: savedAutoNext,
          loop: savedLoop,
          targetFilePath: this.initialAudioPath
        });
        this.initialAudioPath = null;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`讀取聲音檔案失敗: ${err.message}`);
    }
  }

  _getHtmlForWebview(webview) {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'audio-viewer', 'index.html').fsPath;
    let html = fs.readFileSync(htmlPath, 'utf8');

    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'audio-viewer', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'audio-viewer', 'viewer.js'));

    const localesPath = path.join(this.extensionUri.fsPath, 'media', 'audio-viewer', 'locales.js');
    let localesJs = '';
    if (fs.existsSync(localesPath)) {
      localesJs = fs.readFileSync(localesPath, 'utf8');
    }
    const currentLocale = vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW');

    html = html
      .replace(/href="style\.css"/g, `href="${styleUri}"`)
      .replace(/src="viewer\.js"/g, `src="${scriptUri}"`)
      .replace(/<script src="locales\.js"><\/script>/g, () => `<script>window.INITIAL_LOCALE = ${JSON.stringify(currentLocale)};</script>\n  <script>${localesJs}</script>`);

    // 注入安全 CSP，加入 media-src 支援本機 HTTP 206 串流播放
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: http://127.0.0.1:* http://localhost:* data: blob:; media-src ${webview.cspSource} http://127.0.0.1:* http://localhost:* blob: data:;">`;
    html = html.replace('</head>', `${csp}\n</head>`);

    return html;
  }
}

function deactivate() {
  try {
    const { videoStreamServer } = require('./services/videoStreamServer');
    videoStreamServer.dispose();
  } catch (_) {}
  try {
    const { audioStreamServer } = require('./services/audioStreamServer');
    audioStreamServer.dispose();
  } catch (_) {}
}

module.exports = { activate, deactivate };

