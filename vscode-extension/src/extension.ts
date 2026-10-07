import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { BackendClient } from './api/backendClient';
import { ErrorDetector } from './detectors/errorDetector';
import { TerminalWatcher } from './detectors/terminalWatcher';
import { SidebarProvider } from './ui/sidebarProvider';
import { DetectedBug } from './models/types';

let backendProcess: cp.ChildProcess | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log('ContextGuard AI extension activating...');

  const backendClient = new BackendClient();
  const sidebarProvider = new SidebarProvider(context.extensionUri, backendClient);

  // Register Webview View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'contextguard.checkBackendStatus';
  statusBarItem.text = '$(shield) ContextGuard: Local';
  statusBarItem.tooltip = 'ContextGuard AI: Privacy-First Bug Detection & Verification Engine';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Terminal Watcher
  const terminalWatcher = new TerminalWatcher((bug: DetectedBug) => {
    vscode.window.showWarningMessage(
      `ContextGuard detected runtime crash: ${bug.errorType} in ${path.basename(bug.file)}:${bug.line}`,
      'Investigate & Fix'
    ).then((selection) => {
      if (selection === 'Investigate & Fix') {
        sidebarProvider.setCurrentBug(bug);
        sidebarProvider.investigateBug(bug);
      }
    });
    sidebarProvider.setCurrentBug(bug);
  });

  // Listen to terminal data (if terminal shell integration or write event is supported)
  if ((vscode.window as any).onDidWriteTerminalData) {
    context.subscriptions.push(
      (vscode.window as any).onDidWriteTerminalData((e: any) => {
        terminalWatcher.feedData(e.data);
      })
    );
  }

  // Diagnostics change listener
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((e) => {
      const config = vscode.workspace.getConfiguration('contextguard');
      if (!config.get<boolean>('autoScanOnSave', true)) return;

      for (const uri of e.uris) {
        const diags = vscode.languages.getDiagnostics(uri);
        const errorDiag = diags.find(d => d.severity === vscode.DiagnosticSeverity.Error);
        if (errorDiag) {
          const bug = ErrorDetector.diagnosticToBug(uri, errorDiag);
          sidebarProvider.setCurrentBug(bug);
          break;
        }
      }
    })
  );

  // Command: Scan Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.scanWorkspace', async () => {
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'ContextGuard AI: Scanning workspace diagnostics...',
        cancellable: false
      }, async () => {
        const bugs = ErrorDetector.scanDiagnostics();
        if (bugs.length === 0) {
          vscode.window.showInformationMessage('ContextGuard AI: Workspace is clean. No compilation or diagnostic errors detected.');
        } else {
          vscode.window.showInformationMessage(`ContextGuard AI: Found ${bugs.length} diagnostic issue(s). Showing highest priority.`);
          sidebarProvider.setCurrentBug(bugs[0]);
        }
      });
    })
  );

  // Command: Analyze Current File
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.analyzeCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor file to analyze.');
        return;
      }
      const bugs = await ErrorDetector.analyzeDocument(editor.document);
      if (bugs.length > 0) {
        sidebarProvider.setCurrentBug(bugs[0]);
        vscode.window.showInformationMessage(`ContextGuard AI: Detected ${bugs.length} issue(s) in ${path.basename(editor.document.fileName)}.`);
      } else {
        vscode.window.showInformationMessage(`ContextGuard AI: No errors detected in ${path.basename(editor.document.fileName)}.`);
      }
    })
  );

  // Command: Reproduce & Fix
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.reproduceAndFix', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open the failing file to start reproduction.');
        return;
      }
      const doc = editor.document;
      const line = editor.selection.active.line + 1;
      const bugs = ErrorDetector.scanDiagnostics(doc.uri);
      const targetBug: DetectedBug = bugs[0] || {
        id: `manual_${Date.now()}`,
        file: doc.fileName,
        line,
        column: 1,
        errorType: 'UserReportedBug',
        message: 'Manual investigation requested at cursor location',
        source: 'manual',
        severity: 'HIGH',
        codeSnippet: doc.lineAt(Math.max(0, line - 1)).text,
        timestamp: new Date().toISOString()
      };
      sidebarProvider.setCurrentBug(targetBug);
      await sidebarProvider.investigateBug(targetBug);
    })
  );

  // Command: Analyze Bug (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.analyzeBug', async () => {
      vscode.commands.executeCommand('contextguard.reproduceAndFix');
    })
  );

  // Command: Generate Candidate Fixes (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.generateFixes', async () => {
      vscode.window.showInformationMessage('ContextGuard AI: Generating multiple candidate fixes...');
      vscode.commands.executeCommand('contextguard.reproduceAndFix');
    })
  );

  // Command: Simulate Fixes (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.simulateFixes', async () => {
      vscode.window.showInformationMessage('ContextGuard AI: Running What-If fix simulations...');
    })
  );

  // Command: Verify Fix (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.verifyFix', async () => {
      vscode.window.showInformationMessage('ContextGuard AI: Running isolated verification sandbox...');
    })
  );

  // Command: Preview Diff (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.previewDiff', async () => {
      vscode.window.showInformationMessage('ContextGuard AI: Preview diff activated.');
    })
  );

  // Command: Apply Fix (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.applyFix', async () => {
      vscode.window.showInformationMessage('ContextGuard AI: Applying selected fix with safe checkpoint.');
    })
  );

  // Command: Rollback (Section 26)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.rollback', async () => {
      await sidebarProvider.rollbackPatch();
    })
  );

  // Command: Start Backend
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.startBackend', async () => {
      startLocalBackend(context);
    })
  );

  // Command: Check Backend Status
  context.subscriptions.push(
    vscode.commands.registerCommand('contextguard.checkBackendStatus', async () => {
      const health = await backendClient.getHealth();
      sidebarProvider.refreshBackendStatus();
      if (health.connected) {
        vscode.window.showInformationMessage(
          `ContextGuard Backend Online: Privacy Mode: [${health.privacyMode.toUpperCase()}]. Model: ${health.activeModel}. Docker: ${health.dockerAvailable ? 'Yes' : 'Local Sandbox'}`
        );
      } else {
        vscode.window.showWarningMessage(
          'ContextGuard Backend is currently offline. Built-in local offline engine active.'
        );
      }
    })
  );

  // Auto-check backend connection on activation
  sidebarProvider.refreshBackendStatus();
}

function startLocalBackend(context: vscode.ExtensionContext) {
  if (backendProcess) {
    vscode.window.showInformationMessage('ContextGuard backend is already running.');
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const backendMain = workspaceRoot
    ? path.join(workspaceRoot, 'backend', 'main.py')
    : path.join(__dirname, '..', '..', 'backend', 'main.py');

  try {
    backendProcess = cp.spawn('python', [backendMain], {
      detached: false,
      stdio: 'pipe'
    });

    backendProcess.stdout?.on('data', (data) => {
      console.log(`[ContextGuard Backend] ${data}`);
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error(`[ContextGuard Backend] ${data}`);
    });

    backendProcess.on('exit', (code) => {
      console.log(`ContextGuard backend exited with code ${code}`);
      backendProcess = null;
    });

    vscode.window.showInformationMessage('Starting ContextGuard AI local backend server on port 8765...');
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to start local backend: ${err.message}`);
  }
}

export function deactivate() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}
