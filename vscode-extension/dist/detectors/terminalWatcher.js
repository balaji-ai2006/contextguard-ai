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
exports.TerminalWatcher = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const errorDetector_1 = require("./errorDetector");
class TerminalWatcher {
    buffer = '';
    onBugDetectedCallback;
    constructor(onBugDetected) {
        this.onBugDetectedCallback = onBugDetected;
    }
    feedData(data) {
        this.buffer += data;
        if (this.buffer.length > 50000) {
            this.buffer = this.buffer.slice(-30000);
        }
        return this.parseTracebacks(data);
    }
    /**
     * Parses standard Python, Node.js, Java, and C++ tracebacks from terminal text chunk.
     */
    parseTracebacks(text) {
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
            }
            catch {
                codeSnippet = '';
            }
            const bug = {
                id: `term_py_${path.basename(filePath)}_${line}_${Date.now()}`,
                file: path.resolve(filePath),
                line,
                column: 1,
                errorType: errorClass,
                message: fullMessage,
                source: 'terminal',
                severity: errorDetector_1.ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
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
            const bug = {
                id: `term_node_${path.basename(filePath)}_${line}_${Date.now()}`,
                file: path.resolve(filePath),
                line,
                column,
                errorType: errorClass,
                message: fullMessage,
                source: 'terminal',
                severity: errorDetector_1.ErrorDetector.classifySeverity(fullMessage, vscode.DiagnosticSeverity.Error),
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
exports.TerminalWatcher = TerminalWatcher;
//# sourceMappingURL=terminalWatcher.js.map