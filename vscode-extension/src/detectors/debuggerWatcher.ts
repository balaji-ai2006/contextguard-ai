import * as vscode from 'vscode';
import { DetectedBug, RuntimeSnapshot } from '../models/types';
import { ErrorDetector } from './errorDetector';
import { extensionSnapshotManager } from '../runtime/snapshotManager';

export class DebuggerWatcher {
  private onBugDetectedCallback?: (bug: DetectedBug) => void;

  constructor(onBugDetected?: (bug: DetectedBug) => void) {
    this.onBugDetectedCallback = onBugDetected;
  }

  public register(context: vscode.ExtensionContext) {
    if (!vscode.debug) {
      return;
    }

    // 1. Listen for DAP Custom events (such as stopped on exception)
    if (vscode.debug.onDidReceiveDebugSessionCustomEvent) {
      context.subscriptions.push(
        vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
          if (e.event === 'stopped' && e.body?.reason === 'exception') {
            const description = e.body.description || e.body.text || 'Unhandled exception in debug session';
            let snapshot: RuntimeSnapshot | undefined;
            if (extensionSnapshotManager.isCaptureEnabled()) {
              const file = vscode.window.activeTextEditor?.document.fileName || 'unknown';
              const line = (vscode.window.activeTextEditor?.selection.active.line || 0) + 1;
              const errorType = ErrorDetector.inferErrorType(description);

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
              extensionSnapshotManager.addSnapshot(snapshot);
            }

            const bug: DetectedBug = {
              id: `dbg_stopped_${Date.now()}`,
              file: vscode.window.activeTextEditor?.document.fileName || 'unknown',
              line: (vscode.window.activeTextEditor?.selection.active.line || 0) + 1,
              column: 1,
              errorType: ErrorDetector.inferErrorType(description),
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
        })
      );
    }

    // 2. Listen for debug session termination
    if (vscode.debug.onDidTerminateDebugSession) {
      context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession((session) => {
          console.log(`Debug session terminated: ${session.name}`);
        })
      );
    }
  }
}

