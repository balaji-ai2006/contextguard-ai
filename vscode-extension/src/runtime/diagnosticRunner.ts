import * as cp from 'child_process';
import * as path from 'path';
import { RuntimeSnapshot } from '../models/types';
import { extensionSnapshotManager } from './snapshotManager';

export class DiagnosticRunner {
  /**
   * Opt-in diagnostic execution of a selected Python file.
   * Runs the file under backend.runtime.runner to trace runtime memory
   * and capture local variable states at the exception point.
   */
  public static async runFileWithSnapshot(
    filePath: string,
    workspaceRoot?: string
  ): Promise<{ snapshot?: RuntimeSnapshot; stdout: string; stderr: string; exitCode: number | null }> {
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
        let snapshot: RuntimeSnapshot | undefined;

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

              extensionSnapshotManager.addSnapshot(snapshot);
            } catch (e) {
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
