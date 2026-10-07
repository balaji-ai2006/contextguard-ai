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
exports.ErrorDetector = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ErrorDetector {
    /**
     * Scans current VS Code diagnostics across workspace or active editor.
     */
    static scanDiagnostics(targetUri) {
        const bugs = [];
        const allDiagnostics = targetUri
            ? [[targetUri, vscode.languages.getDiagnostics(targetUri)]]
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
    static async analyzeDocument(document) {
        const bugs = this.scanDiagnostics(document.uri);
        return bugs;
    }
    static diagnosticToBug(uri, diag) {
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
        }
        catch {
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
    static classifySeverity(message, vsSeverity) {
        const lower = message.toLowerCase();
        if (lower.includes('segfault') ||
            lower.includes('segmentation fault') ||
            lower.includes('security') ||
            lower.includes('vulnerability') ||
            lower.includes('injection') ||
            lower.includes('crash') ||
            lower.includes('fatal')) {
            return 'CRITICAL';
        }
        if (vsSeverity === vscode.DiagnosticSeverity.Error ||
            lower.includes('typeerror') ||
            lower.includes('nullpointer') ||
            lower.includes('cannot read property') ||
            lower.includes('undefined is not') ||
            lower.includes('syntaxerror') ||
            lower.includes('referenceerror')) {
            return 'HIGH';
        }
        if (vsSeverity === vscode.DiagnosticSeverity.Warning || lower.includes('deprecated') || lower.includes('unused')) {
            return 'MEDIUM';
        }
        return 'LOW';
    }
    static inferErrorType(message) {
        const lower = message.toLowerCase();
        if (lower.includes('typeerror') || lower.includes('type'))
            return 'TypeError';
        if (lower.includes('syntaxerror') || lower.includes('syntax'))
            return 'SyntaxError';
        if (lower.includes('referenceerror') || lower.includes('undefined') || lower.includes('not defined'))
            return 'ReferenceError';
        if (lower.includes('none') || lower.includes('null') || lower.includes('nonetype'))
            return 'NullOrNoneError';
        if (lower.includes('security') || lower.includes('injection') || lower.includes('credential'))
            return 'SecurityIssue';
        if (lower.includes('import') || lower.includes('module'))
            return 'ImportError';
        if (lower.includes('leak') || lower.includes('resource'))
            return 'ResourceLeak';
        return 'LogicalError';
    }
}
exports.ErrorDetector = ErrorDetector;
//# sourceMappingURL=errorDetector.js.map