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
exports.DebuggerWatcher = void 0;
const vscode = __importStar(require("vscode"));
const errorDetector_1 = require("./errorDetector");
const snapshotManager_1 = require("../runtime/snapshotManager");
class DebuggerWatcher {
    onBugDetectedCallback;
    constructor(onBugDetected) {
        this.onBugDetectedCallback = onBugDetected;
    }
    register(context) {
        if (!vscode.debug) {
            return;
        }
        // 1. Listen for DAP Custom events (such as stopped on exception)
        if (vscode.debug.onDidReceiveDebugSessionCustomEvent) {
            context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
                if (e.event === 'stopped' && e.body?.reason === 'exception') {
                    const description = e.body.description || e.body.text || 'Unhandled exception in debug session';
                    let snapshot;
                    if (snapshotManager_1.extensionSnapshotManager.isCaptureEnabled()) {
                        const file = vscode.window.activeTextEditor?.document.fileName || 'unknown';
                        const line = (vscode.window.activeTextEditor?.selection.active.line || 0) + 1;
                        const errorType = errorDetector_1.ErrorDetector.inferErrorType(description);
                        snapshot = {
                            snapshotId: `dbg_snap_${Date.now()}`,
                            timestamp: new Date().toISOString(),
                            language: 'python',
                            errorType,
                            errorMessage: description,
                            filePath: file,
                            lineNumber: line,
                            functionName: 'debug_exception_frame',
                            captureMethod: 'dap_debugger',
                            captureStatus: 'success',
                            variableSnapshots: {},
                            callStack: [{ function: 'exception_frame', file, line }]
                        };
                        snapshotManager_1.extensionSnapshotManager.addSnapshot(snapshot);
                    }
                    const bug = {
                        id: `dbg_stopped_${Date.now()}`,
                        file: vscode.window.activeTextEditor?.document.fileName || 'unknown',
                        line: (vscode.window.activeTextEditor?.selection.active.line || 0) + 1,
                        column: 1,
                        errorType: errorDetector_1.ErrorDetector.inferErrorType(description),
                        message: `Debugger paused on exception: ${description}`,
                        source: 'debugger',
                        severity: 'HIGH',
                        timestamp: new Date().toISOString(),
                        runtimeSnapshot: snapshot
                    };
                    if (this.onBugDetectedCallback) {
                        this.onBugDetectedCallback(bug);
                    }
                }
            }));
        }
        // 2. Listen for debug session termination
        if (vscode.debug.onDidTerminateDebugSession) {
            context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
                console.log(`Debug session terminated: ${session.name}`);
            }));
        }
    }
}
exports.DebuggerWatcher = DebuggerWatcher;
//# sourceMappingURL=debuggerWatcher.js.map