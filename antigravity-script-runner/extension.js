const vscode = require('vscode');
const path = require('node:path');
const fsPromises = require('node:fs/promises');

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
 * @returns {vscode.Terminal}
 */
function getOrCreateTerminal(cwd) {
  const terminalName = '腳本執行器 (Script Runner)';
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
 * @returns {Promise<{ filePath: string, fileDir: string, fileName: string } | null>}
 */
async function resolveTarget(uri) {
  let targetUri = uri;
  if (!targetUri && vscode.window.activeTextEditor) {
    targetUri = vscode.window.activeTextEditor.document.uri;
  }
  if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath) {
    vscode.window.showWarningMessage('請先在檔案總管中選取或開啟已儲存的實體腳本檔案！');
    return null;
  }
  const filePath = targetUri.fsPath;
  try {
    await fsPromises.access(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      vscode.window.showErrorMessage(`檔案不存在：${filePath}`);
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
  // 1. 執行 Python 腳本 (.py)
  context.subscriptions.push(
    vscode.commands.registerCommand('scriptRunner.runPy', async (uri) => {
      const target = await resolveTarget(uri);
      if (!target) return;

      // 若當前檔案有變更則先自動存檔
      if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.isDirty) {
        await vscode.window.activeTextEditor.document.save();
      }

      const { runAsAdmin, keepWindowOpen } = getRunnerConfig();
      const terminal = getOrCreateTerminal(target.fileDir);
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
        ? `🛡️ 已以系統管理員身分啟動：${target.fileName}`
        : `已在終端機啟動：${target.fileName}`;
      vscode.window.setStatusBarMessage(statusMsg, 3000);
    })
  );

  // 2. 執行批次檔 (.bat / .cmd)
  context.subscriptions.push(
    vscode.commands.registerCommand('scriptRunner.runBat', async (uri) => {
      const target = await resolveTarget(uri);
      if (!target) return;

      const { runAsAdmin, keepWindowOpen } = getRunnerConfig();
      const terminal = getOrCreateTerminal(target.fileDir);
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
        ? `🛡️ 已以系統管理員身分啟動：${target.fileName}`
        : `已在終端機啟動：${target.fileName}`;
      vscode.window.setStatusBarMessage(statusMsg, 3000);
    })
  );

  // 3. 執行 PowerShell 腳本 (.ps1)
  context.subscriptions.push(
    vscode.commands.registerCommand('scriptRunner.runPs1', async (uri) => {
      const target = await resolveTarget(uri);
      if (!target) return;

      const { runAsAdmin, keepWindowOpen } = getRunnerConfig();
      const terminal = getOrCreateTerminal(target.fileDir);
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
        ? `🛡️ 已以系統管理員身分啟動：${target.fileName}`
        : `已在終端機啟動：${target.fileName}`;
      vscode.window.setStatusBarMessage(statusMsg, 3000);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

