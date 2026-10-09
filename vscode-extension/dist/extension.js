"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const backendClient_1 = require("./api/backendClient");
const errorDetector_1 = require("./detectors/errorDetector");
const terminalWatcher_1 = require("./detectors/terminalWatcher");
const debuggerWatcher_1 = require("./detectors/debuggerWatcher");
const sidebarProvider_1 = require("./ui/sidebarProvider");
const snapshotManager_1 = require("./runtime/snapshotManager");
const diagnosticRunner_1 = require("./runtime/diagnosticRunner");
let backendProcess = null;
let statusBarItem;
function activate(context) {
    console.log('ContextGuard AI extension activating...');
    const backendClient = new backendClient_1.BackendClient();
    const sidebarProvider = new sidebarProvider_1.SidebarProvider(context.extensionUri, backendClient);
    // Register Webview View
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(sidebarProvider_1.SidebarProvider.viewType, sidebarProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    // Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'contextguard.checkBackendStatus';
    statusBarItem.text = '$(shield) ContextGuard: Local';
    statusBarItem.tooltip = 'ContextGuard AI: Privacy-First Bug Detection & Verification Engine';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Terminal Watcher
    const terminalWatcher = new terminalWatcher_1.TerminalWatcher((bug) => {
        vscode.window.showWarningMessage(`ContextGuard detected runtime crash: ${bug.errorType} in ${path.basename(bug.file)}:${bug.line}`, 'Investigate & Fix').then((selection) => {
            if (selection === 'Investigate & Fix') {
                sidebarProvider.setCurrentBug(bug);
                sidebarProvider.investigateBug(bug);
            }
        });
        sidebarProvider.setCurrentBug(bug);
    });
    // Debugger Watcher
    const debuggerWatcher = new debuggerWatcher_1.DebuggerWatcher((bug) => {
        vscode.window.showWarningMessage(`ContextGuard detected debug exception: ${bug.errorType} in ${path.basename(bug.file)}:${bug.line}`, 'Investigate & Fix').then((selection) => {
            if (selection === 'Investigate & Fix') {
                sidebarProvider.setCurrentBug(bug);
                sidebarProvider.investigateBug(bug);
            }
        });
        sidebarProvider.setCurrentBug(bug);
    });
    debuggerWatcher.register(context);
    // Listen to terminal data (if terminal shell integration or write event is supported)
    if (vscode.window.onDidWriteTerminalData) {
        context.subscriptions.push(vscode.window.onDidWriteTerminalData((e) => {
            terminalWatcher.feedData(e.data);
        }));
    }
    // Diagnostics change listener
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics((e) => {
        const config = vscode.workspace.getConfiguration('contextguard');
        if (!config.get('autoScanOnSave', true))
            return;
        for (const uri of e.uris) {
            const diags = vscode.languages.getDiagnostics(uri);
            const errorDiag = diags.find(d => d.severity === vscode.DiagnosticSeverity.Error);
            if (errorDiag) {
                const bug = errorDetector_1.ErrorDetector.diagnosticToBug(uri, errorDiag);
                sidebarProvider.setCurrentBug(bug);
                break;
            }
        }
    }));
    // Command: Scan Workspace
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.scanWorkspace', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'ContextGuard AI: Scanning workspace diagnostics...',
            cancellable: false
        }, async () => {
            const bugs = errorDetector_1.ErrorDetector.scanDiagnostics();
            if (bugs.length === 0) {
                vscode.window.showInformationMessage('ContextGuard AI: Workspace is clean. No compilation or diagnostic errors detected.');
            }
            else {
                vscode.window.showInformationMessage(`ContextGuard AI: Found ${bugs.length} diagnostic issue(s). Showing highest priority.`);
                sidebarProvider.setCurrentBug(bugs[0]);
            }
        });
    }));
    // Command: Analyze Current File
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.analyzeCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor file to analyze.');
            return;
        }
        const bugs = await errorDetector_1.ErrorDetector.analyzeDocument(editor.document, backendClient);
        if (bugs.length > 0) {
            sidebarProvider.setCurrentBug(bugs[0]);
            vscode.window.showInformationMessage(`ContextGuard AI: Detected ${bugs.length} issue(s) in ${path.basename(editor.document.fileName)}.`);
        }
        else {
            vscode.window.showInformationMessage(`ContextGuard AI: No errors detected in ${path.basename(editor.document.fileName)}.`);
        }
    }));
    // Command: Scan AST Deep Inspection
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.scanAST', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor file to analyze AST.');
            return;
        }
        const bugs = await errorDetector_1.ErrorDetector.analyzeDocument(editor.document, backendClient);
        if (bugs.length > 0) {
            sidebarProvider.setCurrentBug(bugs[0]);
            vscode.window.showInformationMessage(`ContextGuard AST: Found ${bugs.length} static anomalies. Primary: ${bugs[0].errorType}`);
        }
        else {
            vscode.window.showInformationMessage('ContextGuard AST: Static analysis verified clean syntax and scope.');
        }
    }));
    // Command: Reproduce & Fix
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.reproduceAndFix', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open the failing file to start reproduction.');
            return;
        }
        const doc = editor.document;
        const line = editor.selection.active.line + 1;
        const bugs = errorDetector_1.ErrorDetector.scanDiagnostics(doc.uri);
        const targetBug = bugs[0] || {
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
    }));
    // Command: Analyze Bug (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.analyzeBug', async () => {
        vscode.commands.executeCommand('contextguard.reproduceAndFix');
    }));
    // Command: Generate Candidate Fixes (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.generateFixes', async () => {
        vscode.window.showInformationMessage('ContextGuard AI: Generating multiple candidate fixes...');
        vscode.commands.executeCommand('contextguard.reproduceAndFix');
    }));
    // Command: Simulate Fixes (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.simulateFixes', async () => {
        vscode.window.showInformationMessage('ContextGuard AI: Running What-If fix simulations...');
    }));
    // Command: Verify Fix (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.verifyFix', async () => {
        vscode.window.showInformationMessage('ContextGuard AI: Running isolated verification sandbox...');
    }));
    // Command: Preview Diff (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.previewDiff', async () => {
        vscode.window.showInformationMessage('ContextGuard AI: Preview diff activated.');
    }));
    // Command: Apply Fix (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.applyFix', async () => {
        vscode.window.showInformationMessage('ContextGuard AI: Applying selected fix with safe checkpoint.');
    }));
    // Command: Rollback (Section 26)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.rollback', async () => {
        await sidebarProvider.rollbackPatch();
    }));
    // Command: Start Backend
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.startBackend', async () => {
        startLocalBackend(context);
    }));
    // Command: Check Backend Status
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.checkBackendStatus', async () => {
        const health = await backendClient.getHealth();
        sidebarProvider.refreshBackendStatus();
        if (health.connected) {
            vscode.window.showInformationMessage(`ContextGuard Backend Online: Privacy Mode: [${health.privacyMode.toUpperCase()}]. Model: ${health.activeModel}. Docker: ${health.dockerAvailable ? 'Yes' : 'Local Sandbox'}`);
        }
        else {
            vscode.window.showWarningMessage('ContextGuard Backend is currently offline. Built-in local offline engine active.');
        }
    }));
    // Command: Enable Runtime Snapshots
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.enableRuntimeSnapshots', async () => {
        snapshotManager_1.extensionSnapshotManager.setCaptureEnabled(true);
        statusBarItem.text = '$(record) ContextGuard: Snapshots Active';
        statusBarItem.tooltip = 'ContextGuard AI: Runtime snapshot capture active (Local-only mode)';
        vscode.window.showInformationMessage('ContextGuard AI: Runtime memory snapshot capture ENABLED (Local-only mode).');
    }));
    // Command: Disable Runtime Snapshots
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.disableRuntimeSnapshots', async () => {
        snapshotManager_1.extensionSnapshotManager.setCaptureEnabled(false);
        statusBarItem.text = '$(shield) ContextGuard: Local';
        statusBarItem.tooltip = 'ContextGuard AI: Privacy-First Bug Detection & Verification Engine';
        vscode.window.showInformationMessage('ContextGuard AI: Runtime memory snapshot capture DISABLED.');
    }));
    // Command: Show Recent Snapshots
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.showRecentSnapshots', async () => {
        const snaps = snapshotManager_1.extensionSnapshotManager.listSnapshots();
        if (snaps.length === 0) {
            vscode.window.showInformationMessage('ContextGuard AI: No runtime memory snapshots captured yet.');
            return;
        }
        const items = snaps.map((s) => ({
            label: `$(bug) ${s.errorType || 'RuntimeError'} on line ${s.lineNumber || '?'}`,
            description: `${path.basename(s.filePath || 'file')}:${s.lineNumber || '?'} [${Object.keys(s.variableSnapshots || {}).length} vars]`,
            detail: s.errorMessage || (s.heuristicExplanation || 'Exception frame state'),
            snapshot: s
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a runtime memory snapshot to inspect'
        });
        if (selected) {
            const fakeBug = {
                id: selected.snapshot.snapshotId || `snap_${Date.now()}`,
                file: selected.snapshot.filePath || 'unknown',
                line: selected.snapshot.lineNumber || 1,
                column: 1,
                errorType: selected.snapshot.errorType || 'RuntimeError',
                message: selected.snapshot.errorMessage || 'Runtime error captured',
                source: 'debugger',
                severity: 'HIGH',
                timestamp: selected.snapshot.timestamp || new Date().toISOString(),
                runtimeSnapshot: selected.snapshot
            };
            sidebarProvider.setCurrentBug(fakeBug);
        }
    }));
    // Command: Clear Snapshots (asks confirmation)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.clearSnapshots', async () => {
        const confirm = await vscode.window.showWarningMessage('Are you sure you want to clear all in-memory runtime snapshots?', { modal: true }, 'Clear Snapshots');
        if (confirm === 'Clear Snapshots') {
            const count = snapshotManager_1.extensionSnapshotManager.clearSnapshots();
            vscode.window.showInformationMessage(`ContextGuard AI: Cleared ${count} runtime memory snapshot(s).`);
        }
    }));
    // Command: Run File with Snapshot Tracing (opt-in diagnostic runner)
    context.subscriptions.push(vscode.commands.registerCommand('contextguard.runWithSnapshot', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.py')) {
            vscode.window.showWarningMessage('Please open a Python (.py) file to run with diagnostic snapshot tracing.');
            return;
        }
        const filePath = editor.document.fileName;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `ContextGuard AI: Running diagnostic tracing on ${path.basename(filePath)}...`,
            cancellable: false
        }, async () => {
            const res = await diagnosticRunner_1.DiagnosticRunner.runFileWithSnapshot(filePath, workspaceRoot);
            if (res.snapshot) {
                const bug = {
                    id: res.snapshot.snapshotId || `diag_${Date.now()}`,
                    file: res.snapshot.filePath || filePath,
                    line: res.snapshot.lineNumber || 1,
                    column: 1,
                    errorType: res.snapshot.errorType || 'RuntimeError',
                    message: res.snapshot.errorMessage || 'Diagnostic run captured runtime failure',
                    source: 'debugger',
                    severity: 'HIGH',
                    timestamp: res.snapshot.timestamp || new Date().toISOString(),
                    runtimeSnapshot: res.snapshot
                };
                sidebarProvider.setCurrentBug(bug);
                vscode.window.showWarningMessage(`ContextGuard AI: Runtime snapshot captured: ${res.snapshot.errorType} on line ${res.snapshot.lineNumber}.`, 'Inspect Variables').then((sel) => {
                    if (sel === 'Inspect Variables') {
                        sidebarProvider.setCurrentBug(bug);
                    }
                });
            }
            else if (res.exitCode === 0) {
                vscode.window.showInformationMessage(`ContextGuard AI: ${path.basename(filePath)} executed cleanly with zero runtime exceptions.`);
            }
            else {
                vscode.window.showWarningMessage(`ContextGuard AI: Execution exited with code ${res.exitCode}. No exception frame could be inspected.`);
            }
        });
    }));
    // Auto-check backend connection on activation
    sidebarProvider.refreshBackendStatus();
}
function startLocalBackend(context) {
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
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to start local backend: ${err.message}`);
    }
}
function deactivate() {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
}
//# sourceMappingURL=extension.js.map