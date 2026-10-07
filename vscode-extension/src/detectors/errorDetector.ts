import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DetectedBug, SeverityLevel } from '../models/types';

export class ErrorDetector {
  /**
   * Scans current VS Code diagnostics across workspace or active editor.
   */
  public static scanDiagnostics(targetUri?: vscode.Uri): DetectedBug[] {
    const bugs: DetectedBug[] = [];
    const allDiagnostics = targetUri
      ? [[targetUri, vscode.languages.getDiagnostics(targetUri)] as [vscode.Uri, vscode.Diagnostic[]]]
      : vscode.languages.getDiagnostics();

    for (const [uri, diagnostics] of allDiagnostics) {
      if (uri.scheme !== 'file') {
        continue;
      }
      for (const diag of diagnostics) {
        if (diag.severity === vscode.DiagnosticSeverity.Error || diag.severity === vscode.DiagnosticSeverity.Warning) {
          const bug = this.diagnosticToBug(uri, diag);
          if (bug) {
            bugs.push(bug);
          }
        }
      }
    }

    return bugs;
  }

  /**
   * Analyzes an active text editor document for syntactic and type anomalies.
   */
  public static async analyzeDocument(document: vscode.TextDocument): Promise<DetectedBug[]> {
    const bugs = this.scanDiagnostics(document.uri);
    return bugs;
  }

  public static diagnosticToBug(uri: vscode.Uri, diag: vscode.Diagnostic): DetectedBug {
    const filePath = uri.fsPath;
    const line = diag.range.start.line + 1;
    const column = diag.range.start.character + 1;
    const message = diag.message;
    const severity = this.classifySeverity(message, diag.severity);
    const errorType = this.inferErrorType(message);

    let codeSnippet = '';
    try {
      if (fs.existsSync(filePath)) {
        const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
        const start = Math.max(0, line - 3);
        const end = Math.min(lines.length, line + 2);
        codeSnippet = lines.slice(start, end).join('\n');
      }
    } catch {
      codeSnippet = '';
    }

    const bugId = `diag_${path.basename(filePath)}_${line}_${Date.now()}`;

    return {
      id: bugId,
      file: filePath,
      line,
      column,
      errorType,
      message,
      source: 'diagnostics',
      severity,
      codeSnippet,
      timestamp: new Date().toISOString()
    };
  }

  public static classifySeverity(message: string, vsSeverity: vscode.DiagnosticSeverity): SeverityLevel {
    const lower = message.toLowerCase();
    if (
      lower.includes('segfault') ||
      lower.includes('segmentation fault') ||
      lower.includes('security') ||
      lower.includes('vulnerability') ||
      lower.includes('injection') ||
      lower.includes('crash') ||
      lower.includes('fatal')
    ) {
      return 'CRITICAL';
    }
    if (
      vsSeverity === vscode.DiagnosticSeverity.Error ||
      lower.includes('typeerror') ||
      lower.includes('nullpointer') ||
      lower.includes('cannot read property') ||
      lower.includes('undefined is not') ||
      lower.includes('syntaxerror') ||
      lower.includes('referenceerror')
    ) {
      return 'HIGH';
    }
    if (vsSeverity === vscode.DiagnosticSeverity.Warning || lower.includes('deprecated') || lower.includes('unused')) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  public static inferErrorType(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('typeerror') || lower.includes('type')) return 'TypeError';
    if (lower.includes('syntaxerror') || lower.includes('syntax')) return 'SyntaxError';
    if (lower.includes('referenceerror') || lower.includes('undefined') || lower.includes('not defined')) return 'ReferenceError';
    if (lower.includes('none') || lower.includes('null') || lower.includes('nonetype')) return 'NullOrNoneError';
    if (lower.includes('security') || lower.includes('injection') || lower.includes('credential')) return 'SecurityIssue';
    if (lower.includes('import') || lower.includes('module')) return 'ImportError';
    if (lower.includes('leak') || lower.includes('resource')) return 'ResourceLeak';
    return 'LogicalError';
  }
}
