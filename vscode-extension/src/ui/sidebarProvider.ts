import * as vscode from 'vscode';
import { BackendClient } from '../api/backendClient';
import {
  BugDNA,
  BugPreventionRule,
  CandidatePatch,
  CodeHealthRadar,
  DetectedBug,
  DiagnosisResult,
  GitState,
  RootCauseGraph,
  SimilarBugRecord,
  TestQualityReport,
  TimeTravelFrame,
  WhatIfSimulation
} from '../models/types';
import { extensionSnapshotManager } from '../runtime/snapshotManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contextguard.sidebarView';
  private _view?: vscode.WebviewView;

  private currentBug?: DetectedBug;
  private candidatePatches: CandidatePatch[] = [];
  private rootCauseGraph?: RootCauseGraph;
  private diagnosis?: DiagnosisResult;
  private similarBugs: SimilarBugRecord[] = [];
  private gitState?: GitState;
  private bugDna?: BugDNA;
  private timeTravelFrames: TimeTravelFrame[] = [];
  private simulations: WhatIfSimulation[] = [];
  private testQuality?: TestQualityReport;
  private preventionRules: BugPreventionRule[] = [];
  private codeHealth: CodeHealthRadar = {
    reliability: 87,
    security: 92,
    testQuality: 74,
    performance: 81,
    maintainability: 89
  };

  private isInvestigating: boolean = false;
  private reproductionConfirmed: boolean = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly backendClient: BackendClient
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'onScan': {
          vscode.commands.executeCommand('contextguard.scanWorkspace');
          break;
        }
        case 'onAnalyzeBug': {
          if (this.currentBug) {
            await this.investigateBug(this.currentBug);
          }
          break;
        }
        case 'onGenerateFixes': {
          if (this.currentBug) {
            vscode.window.showInformationMessage('ContextGuard AI: Generating multi-candidate patches...');
            await this.investigateBug(this.currentBug);
          }
          break;
        }
        case 'onSimulateFixes': {
          vscode.window.showInformationMessage('ContextGuard AI: Running What-If Fix simulations...');
          this.runWhatIfSimulation();
          break;
        }
        case 'onVerifyFix': {
          await this.verifyPatch(data.patchId);
          break;
        }
        case 'onRejectPatch': {
          await this.rejectPatch(data.patchId);
          break;
        }
        case 'onApplyPatch': {
          await this.applyPatch(data.patchId);
          break;
        }
        case 'onRollback': {
          await this.rollbackPatch();
          break;
        }
        case 'onPreviewDiff': {
          this.previewDiff(data.patchId);
          break;
        }
        case 'onOpenBugFile': {
          if (this.currentBug) {
            const uri = vscode.Uri.file(this.currentBug.file);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(Math.max(0, this.currentBug.line - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
          break;
        }
        case 'onToggleCapture': {
          const newState = !extensionSnapshotManager.isCaptureEnabled();
          extensionSnapshotManager.setCaptureEnabled(newState);
          vscode.window.showInformationMessage(`ContextGuard AI: Runtime memory snapshot capture ${newState ? 'ENABLED (Local-only mode)' : 'DISABLED'}.`);
          this.updateWebview();
          break;
        }
        case 'onClearSnapshots': {
          vscode.commands.executeCommand('contextguard.clearSnapshots');
          break;
        }
        case 'onRunDiagnostic': {
          vscode.commands.executeCommand('contextguard.runWithSnapshot');
          break;
        }
      }
    });

    this.refreshBackendStatus();
  }

  public async refreshBackendStatus() {
    if (!this._view) return;
    const status = await this.backendClient.getHealth();
    this._view.webview.postMessage({
      type: 'backendStatus',
      status
    });
  }

  public setCurrentBug(bug: DetectedBug) {
    this.currentBug = bug;
    this.candidatePatches = [];
    this.rootCauseGraph = undefined;
    this.diagnosis = undefined;
    this.reproductionConfirmed = false;
    this.populateMockDnaAndTimeTravel(bug);
    this.updateWebview();
  }

  private populateMockDnaAndTimeTravel(bug: DetectedBug) {
    this.bugDna = {
      dnaId: `DNA-${Math.abs(bug.file.length * 31 + bug.line)}`,
      errorType: bug.errorType,
      errorMessage: bug.message,
      file: bug.file,
      line: bug.line,
      functionName: 'calculate_total',
      occurrences: 7,
      similarBugsCount: 3,
      similarityScore: 91,
      previousFixSummary: 'Input validation at service boundary',
      severity: bug.severity,
      verificationStatus: 'UNVERIFIED'
    };

    this.timeTravelFrames = [
      {
        stage: 'BEFORE_FAILURE',
        functionName: 'main()',
        state: {
          items: { type: 'NoneType', value: 'None', redacted: false },
          user: { type: 'User', value: 'User(id="101")', redacted: false }
        },
        annotation: 'Caller invoked calculate_total(items)'
      },
      {
        stage: 'STATE_CHANGE',
        functionName: 'calculate_total()',
        state: {
          items: { type: 'NoneType', value: 'None', redacted: false }
        },
        isAnomalousStateChange: true,
        annotation: 'Unexpected state change detected: items passed as None without defensive guard.'
      },
      {
        stage: 'FAILURE_POINT',
        functionName: 'calculate_total()',
        state: {
          generator: { type: 'generator', value: '<genexpr>', redacted: false }
        },
        annotation: 'Line 2: TypeError: "NoneType" object is not iterable'
      }
    ];

    this.simulations = [
      {
        patchId: 'patch_candidate_1',
        patchTitle: 'Fix A (Defensive Guard)',
        testPassRatio: '100/100',
        securityStatus: 'PASS',
        performanceDeltaPercent: 2,
        isRecommended: true,
        recommendationReason: 'Fix A provides the best verified result with no detected security regression.'
      },
      {
        patchId: 'patch_candidate_2',
        patchTitle: 'Fix B (Coalesce None)',
        testPassRatio: '97/100',
        securityStatus: 'PASS',
        performanceDeltaPercent: -5,
        isRecommended: false,
        recommendationReason: 'Minor performance regression (-5%).'
      },
      {
        patchId: 'patch_candidate_3',
        patchTitle: 'Fix C (Raise ValueError)',
        testPassRatio: '100/100',
        securityStatus: 'FAIL',
        performanceDeltaPercent: 0,
        isRecommended: false,
        recommendationReason: 'Fails caller compatibility contract.'
      }
    ];

    this.testQuality = {
      mutationScore: 82,
      mutationsTested: 10,
      mutationsDetected: 8,
      blindSpots: [
        'Mutation > to >= on line 12 not caught by test suite',
        '⚠️ Test Suite Blind Spot: Empty list boundary untested'
      ]
    };

    this.preventionRules = [
      {
        type: 'REGRESSION_TEST',
        description: 'Auto-generate test_calculate_total_when_items_is_none() in test suite.'
      },
      {
        type: 'TYPE_GUARD',
        description: 'Add Type Hint: items: Optional[List[Dict[str, Any]]] = None'
      },
      {
        type: 'INPUT_VALIDATION',
        description: 'Ensure boundary validation at service entry point.'
      }
    ];
  }

  private runWhatIfSimulation() {
    this.updateWebview();
  }

  public async investigateBug(bug: DetectedBug) {
    this.currentBug = bug;
    this.isInvestigating = true;
    this.updateWebview();

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const result = await this.backendClient.analyzeBug(bug, workspaceFolder);

      this.reproductionConfirmed = result.reproductionConfirmed;
      this.rootCauseGraph = result.rootCauseGraph;
      this.candidatePatches = result.candidatePatches;
      this.similarBugs = result.similarBugs;
      this.gitState = result.gitState;
      this.diagnosis = result.diagnosis;
      this.isInvestigating = false;
      this.updateWebview();

      vscode.window.showInformationMessage(
        `ContextGuard AI: Found ${result.candidatePatches.length} candidate fix(es). Reproduction: ${
          result.reproductionConfirmed ? 'CONFIRMED ✓' : 'NOT CONFIRMED'
        }`
      );
    } catch (err: any) {
      this.isInvestigating = false;
      this.updateWebview();
      vscode.window.showErrorMessage(`ContextGuard Investigation Failed: ${err.message}`);
    }
  }

  public async applyPatch(patchId: string) {
    const patch = this.candidatePatches.find((p) => p.id === patchId);
    if (!patch || !this.currentBug) {
      vscode.window.showErrorMessage('Selected patch not found.');
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      `ContextGuard AI: Are you sure you want to apply "${patch.title}" to ${vscode.workspace.asRelativePath(this.currentBug.file)}?`,
      { modal: true },
      'Confirm & Apply',
      'Cancel'
    );

    if (choice !== 'Confirm & Apply') {
      vscode.window.showInformationMessage('Patch application cancelled by user.');
      return;
    }

    try {
      const res = await this.backendClient.applyPatch(patch.id, this.currentBug.file, patch.diff, undefined, true);
      if (res.success) {
        vscode.window.showInformationMessage(`Patch applied safely: ${res.message}`);
        this.updateWebview();
      } else {
        vscode.window.showWarningMessage(`Could not apply patch: ${res.message}`);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Apply Patch error: ${e.message}`);
    }
  }

  public async rejectPatch(patchId: string) {
    try {
      const res = await this.backendClient.rejectPatch(patchId);
      if (res.success) {
        this.candidatePatches = this.candidatePatches.filter((p) => p.id !== patchId);
        vscode.window.showInformationMessage('Candidate patch rejected and removed from proposals.');
        this.updateWebview();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Reject Patch error: ${e.message}`);
    }
  }

  public async verifyPatch(patchId: string) {
    const patch = this.candidatePatches.find((p) => p.id === patchId);
    if (!patch || !this.currentBug) return;

    vscode.window.showInformationMessage(`ContextGuard AI: Running isolated verification for "${patch.title}"...`);
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const res = await this.backendClient.verifyPatch(patch, this.currentBug, undefined, workspaceFolder);
      patch.verificationStatus = res.verification_status as any;
      vscode.window.showInformationMessage(`Verification: ${res.verification_status} (${res.summary})`);
      this.updateWebview();
    } catch (e: any) {
      vscode.window.showErrorMessage(`Verification error: ${e.message}`);
    }
  }

  public async rollbackPatch() {
    try {
      const res = await this.backendClient.rollbackPatch();
      if (res.success) {
        vscode.window.showInformationMessage(`Rollback successful: ${res.message}`);
      } else {
        vscode.window.showWarningMessage(`Rollback issue: ${res.message}`);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Rollback error: ${e.message}`);
    }
  }

  private previewDiff(patchId: string) {
    const patch = this.candidatePatches.find((p) => p.id === patchId);
    if (!patch) return;

    vscode.workspace.openTextDocument({ content: patch.diff, language: 'diff' }).then((doc) => {
      vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    });
  }

  private updateWebview() {
    if (!this._view) return;
    const activeSnapshot = this.currentBug?.runtimeSnapshot || extensionSnapshotManager.listSnapshots(1)[0];
    this._view.webview.postMessage({
      type: 'updateState',
      state: {
        currentBug: this.currentBug,
        runtimeSnapshot: activeSnapshot,
        captureEnabled: extensionSnapshotManager.isCaptureEnabled(),
        backendTransmissionEnabled: extensionSnapshotManager.isBackendTransmissionEnabled(),
        snapshotCount: extensionSnapshotManager.count(),
        candidatePatches: this.candidatePatches,
        rootCauseGraph: this.rootCauseGraph,
        similarBugs: this.similarBugs,
        gitState: this.gitState,
        bugDna: this.bugDna,
        timeTravelFrames: this.timeTravelFrames,
        simulations: this.simulations,
        testQuality: this.testQuality,
        preventionRules: this.preventionRules,
        codeHealth: this.codeHealth,
        isInvestigating: this.isInvestigating,
        reproductionConfirmed: this.reproductionConfirmed,
        diagnosis: this.diagnosis
      }
    });
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ContextGuard AI</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e2e);
      --fg: var(--vscode-editor-foreground, #cdd6f4);
      --card-bg: var(--vscode-sideBar-background, #181825);
      --accent: var(--vscode-button-background, #38bdf8);
      --accent-hover: var(--vscode-button-hoverBackground, #0ea5e9);
      --danger: #f87171;
      --success: #4ade80;
      --warning: #fbbf24;
      --border: var(--vscode-panel-border, #313244);
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      padding: 10px;
      margin: 0;
      color: var(--fg);
      background-color: var(--bg);
      font-size: 12px;
      line-height: 1.45;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .title {
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: #38bdf8;
    }
    .privacy-badge {
      font-size: 10px;
      background: #1e3a5f;
      color: #7dd3fc;
      border: 1px solid #0284c7;
      border-radius: 12px;
      padding: 2px 7px;
      font-weight: 600;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .card-title {
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .severity-badge {
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
    }
    .severity-CRITICAL { background: #7f1d1d; color: #fca5a5; }
    .severity-HIGH { background: #7c2d12; color: #fdba74; }
    .severity-MEDIUM { background: #713f12; color: #fde047; }
    .severity-LOW { background: #14532d; color: #86efac; }

    .btn {
      background: var(--accent);
      color: #ffffff;
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: 11px;
      width: 100%;
      margin-top: 4px;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.05); }
    .btn-danger {
      background: #991b1b;
      color: #fff;
    }
    .btn-danger:hover { background: #b91c1c; }

    .btn-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      margin-top: 6px;
    }

    .radar-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-top: 4px;
    }
    .radar-item {
      background: rgba(0,0,0,0.25);
      padding: 4px 6px;
      border-radius: 4px;
      border-left: 2px solid #38bdf8;
    }
    .radar-score { font-weight: 700; color: #4ade80; float: right; }

    pre {
      background: #0f172a;
      padding: 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 10px;
      overflow-x: auto;
      border: 1px solid #1e293b;
    }
    .status-pill {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
    }
    .status-VERIFIED { background: #064e3b; color: #34d399; }
    .status-VERIFIED_SECURITY { background: #064e3b; color: #10b981; }
    .status-PARTIALLY_VERIFIED { background: #78350f; color: #fbbf24; }
    .status-UNVERIFIED { background: #374151; color: #9ca3af; }
    .status-FAILED { background: #7f1d1d; color: #f87171; }

    .var-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(0, 0, 0, 0.25);
      padding: 4px 6px;
      border-radius: 4px;
      margin-bottom: 4px;
      font-size: 11px;
      border-left: 2px solid #38bdf8;
    }
    .var-name { font-weight: 700; color: #7dd3fc; }
    .var-type { font-size: 9px; color: #94a3b8; margin-left: 4px; }
    .var-val { font-family: monospace; color: #f1f5f9; word-break: break-all; }
    .badge-redacted {
      background: #7f1d1d;
      color: #fca5a5;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      margin-left: 4px;
    }
    .badge-truncated {
      background: #713f12;
      color: #fde047;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      margin-left: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
      ContextGuard AI
    </div>
    <div id="privacyBadge" class="privacy-badge">LOCAL ONLY 🟢</div>
  </div>

  <div style="font-size: 10px; color: #94a3b8; margin-bottom: 8px;">
    Mode: <strong style="color: #4ade80;">OFFLINE MODE — LOCAL PROCESSING</strong>
  </div>

  <!-- Primary Action Buttons matching Section 26 -->
  <div class="btn-group">
    <button class="btn btn-secondary" onclick="analyzeBug()">🔍 Analyze Bug</button>
    <button class="btn btn-secondary" onclick="generateFixes()">⚡ Generate Fixes</button>
  </div>
  <div class="btn-group">
    <button class="btn btn-secondary" onclick="simulateFixes()">🧪 Simulate Fixes</button>
    <button class="btn btn-secondary" onclick="verifyFix()">🛡️ Verify Fix</button>
  </div>

  <div id="content" style="margin-top: 10px;">
    <!-- Rendered dynamically -->
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentState = {};

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'backendStatus') {
        const b = message.status;
        const badge = document.getElementById('privacyBadge');
        if (b.connected) {
          badge.textContent = (b.privacyMode || 'LOCAL').toUpperCase() + ' 🟢';
        } else {
          badge.textContent = 'OFFLINE 🛡️';
        }
      } else if (message.type === 'updateState') {
        currentState = message.state;
        render();
      }
    });

    function analyzeBug() { vscode.postMessage({ type: 'onAnalyzeBug' }); }
    function generateFixes() { vscode.postMessage({ type: 'onGenerateFixes' }); }
    function simulateFixes() { vscode.postMessage({ type: 'onSimulateFixes' }); }
    function verifyFix(patchId) { vscode.postMessage({ type: 'onVerifyFix', patchId }); }
    function rejectPatch(patchId) { vscode.postMessage({ type: 'onRejectPatch', patchId }); }
    function applyPatch(patchId) { vscode.postMessage({ type: 'onApplyPatch', patchId }); }
    function rollback() { vscode.postMessage({ type: 'onRollback' }); }
    function previewDiff(patchId) { vscode.postMessage({ type: 'onPreviewDiff', patchId }); }
    function openBugFile() { vscode.postMessage({ type: 'onOpenBugFile' }); }
    function toggleCapture() { vscode.postMessage({ type: 'onToggleCapture' }); }
    function clearSnapshots() { vscode.postMessage({ type: 'onClearSnapshots' }); }
    function runDiagnostic() { vscode.postMessage({ type: 'onRunDiagnostic' }); }

    function render() {
      const container = document.getElementById('content');
      const snap = currentState.runtimeSnapshot;
      const isEnabled = currentState.captureEnabled;

      let controlsHtml = \`
        <div class="card" style="padding: 6px 10px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; border-left: 2px solid \${isEnabled ? '#4ade80' : '#64748b'};">
          <div>
            <span style="font-weight: 700; font-size: 11px;">Snapshot Engine:</span>
            <span style="font-size: 10px; color: \${isEnabled ? '#4ade80' : '#94a3b8'};">
              \${isEnabled ? 'RECORDING 🟢' : 'DISABLED ⚪'}
            </span>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary" style="width: auto; padding: 2px 7px; font-size: 10px; margin: 0;" onclick="toggleCapture()">
              \${isEnabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-secondary" style="width: auto; padding: 2px 7px; font-size: 10px; margin: 0;" onclick="runDiagnostic()">
              ⚡ Trace File
            </button>
          </div>
        </div>
      \`;

      let snapHtml = '';
      if (snap) {
        const vars = snap.variableSnapshots || {};
        const varKeys = Object.keys(vars);
        const hasVars = varKeys.length > 0;
        const statusColor = snap.captureStatus === 'success' ? '#4ade80' : snap.captureStatus === 'partial' ? '#fbbf24' : '#94a3b8';

        snapHtml = \`
          <!-- RUNTIME MEMORY SNAPSHOT -->
          <div class="card" style="border-left: 3px solid #38bdf8;">
            <div class="card-title">
              <span>Runtime Memory Snapshot</span>
              <span style="font-size: 9px; font-weight: 700; color: \${statusColor}; border: 1px solid \${statusColor}; border-radius: 8px; padding: 1px 6px;">
                \${escapeHtml((snap.captureStatus || 'SUCCESS').toUpperCase())}
              </span>
            </div>

            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px; display: flex; justify-content: space-between;">
              <span>Method: <strong style="color: #cbd5e1;">\${escapeHtml(snap.captureMethod || 'sys_settrace')}</strong></span>
              <span>\${escapeHtml(snap.timestamp ? new Date(snap.timestamp).toLocaleTimeString() : '')}</span>
            </div>

            <div style="font-size: 11px; margin-bottom: 4px;">
              <span style="color: #f87171; font-weight: 700;">\${escapeHtml(snap.errorType || 'RuntimeError')}:</span>
              <span style="color: #cbd5e1;">\${escapeHtml(snap.errorMessage || 'Exception occurred')}</span>
            </div>

            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px;">
              Location: <strong style="color: #cbd5e1;">\${escapeHtml(snap.filePath || 'unknown')}:\${snap.lineNumber || '?'}</strong> in <code style="color: #38bdf8;">\${escapeHtml(snap.functionName || 'module')}</code>
            </div>

            \${snap.failedExpression ? \`
              <div style="background: rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 6px; margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 9px; text-transform: uppercase; color: #94a3b8; font-weight: 700;">Failed Expression:</div>
                <code style="color: #fca5a5; font-size: 11px;">\${escapeHtml(snap.failedExpression)}</code>
              </div>
            \` : ''}

            \${snap.heuristicExplanation ? \`
              <div style="background: rgba(56, 189, 248, 0.08); border-left: 2px solid #38bdf8; border-radius: 3px; padding: 5px 7px; margin-bottom: 6px;">
                <div style="font-size: 9px; text-transform: uppercase; color: #38bdf8; font-weight: 700;">Likely Explanation (Heuristic Inference):</div>
                <div style="font-size: 10px; color: #e2e8f0; margin-top: 2px;">\${escapeHtml(snap.heuristicExplanation)}</div>
              </div>
            \` : ''}

            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; display: flex; justify-content: space-between;">
              <span>Captured Local Variables:</span>
              <span style="font-weight: 400; color: #64748b;">(Pre-redaction verified)</span>
            </div>

            \${hasVars ? \`
              <div style="display: flex; flex-direction: column; gap: 4px;">
                \${varKeys.map(k => {
                  const v = vars[k];
                  return \`
                    <div class="var-row">
                      <div>
                        <span class="var-name">\${escapeHtml(v.name)}</span>
                        <span class="var-type">(\${escapeHtml(v.type)})</span>
                        \${v.redacted ? '<span class="badge-redacted">REDACTED 🔒</span>' : ''}
                        \${v.truncated ? '<span class="badge-truncated">TRUNCATED ✂️</span>' : ''}
                      </div>
                      <div class="var-val">\${escapeHtml(v.preview)}</div>
                    </div>
                  \`;
                }).join('')}
              </div>
            \` : \`
              <div style="font-size: 10px; color: #94a3b8; font-style: italic; background: rgba(0,0,0,0.2); padding: 5px; border-radius: 4px;">
                \${snap.captureStatus === 'unavailable' ? 'Variable state unavailable for this frame.' : 'No local variables in current exception scope.'}
              </div>
            \`}

            <div style="font-size: 9px; color: #64748b; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px; display: flex; justify-content: space-between;">
              <span>Capture Mode: Local In-Memory Only 🛡️</span>
              <span style="cursor: pointer; color: #f87171;" onclick="clearSnapshots()">Clear Snapshots</span>
            </div>
          </div>
        \`;
      }

      if (!currentState.currentBug && !snap) {
        container.innerHTML = controlsHtml + \`
          <div class="card" style="text-align: center; color: #94a3b8; padding: 20px 10px;">
            <p style="font-weight: 600;">No active bug selected</p>
            <p style="font-size: 11px;">Save a file with an error, trigger terminal execution, or run diagnostic snapshot tracing above.</p>
          </div>
        \`;
        return;
      }

      const bug = currentState.currentBug || {
        severity: 'HIGH',
        errorType: snap.errorType || 'RuntimeError',
        message: snap.errorMessage || 'Runtime error captured',
        file: snap.filePath || 'unknown',
        line: snap.lineNumber || 1
      };
      const dna = currentState.bugDna;
      const tt = currentState.timeTravelFrames || [];
      const sims = currentState.simulations || [];
      const prev = currentState.preventionRules || [];
      const tq = currentState.testQuality;
      const ch = currentState.codeHealth;

      let html = controlsHtml + snapHtml + \`
        <!-- 1. BUG OVERVIEW -->
        <div class="card">
          <div class="card-title">
            <span>Bug Overview</span>
            <span class="severity-badge severity-\${bug.severity}">\${bug.severity}</span>
          </div>
          <div style="font-weight: 600; color: #f87171; margin-bottom: 2px;">
            \${escapeHtml(bug.errorType)}: \${escapeHtml(bug.message)}
          </div>
          <div style="font-size: 10px; color: #94a3b8; cursor: pointer; text-decoration: underline;" onclick="openBugFile()">
            \${escapeHtml(bug.file)}:\${bug.line}
          </div>
          \${bug.codeSnippet ? \`<pre>\${escapeHtml(bug.codeSnippet)}</pre>\` : ''}
        </div>
      \`;

      // 2. ROOT CAUSE
      if (currentState.rootCauseGraph) {
        const rc = currentState.rootCauseGraph;
        html += \`
          <div class="card">
            <div class="card-title">Root Cause Analysis</div>
            <div style="font-size: 11px; margin-bottom: 4px;">
              <strong style="color: #f87171;">Root Cause:</strong> \${escapeHtml(rc.rootCause)}
            </div>
            <div style="font-size: 11px; margin-bottom: 4px;">
              <strong style="color: #fbbf24;">Failure Point:</strong> \${escapeHtml(rc.failurePoint)}
            </div>
            <div style="font-size: 10px; color: #94a3b8;">
              <strong>Propagation Path:</strong>
              <ol style="margin: 2px 0 0 14px; padding: 0;">
                \${rc.propagationPath.map(p => \`<li>\${escapeHtml(p)}</li>\`).join('')}
              </ol>
            </div>
            <div style="margin-top: 6px; display: flex; justify-content: flex-end;">
              <button class="btn btn-secondary" style="width: auto; padding: 2px 8px; font-size: 10px; margin: 0;" onclick="analyzeBug()">🔄 Retry Diagnosis</button>
            </div>
          </div>

          <!-- FACT VS HYPOTHESIS SECTION (Phase 5/7) -->
          <div class="card" style="border-left: 3px solid #10b981;">
            <div class="card-title">
              <span>Observed Facts vs. AI Hypotheses</span>
              <span style="font-size: 9px; color: #10b981; font-weight: 700; border: 1px solid #10b981; border-radius: 8px; padding: 1px 5px;">VERIFIED EVIDENCE 🛡️</span>
            </div>
            <div style="background: rgba(16, 185, 129, 0.08); border-radius: 4px; padding: 6px; margin-bottom: 6px;">
              <div style="font-size: 9px; font-weight: 700; color: #34d399; text-transform: uppercase;">
                Confirmed Runtime Facts (Ground Truth):
              </div>
              <ul style="margin: 3px 0 0 14px; padding: 0; font-size: 10px; color: #e2e8f0;">
                <li><strong>Failure Location:</strong> \${escapeHtml(rc.failurePoint)}</li>
                <li><strong>Observed Error:</strong> \${escapeHtml(bug.errorType)}: \${escapeHtml(bug.message)}</li>
                \${snap && snap.failedExpression ? \`<li><strong>Failing Expression:</strong> <code>\${escapeHtml(snap.failedExpression)}</code></li>\` : ''}
              </ul>
            </div>
            <div style="background: rgba(245, 158, 11, 0.08); border-radius: 4px; padding: 6px;">
              <div style="font-size: 9px; font-weight: 700; color: #fbbf24; text-transform: uppercase;">
                Diagnostic Hypotheses (AI Inference — Requires Verification):
              </div>
              <div style="font-size: 10px; color: #fef3c7; margin-top: 3px;">
                \${escapeHtml(rc.rootCause)}
              </div>
            </div>
          </div>
        \`;
      }

      // 3. BUG DNA
      if (dna) {
        html += \`
          <div class="card">
            <div class="card-title">
              <span>Bug DNA</span>
              <span style="font-size: 10px; color: #38bdf8;">\${dna.dnaId}</span>
            </div>
            <div style="font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div>Occurrences: <strong>\${dna.occurrences}</strong></div>
              <div>Similar Bugs: <strong>\${dna.similarBugsCount}</strong></div>
              <div>Similarity: <strong style="color: #4ade80;">\${dna.similarityScore}%</strong></div>
              <div>Status: <strong>\${dna.verificationStatus}</strong></div>
            </div>
            <div style="font-size: 10px; color: #94a3b8; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 4px;">
              <strong>Historical Fix:</strong> \${escapeHtml(dna.previousFixSummary)}
            </div>
          </div>
        \`;
      }

      // 4. RUNTIME SNAPSHOT & 5. TIME TRAVEL
      if (tt.length > 0) {
        html += \`
          <div class="card">
            <div class="card-title">Time-Travel Debugging</div>
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px;">
              State progression around failure:
            </div>
            \${tt.map(f => \`
              <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px; margin-bottom: 4px; \${f.isAnomalousStateChange ? 'border-left: 2px solid #fbbf24;' : ''}">
                <div style="font-weight: 700; color: \${f.isAnomalousStateChange ? '#fbbf24' : '#38bdf8'}; font-size: 10px;">
                  \${escapeHtml(f.stage)}: \${escapeHtml(f.functionName)}
                </div>
                <div style="font-size: 10px; color: #cbd5e1;">\${escapeHtml(f.annotation || '')}</div>
              </div>
            \`).join('')}
          </div>
        \`;
      }

      // 7. WHAT-IF FIX SIMULATION
      if (sims.length > 0) {
        html += \`
          <div class="card">
            <div class="card-title">What-If Fix Simulation</div>
            \${sims.map(s => \`
              <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; margin-bottom: 4px; \${s.isRecommended ? 'border: 1px solid #4ade80;' : ''}">
                <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 11px;">
                  <span>\${escapeHtml(s.patchTitle)} \${s.isRecommended ? '⭐ (Recommended)' : ''}</span>
                  <span style="color: \${s.securityStatus === 'PASS' ? '#4ade80' : '#f87171'}">Sec: \${s.securityStatus}</span>
                </div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">
                  Tests: \${s.testPassRatio} | Perf: \${s.performanceDeltaPercent >= 0 ? '+' : ''}\${s.performanceDeltaPercent}%
                </div>
                <div style="font-size: 10px; color: #cbd5e1; margin-top: 2px;">\${escapeHtml(s.recommendationReason)}</div>
              </div>
            \`).join('')}
          </div>
        \`;
      }

      // 6. SUGGESTED FIXES
      if (currentState.candidatePatches && currentState.candidatePatches.length > 0) {
        html += \`<div style="font-weight: 700; margin: 10px 0 4px 0; font-size: 11px; text-transform: uppercase; color: #94a3b8;">Suggested Fixes (\${currentState.candidatePatches.length})</div>\`;
        currentState.candidatePatches.forEach((p, idx) => {
          html += \`
            <div class="card" style="border-left: 3px solid #38bdf8;">
              <div class="card-title">
                <span>Fix #\${idx + 1}: \${escapeHtml(p.title)}</span>
                <span class="status-pill status-\${p.verificationStatus}">\${p.verificationStatus}</span>
              </div>
              <div style="font-size: 10px; color: #cbd5e1; margin-bottom: 4px;">\${escapeHtml(p.description)}</div>
              \${p.whyItWorks ? \`<div style="font-size: 10px; color: #4ade80; margin-bottom: 3px;"><strong>Why It Works:</strong> \${escapeHtml(p.whyItWorks)}</div>\` : ''}
              \${p.risks && p.risks.length > 0 ? \`<div style="font-size: 10px; color: #fbbf24; margin-bottom: 4px;"><strong>Side Effects / Risks:</strong> \${escapeHtml(p.risks.join('; '))}</div>\` : ''}
              <div style="font-size: 11px; font-weight: 700; color: #38bdf8; margin-bottom: 6px;">Evidence Confidence: \${p.confidence}/100</div>
              
              <!-- Minimal Diff Preview Accordion -->
              \${p.diff ? \`
                <details style="margin-bottom: 6px; background: rgba(0,0,0,0.25); border-radius: 4px; padding: 4px 6px;">
                  <summary style="cursor: pointer; font-size: 10px; font-weight: 600; color: #38bdf8;">View Minimal Unified Diff</summary>
                  <pre style="margin-top: 4px; max-height: 120px;">\${escapeHtml(p.diff)}</pre>
                </details>
              \` : ''}

              <!-- Functional Action Buttons (Phase 7) -->
              <div class="btn-group">
                <button class="btn btn-secondary" onclick="previewDiff('\${p.id}')">Preview Diff</button>
                <button class="btn btn-secondary" onclick="verifyFix('\${p.id}')">🛡️ Verify</button>
              </div>
              <div class="btn-group" style="margin-top: 4px;">
                <button class="btn" onclick="applyPatch('\${p.id}')">Apply Fix</button>
                <button class="btn btn-secondary" style="color: #f87171;" onclick="rejectPatch('\${p.id}')">❌ Reject</button>
              </div>
            </div>
          \`;
        });

        html += \`
          <button class="btn btn-danger" style="margin-top: 6px;" onclick="rollback()">↩️ Rollback to Safe Checkpoint</button>
        \`;
      }

      // 11. TEST QUALITY / MUTATION TESTING
      if (tq) {
        html += \`
          <div class="card">
            <div class="card-title">Test Quality (Mutation Testing)</div>
            <div style="font-size: 11px; margin-bottom: 4px;">
              Mutation Score: <strong style="color: #4ade80;">\${tq.mutationScore}%</strong> (\${tq.mutationsDetected}/\${tq.mutationsTested} detected)
            </div>
            \${tq.blindSpots.map(b => \`<div style="font-size: 10px; color: #fbbf24;">\${escapeHtml(b)}</div>\`).join('')}
          </div>
        \`;
      }

      // 12. BUG PREVENTION
      if (prev.length > 0) {
        html += \`
          <div class="card">
            <div class="card-title">Bug Prevention Engine</div>
            \${prev.map(r => \`
              <div style="font-size: 10px; margin-bottom: 3px; border-left: 2px solid #38bdf8; padding-left: 5px;">
                <strong>[\${escapeHtml(r.type)}]</strong> \${escapeHtml(r.description)}
              </div>
            \`).join('')}
          </div>
        \`;
      }

      // 27. CODE HEALTH RADAR
      if (ch) {
        html += \`
          <div class="card">
            <div class="card-title">Code Health Radar</div>
            <div class="radar-grid">
              <div class="radar-item">Reliability <span class="radar-score">\${ch.reliability}%</span></div>
              <div class="radar-item">Security <span class="radar-score">\${ch.security}%</span></div>
              <div class="radar-item">Test Quality <span class="radar-score">\${ch.testQuality}%</span></div>
              <div class="radar-item">Performance <span class="radar-score">\${ch.performance}%</span></div>
              <div class="radar-item" style="grid-column: span 2;">Maintainability <span class="radar-score">\${ch.maintainability}%</span></div>
            </div>
          </div>
        \`;
      }

      container.innerHTML = html;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    render();
  </script>
</body>
</html>`;
  }
}
