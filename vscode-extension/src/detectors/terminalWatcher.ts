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
    const bug = this.parseTracebacks(data) || this.parseTracebacks(this.buffer.slice(-3000));
    if (bug) {
      this.buffer = '';
    }
    return bug;
  }


  /**
   * Parses Python tracebacks, pytest failures, Node.js traces, and Jest test outputs.
   */
  public parseTracebacks(text: string): DetectedBug | null {
    // 1. Pytest Failure:
    // FAILED tests/test_cart.py::test_calc - TypeError: 'NoneType' object is not iterable
    const pytestRegex = /FAILED\s+([^\s:]+)(?:::([^\s]+))?\s+-\s+([A-Za-z0-9_]+Error|Exception|AssertionError):\s*([^\r\n]+)/;
    const pyTestMatch = text.match(pytestRegex);
    if (pyTestMatch) {
      const testFile = pyTestMatch[1];
      const testFunc = pyTestMatch[2] || 'test';
      const errorClass = pyTestMatch[3];
      const errorMsg = pyTestMatch[4].trim();
      const fullMessage = `Pytest Failure in ${testFunc}: ${errorClass}: ${errorMsg}`;

      let line = 1;
      const lineMatch = text.match(/File\s+["']?([^"'\n]+)["']?,\s+line\s+(\d+)/);
      if (lineMatch) {
        line = parseInt(lineMatch[2], 10);
      }

      const bug: DetectedBug = {
        id: `test_pytest_${path.basename(testFile)}_${line}_${Date.now()}`,
        file: path.resolve(testFile),
        line,
        column: 1,
        errorType: errorClass,
        message: fullMessage,
        source: 'test_framework',
        severity: ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
        stackTrace: pyTestMatch[0],
        timestamp: new Date().toISOString()
      };

      if (this.onBugDetectedCallback) {
        this.onBugDetectedCallback(bug);
      }
      return bug;
    }

    // 2. Python Traceback:
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

    // 3. Jest / Vitest test failure:
    // FAIL src/cart.test.ts
    //   ● Cart suite › calculateTotal
    //     TypeError: ...
    const jestRegex = /FAIL\s+([^\r\n]+)[\s\S]*?●\s+([^\r\n]+)[\s\S]*?([A-Za-z]+Error):\s*([^\r\n]+)/;
    const jestMatch = text.match(jestRegex);
    if (jestMatch) {
      const testFile = jestMatch[1].trim();
      const testSuite = jestMatch[2].trim();
      const errorClass = jestMatch[3];
      const errorMsg = jestMatch[4].trim();
      const fullMessage = `Jest Failure in '${testSuite}': ${errorClass}: ${errorMsg}`;

      let line = 1;
      let col = 1;
      const atMatch = text.match(/at\s+(?:.*?\s+\()?([^()\r\n]+):(\d+):(\d+)\)?/);
      if (atMatch) {
        line = parseInt(atMatch[2], 10);
        col = parseInt(atMatch[3], 10);
      }

      const bug: DetectedBug = {
        id: `test_jest_${path.basename(testFile)}_${line}_${Date.now()}`,
        file: path.resolve(testFile),
        line,
        column: col,
        errorType: errorClass,
        message: fullMessage,
        source: 'test_framework',
        severity: ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
        stackTrace: jestMatch[0],
        timestamp: new Date().toISOString()
      };

      if (this.onBugDetectedCallback) {
        this.onBugDetectedCallback(bug);
      }
      return bug;
    }

    // 4. Node.js / JavaScript / TypeScript stack trace:
    // TypeError: Cannot read properties of undefined
    //     at calculateTotal (C:/projects/app/cart.js:15:24)
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

    // 5. Java Exception stack trace:
    // Exception in thread "main" java.lang.NullPointerException: ...
    //     at com.example.CartService.calculateTotal(CartService.java:42)
    const javaRegex = /(?:Exception in thread "[^"]+"\s+)?([a-zA-Z0-9_.]+(?:Exception|Error))(?::\s*([^\r\n]+))?[\r\n]+\s+at\s+([a-zA-Z0-9_$.]+)\(([^:)]+):(\d+)\)/;
    const javaMatch = text.match(javaRegex);
    if (javaMatch) {
      const fullErrorClass = javaMatch[1];
      const errorClass = fullErrorClass.split('.').pop() || fullErrorClass;
      const errorMsg = (javaMatch[2] || '').trim();
      const method = javaMatch[3];
      const fileName = javaMatch[4];
      const line = parseInt(javaMatch[5], 10);
      const fullMessage = errorMsg ? `${errorClass}: ${errorMsg}` : errorClass;

      const bug: DetectedBug = {
        id: `term_java_${fileName}_${line}_${Date.now()}`,
        file: fileName,
        line,
        column: 1,
        errorType: errorClass,
        message: fullMessage,
        source: 'terminal',
        severity: ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
        stackTrace: javaMatch[0],
        timestamp: new Date().toISOString()
      };

      if (this.onBugDetectedCallback) {
        this.onBugDetectedCallback(bug);
      }
      return bug;
    }

    // 6. C++ compiler error:
    // src/main.cpp:14:5: error: 'x' was not declared in this scope
    const cppRegex = /([a-zA-Z0-9_./\\-]+\.(?:cpp|cc|cxx|c|hpp|h)):(\d+):(\d+):\s+(error|fatal error|warning):\s*([^\r\n]+)/;
    const cppMatch = text.match(cppRegex);
    if (cppMatch) {
      const filePath = cppMatch[1];
      const line = parseInt(cppMatch[2], 10);
      const column = parseInt(cppMatch[3], 10);
      const level = cppMatch[4];
      const errorMsg = cppMatch[5].trim();
      const fullMessage = `C++ ${level.toUpperCase()}: ${errorMsg}`;

      const bug: DetectedBug = {
        id: `term_cpp_${path.basename(filePath)}_${line}_${Date.now()}`,
        file: filePath,
        line,
        column,
        errorType: level.includes('error') ? 'CompileError' : 'Warning',
        message: fullMessage,
        source: 'terminal',
        severity: level.includes('fatal') ? 'CRITICAL' : 'HIGH',
        stackTrace: cppMatch[0],
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
