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
exports.DiagnosticRunner = void 0;
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const snapshotManager_1 = require("./snapshotManager");
class DiagnosticRunner {
    /**
     * Opt-in diagnostic execution of a selected Python file.
     * Runs the file under backend.runtime.runner to trace runtime memory
     * and capture local variable states at the exception point.
     */
    static async runFileWithSnapshot(filePath, workspaceRoot) {
        return new Promise((resolve) => {
            const cwd = workspaceRoot || path.dirname(filePath);
            const pythonArgs = ['-m', 'backend.runtime.runner', filePath];
            const proc = cp.spawn('python', pythonArgs, {
                cwd,
                env: {
                    ...process.env,
                    PYTHONPATH: workspaceRoot ? `${workspaceRoot};${process.env.PYTHONPATH || ''}` : process.env.PYTHONPATH
                }
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            proc.on('close', (code) => {
                let snapshot;
                const marker = '=== CONTEXTGUARD RUNTIME SNAPSHOT ===';
                if (stdout.includes(marker)) {
                    const parts = stdout.split(marker);
                    if (parts.length >= 2) {
                        const jsonPart = parts[1].split('===')[0].trim();
                        try {
                            const parsed = JSON.parse(jsonPart);
                            snapshot = {
                                snapshotId: parsed.snapshot_id,
                                timestamp: parsed.timestamp,
                                language: parsed.language || 'python',
                                errorType: parsed.error_type,
                                errorMessage: parsed.error_message,
                                filePath: parsed.file_path,
                                lineNumber: parsed.line_number,
                                functionName: parsed.function_name,
                                variableSnapshots: parsed.variable_snapshots,
                                captureMethod: parsed.capture_method || 'diagnostic_runner',
                                captureStatus: parsed.capture_status || 'success',
                                failedExpression: parsed.failed_expression,
                                heuristicExplanation: parsed.heuristic_explanation,
                                callStack: parsed.call_stack
                            };
                            snapshotManager_1.extensionSnapshotManager.addSnapshot(snapshot);
                        }
                        catch (e) {
                            console.error('Failed to parse snapshot JSON from diagnostic runner:', e);
                        }
                    }
                }
                resolve({ snapshot, stdout, stderr, exitCode: code });
            });
            proc.on('error', (err) => {
                resolve({ stdout, stderr: err.message, exitCode: -1 });
            });
        });
    }
}
exports.DiagnosticRunner = DiagnosticRunner;
//# sourceMappingURL=diagnosticRunner.js.map