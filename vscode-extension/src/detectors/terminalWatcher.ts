import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DetectedBug } from '../models/types';
import { ErrorDetector } from './errorDetector';

export class TerminalWatcher {
  private buffer: string = '';
  private onBugDetectedCallback?: (bug: DetectedBug) => void;

  constructor(onBugDetected?: (bug: DetectedBug) => void) {
    this.onBugDetectedCallback = onBugDetected;
  }

  public feedData(data: string): DetectedBug | null {
    this.buffer += data;
    if (this.buffer.length > 50000) {
      this.buffer = this.buffer.slice(-30000);
    }
    return this.parseTracebacks(data);
  }

  /**
   * Parses standard Python, Node.js, Java, and C++ tracebacks from terminal text chunk.
   */
  public parseTracebacks(text: string): DetectedBug | null {
    // 1. Python Traceback:
    // Traceback (most recent call last):
    //   File "test.py", line 5, in <module>
    // TypeError: 'NoneType' object is not iterable
    const pythonRegex = /Traceback \(most recent call last\):[\s\S]*?File "([^"]+)", line (\d+)(?:, in ([^\r\n]+))?[\r\n]+([\s\S]*?)([A-Za-z]+Error|Exception|AssertionError):[ ]*([^\r\n]+)/;
    const pyMatch = text.match(pythonRegex);
    if (pyMatch) {
      const filePath = pyMatch[1];
      const line = parseInt(pyMatch[2], 10);
      const errorClass = pyMatch[5];
      const errorMsg = pyMatch[6].trim();
      const fullMessage = `${errorClass}: ${errorMsg}`;

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

      const bug: DetectedBug = {
        id: `term_py_${path.basename(filePath)}_${line}_${Date.now()}`,
        file: path.resolve(filePath),
        line,
        column: 1,
        errorType: errorClass,
        message: fullMessage,
        source: 'terminal',
        severity: ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
        codeSnippet,
        stackTrace: pyMatch[0],
        timestamp: new Date().toISOString()
      };

      if (this.onBugDetectedCallback) {
        this.onBugDetectedCallback(bug);
      }
      return bug;
    }

    // 2. Node.js / JavaScript / TypeScript stack trace:
    // ReferenceError: foo is not defined
    //     at Object.<anonymous> (/path/to/file.js:12:5)
    const nodeRegex = /([A-Za-z]+Error):[ ]*([^\r\n]+)[\r\n]+\s+at\s+(?:.*?\s+\()?([^()\r\n]+):(\d+):(\d+)\)?/;
    const nodeMatch = text.match(nodeRegex);
    if (nodeMatch) {
      const errorClass = nodeMatch[1];
      const errorMsg = nodeMatch[2].trim();
      const filePath = nodeMatch[3].trim();
      const line = parseInt(nodeMatch[4], 10);
      const column = parseInt(nodeMatch[5], 10);
      const fullMessage = `${errorClass}: ${errorMsg}`;

      const bug: DetectedBug = {
        id: `term_node_${path.basename(filePath)}_${line}_${Date.now()}`,
        file: path.resolve(filePath),
        line,
        column,
        errorType: errorClass,
        message: fullMessage,
        source: 'terminal',
        severity: ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
        stackTrace: nodeMatch[0],
        timestamp: new Date().toISOString()
      };

      if (this.onBugDetectedCallback) {
        this.onBugDetectedCallback(bug);
      }
      return bug;
    }

    return null;
  }
}
