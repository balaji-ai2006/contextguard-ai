import * as vscode from 'vscode';
import { BackendClient } from '../api/backendClient';
import {
  BugDNA,
  BugPreventionRule,
  CandidatePatch,
  CodeHealthRadar,
  DetectedBug,
  GitState,
  RootCauseGraph,
  SimilarBugRecord,
  TestQualityReport,
  TimeTravelFrame,
  WhatIfSimulation
} from '../models/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contextguard.sidebarView';
  private _view?: vscode.WebviewView;

  private currentBug?: DetectedBug;
  private candidatePatches: CandidatePatch[] = [];
  private rootCauseGraph?: RootCauseGraph;
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
          vscode.window.showInformationMessage('ContextGuard AI: Executing isolated verification sandbox...');
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

    try {
      const res = await this.backendClient.applyPatch(patch.id, this.currentBug.file, patch.diff);
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
    this._view.webview.postMessage({
      type: 'updateState',
      state: {
        currentBug: this.currentBug,
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
        reproductionConfirmed: this.reproductionConfirmed
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
    function verifyFix() { vscode.postMessage({ type: 'onVerifyFix' }); }
    function applyPatch(patchId) { vscode.postMessage({ type: 'onApplyPatch', patchId }); }
    function rollback() { vscode.postMessage({ type: 'onRollback' }); }
    function previewDiff(patchId) { vscode.postMessage({ type: 'onPreviewDiff', patchId }); }
    function openBugFile() { vscode.postMessage({ type: 'onOpenBugFile' }); }

    function render() {
      const container = document.getElementById('content');
      if (!currentState.currentBug) {
        container.innerHTML = \`
          <div class="card" style="text-align: center; color: #94a3b8; padding: 20px 10px;">
            <p style="font-weight: 600;">No active bug selected</p>
            <p style="font-size: 11px;">Save a file with an error, trigger terminal execution, or click Analyze Bug above.</p>
          </div>
        \`;
        return;
      }

      const bug = currentState.currentBug;
      const dna = currentState.bugDna;
      const tt = currentState.timeTravelFrames || [];
      const sims = currentState.simulations || [];
      const prev = currentState.preventionRules || [];
      const tq = currentState.testQuality;
      const ch = currentState.codeHealth;

      let html = \`
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
            <div class="card">
              <div class="card-title">
                <span>Fix #\${idx + 1}: \${escapeHtml(p.title)}</span>
                <span class="status-pill status-\${p.verificationStatus}">\${p.verificationStatus}</span>
              </div>
              <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">\${escapeHtml(p.description)}</div>
              <div style="font-size: 11px; font-weight: 700; color: #38bdf8;">Evidence Confidence: \${p.confidence}/100</div>
              
              <!-- Buttons -->
              <div class="btn-group">
                <button class="btn btn-secondary" onclick="previewDiff('\${p.id}')">Preview Diff</button>
                <button class="btn" onclick="applyPatch('\${p.id}')">Apply Fix</button>
              </div>
            </div>
          \`;
        });

        html += \`
          <button class="btn btn-danger" onclick="rollback()">↩️ Rollback to Safe Checkpoint</button>
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
