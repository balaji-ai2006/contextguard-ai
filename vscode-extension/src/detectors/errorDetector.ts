import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DetectedBug, SeverityLevel } from '../models/types';
import { BackendClient } from '../api/backendClient';

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
   * Analyzes an active text editor document for syntactic, type, and AST anomalies.
   * Leverages backend AST analyzer if available, with robust offline heuristics.
   */
  public static async analyzeDocument(document: vscode.TextDocument, backendClient?: BackendClient): Promise<DetectedBug[]> {
    const bugs = this.scanDiagnostics(document.uri);

    // If backend client is provided and it's a Python file, run deep AST inspection
    if (backendClient && (document.languageId === 'python' || document.fileName.endsWith('.py'))) {
      try {
        const text = document.getText();
        const astBugs = await backendClient.detectAst(text, document.fileName, 'python');
        for (const astBug of astBugs) {
          // Avoid duplicate report if same line and error type
          const isDuplicate = bugs.some(b => b.line === astBug.line && b.errorType === astBug.errorType);
          if (!isDuplicate) {
            bugs.push(astBug);
          }
        }
      } catch {
        // Fall back to local diagnostics
      }
    } else {
      // Local offline regex/pattern analysis for flagships (Null/None, while True, resource leak)
      const offlineBugs = this.runOfflineStaticScan(document);
      for (const ob of offlineBugs) {
        const isDuplicate = bugs.some(b => b.line === ob.line && b.errorType === ob.errorType);
        if (!isDuplicate) {
          bugs.push(ob);
        }
      }
    }

    return bugs;
  }

  /**
   * Lightweight local offline heuristic scanner when backend is disconnected.
   */
  public static runOfflineStaticScan(document: vscode.TextDocument): DetectedBug[] {
    const results: DetectedBug[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const filePath = document.fileName;

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNo = i + 1;

      // 1. Check for infinite while loop
      const whileMatch = lineText.match(/^(\s*)while\s+(True|1):\s*$/);
      if (whileMatch) {
        const whileIndent = whileMatch[1].length;
        let hasBreak = false;
        for (let j = i + 1; j < lines.length; j++) {
          const bodyLine = lines[j];
          if (!bodyLine.trim()) continue;
          const bodyIndent = (bodyLine.match(/^(\s*)/)?.[1] || '').length;
          if (bodyIndent <= whileIndent) {
            break; // Left the while loop body
          }
          if (/\b(break|return)\b/.test(bodyLine)) {
            hasBreak = true;
            break;
          }
        }
        if (!hasBreak) {
          results.push({
            id: `offline_inf_${lineNo}`,
            file: filePath,
            line: lineNo,
            column: 1,
            errorType: 'InfiniteLoop',
            message: 'While loop condition is permanently True without break or return statement.',
            source: 'ast_parser',
            severity: 'HIGH',
            category: 'LogicalBug',
            codeSnippet: lineText.trim(),
            timestamp: new Date().toISOString()
          });
        }
      }


      // 2. Resource leak: unmanaged open()
      if (/=\s*open\s*\(/.test(lineText) && !lineText.includes('with ')) {
        results.push({
          id: `offline_leak_${lineNo}`,
          file: filePath,
          line: lineNo,
          column: 1,
          errorType: 'ResourceLeak',
          message: 'File opened with open() without context manager with statement. May cause descriptor leak.',
          source: 'ast_parser',
          severity: 'MEDIUM',
          category: 'ResourceLeak',
          codeSnippet: lineText.trim(),
          timestamp: new Date().toISOString()
        });
      }

      // 3. Security: eval() or exec()
      if (/\b(eval|exec)\s*\(/.test(lineText)) {
        results.push({
          id: `offline_sec_${lineNo}`,
          file: filePath,
          line: lineNo,
          column: 1,
          errorType: 'SecurityIssue',
          message: 'Arbitrary code execution risk with eval()/exec().',
          source: 'ast_parser',
          severity: 'CRITICAL',
          category: 'Security',
          codeSnippet: lineText.trim(),
          timestamp: new Date().toISOString()
        });
      }

      // 4. Zero division literal: / 0
      if (/\/\s*0(?![0-9.])\b/.test(lineText)) {
        results.push({
          id: `offline_zerodiv_${lineNo}`,
          file: filePath,
          line: lineNo,
          column: 1,
          errorType: 'ZeroDivisionError',
          message: 'Division by zero detected in arithmetic expression.',
          source: 'ast_parser',
          severity: 'HIGH',
          category: 'ArithmeticError',
          codeSnippet: lineText.trim(),
          timestamp: new Date().toISOString()
        });
      }
    }

    return results;
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
      lower.includes('referenceerror') ||
      lower.includes('zerodivision') ||
      lower.includes('infinite')
    ) {
      return 'HIGH';
    }
    if (
      vsSeverity === vscode.DiagnosticSeverity.Warning ||
      lower.includes('deprecated') ||
      lower.includes('unused') ||
      lower.includes('leak') ||
      lower.includes('misuse')
    ) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  /**
   * Infers exact error category across all 12 required detection classes:
   * Runtime exceptions, Compile errors, Type errors, Null/None errors,
   * Undefined variables, Dependency errors, API misuse, Logical bugs,
   * Infinite loops, Resource leaks, Performance issues, Security issues.
   */
  public static inferErrorType(message: string): string {
    const lower = message.toLowerCase();

    // 1. Explicit primary error classes
    if (lower.includes('typeerror')) return 'TypeError';
    if (lower.includes('syntaxerror')) return 'SyntaxError';
    if (lower.includes('referenceerror')) return 'ReferenceError';
    if (lower.includes('zerodivision') || lower.includes('division by zero')) return 'ZeroDivisionError';

    // 2. Specialized flaw categories
    if (lower.includes('security') || lower.includes('injection') || lower.includes('credential') || lower.includes('token') || lower.includes('cve')) {
      return 'SecurityIssue';
    }
    if (lower.includes('leak') || lower.includes('unclosed') || lower.includes('resource') || lower.includes('file descriptor')) {
      return 'ResourceLeak';
    }
    if (lower.includes('infinite') || lower.includes('infinite loop') || lower.includes('recursion') || lower.includes('maximum recursion')) {
      return 'InfiniteLoop';
    }
    if (lower.includes('none') || lower.includes('null') || lower.includes('nonetype')) {
      return 'NullOrNoneError';
    }
    if (lower.includes('not defined') || lower.includes('nameerror') || lower.includes('undefined variable')) {
      return 'UndefinedVariable';
    }
    if (lower.includes('modulenotfound') || lower.includes('importerror') || lower.includes('cannot find module') || lower.includes('dependency')) {
      return 'DependencyError';
    }
    if (lower.includes('api misuse') || lower.includes('deprecated api') || lower.includes('mutable default') || lower.includes('invalid argument')) {
      return 'APIMisuse';
    }
    if (lower.includes('performance') || lower.includes('slow') || lower.includes('timeout') || lower.includes('complexity') || lower.includes('bottleneck')) {
      return 'PerformanceIssue';
    }
    if (lower.includes('compile') || lower.includes('parse error') || lower.includes('unexpected token')) {
      return 'CompileError';
    }
    if (lower.includes('type')) {
      return 'TypeError';
    }

    return 'LogicalError';
  }

}
