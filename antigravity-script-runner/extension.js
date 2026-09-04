const vscode = require('vscode');
const path = require('node:path');
const fsPromises = require('node:fs/promises');
const I18n = require('./i18n');

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

  // 2. 執行批次檔 (.bat / .cmd)
  const runBatHandler = async (uri) => {
    const target = await resolveTarget(uri, i18n);
    if (!target) return;

    const { runAsAdmin, keepWindowOpen } = getRunnerConfig();
    const terminal = getOrCreateTerminal(target.fileDir, i18n);
    terminal.show(true);

    const psSafeDir = escapePs(target.fileDir);
    const psSafePath = escapePs(target.filePath);

    let commandStr = '';
    if (runAsAdmin) {
      const cmdFlag = keepWindowOpen ? '/k' : '/c';
      commandStr = `Start-Process cmd.exe -ArgumentList '${cmdFlag}', '""${psSafePath}""' -WorkingDirectory '${psSafeDir}' -Verb RunAs`;
    } else {
      commandStr = `Set-Location -LiteralPath '${psSafeDir}'; & '${psSafePath}'`;
    }

    terminal.sendText('');
    terminal.sendText(commandStr);

    const statusMsg = runAsAdmin
      ? i18n.t('status_started_admin', { fileName: target.fileName })
      : i18n.t('status_started_terminal', { fileName: target.fileName });
    vscode.window.setStatusBarMessage(statusMsg, 3000);
  };

  // 3. 執行 PowerShell 腳本 (.ps1)
  const runPs1Handler = async (uri) => {
    const target = await resolveTarget(uri, i18n);
    if (!target) return;

    const { runAsAdmin, keepWindowOpen } = getRunnerConfig();
    const terminal = getOrCreateTerminal(target.fileDir, i18n);
    terminal.show(true);

    const psSafeDir = escapePs(target.fileDir);
    const psSafePath = escapePs(target.filePath);

    let commandStr = '';
    if (runAsAdmin) {
      const psArgs = keepWindowOpen
        ? `'-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', '""${psSafePath}""'`
        : `'-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', '""${psSafePath}""'`;
      commandStr = `Start-Process powershell.exe -ArgumentList ${psArgs} -WorkingDirectory '${psSafeDir}' -Verb RunAs`;
    } else {
      commandStr = `Set-Location -LiteralPath '${psSafeDir}'; powershell.exe -NoLogo -ExecutionPolicy Bypass -File '${psSafePath}'`;
    }

    terminal.sendText('');
    terminal.sendText(commandStr);

    const statusMsg = runAsAdmin
      ? i18n.t('status_started_admin', { fileName: target.fileName })
      : i18n.t('status_started_terminal', { fileName: target.fileName });
    vscode.window.setStatusBarMessage(statusMsg, 3000);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('scriptRunner.runPy', runPyHandler),
    vscode.commands.registerCommand('scriptRunner.runPy.en', runPyHandler),
    vscode.commands.registerCommand('scriptRunner.runBat', runBatHandler),
    vscode.commands.registerCommand('scriptRunner.runBat.en', runBatHandler),
    vscode.commands.registerCommand('scriptRunner.runPs1', runPs1Handler),
    vscode.commands.registerCommand('scriptRunner.runPs1.en', runPs1Handler)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

