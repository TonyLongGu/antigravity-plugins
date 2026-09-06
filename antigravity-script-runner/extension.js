const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const I18n = require('./i18n');
const imageService = require('./services/imageService');

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
      vscode.window.showWarningMessage('請選取實體資料夾以檢視圖片！');
      return;
    }

    try {
      const stat = await fsPromises.stat(targetUri.fsPath);
      if (!stat.isDirectory()) {
        targetUri = vscode.Uri.file(path.dirname(targetUri.fsPath));
      }
    } catch (err) {
      vscode.window.showErrorMessage(`無法存取資料夾：${targetUri.fsPath}`);
      return;
    }

    await ImageViewerPanel.createOrShow(context.extensionUri, targetUri);
  };

  ImageViewerPanel.globalState = context.globalState;

  context.subscriptions.push(
    vscode.commands.registerCommand('scriptRunner.viewFolderImages', viewFolderImagesHandler),
    vscode.commands.registerCommand('scriptRunner.viewFolderImages.en', viewFolderImagesHandler),
    vscode.commands.registerCommand('scriptRunner.runPy', runPyHandler),
    vscode.commands.registerCommand('scriptRunner.runPy.en', runPyHandler),
    vscode.commands.registerCommand('scriptRunner.runBat', runBatHandler),
    vscode.commands.registerCommand('scriptRunner.runBat.en', runBatHandler),
    vscode.commands.registerCommand('scriptRunner.runBatAdmin', runBatAdminHandler),
    vscode.commands.registerCommand('scriptRunner.runBatAdmin.en', runBatAdminHandler),
    vscode.commands.registerCommand('scriptRunner.runPs1', runPs1Handler),
    vscode.commands.registerCommand('scriptRunner.runPs1.en', runPs1Handler),
    vscode.commands.registerCommand('scriptRunner.runPs1Admin', runPs1AdminHandler),
    vscode.commands.registerCommand('scriptRunner.runPs1Admin.en', runPs1AdminHandler)
  );
}

/**
 * 內容區圖片檢視器 WebviewPanel 控制器
 */
class ImageViewerPanel {
  static currentPanels = new Map();
  static globalState = null;

  /**
   * 建立或喚醒指定資料夾之圖片檢視視窗
   * @param {vscode.Uri} extensionUri
   * @param {vscode.Uri} folderUri
   */
  static async createOrShow(extensionUri, folderUri) {
    const folderPath = folderUri.fsPath;
    const existing = ImageViewerPanel.currentPanels.get(folderPath);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
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

    const instance = new ImageViewerPanel(panel, extensionUri, folderUri);
    ImageViewerPanel.currentPanels.set(folderPath, instance);
  }

  constructor(panel, extensionUri, folderUri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.folderUri = folderUri;
    this.folderPath = folderUri.fsPath;
    this.folderName = path.basename(this.folderPath);
    this.isRecursive = false;
    this._disposables = [];

    this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), null, this._disposables);

    this.panel.webview.html = this._getHtmlForWebview(this.panel.webview);
  }

  dispose() {
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
    }
  }

  async _sendImages(isUpdate = false) {
    try {
      const images = await imageService.scanImages(this.folderPath, this.isRecursive, this.panel.webview);
      if (isUpdate) {
        this.panel.webview.postMessage({
          type: 'updateImages',
          images
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
          thumbSize: savedThumbSize
        });
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

    html = html
      .replace('href="style.css"', `href="${styleUri}"`)
      .replace('src="viewer.js"', `src="${scriptUri}"`);

    // 注入安全 CSP
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data: blob:;">`;
    html = html.replace('</head>', `${csp}\n</head>`);

    return html;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

