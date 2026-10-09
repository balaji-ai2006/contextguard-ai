import * as vscode from 'vscode';
import {
  BackendStatus,
  CandidatePatch,
  DetectedBug,
  DiagnosisResult,
  GitState,
  RootCauseGraph,
  RuntimeSnapshot,
  SimilarBugRecord
} from '../models/types';

export class BackendClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    const config = vscode.workspace.getConfiguration('contextguard');
    this.baseUrl = baseUrl || config.get<string>('backendUrl', 'http://127.0.0.1:8765');
  }

  public updateBaseUrl(url: string) {
    this.baseUrl = url;
  }

  public async getHealth(): Promise<BackendStatus> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        return {
          connected: true,
          privacyMode: data.privacy_mode || 'local',
          ollamaAvailable: data.ollama_available ?? false,
          dockerAvailable: data.docker_available ?? false,
          activeModel: data.active_model || 'deepseek-coder:latest',
          version: data.version || '0.1.0'
        };
      }
    } catch {
      // Backend not running
    }
    return {
      connected: false,
      privacyMode: 'local',
      ollamaAvailable: false,
      dockerAvailable: false,
      activeModel: 'offline-rule-engine',
      version: '0.1.0'
    };
  }

  public async analyzeBug(bug: DetectedBug, workspaceRoot?: string): Promise<{
    reproductionConfirmed: boolean;
    reproductionTestCode?: string;
    rootCauseGraph?: RootCauseGraph;
    candidatePatches: CandidatePatch[];
    similarBugs: SimilarBugRecord[];
    gitState?: GitState;
    diagnosis?: DiagnosisResult;
  }> {
    const payload = {
      bug,
      workspace_root: workspaceRoot,
      privacy_mode: vscode.workspace.getConfiguration('contextguard').get<string>('privacyMode', 'local')
    };

    const resp = await fetch(`${this.baseUrl}/api/investigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    if (!resp.ok) {
      throw new Error(`Backend investigation failed with HTTP ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as any;
    return {
      reproductionConfirmed: data.reproduction_confirmed ?? false,
      reproductionTestCode: data.reproduction_test_code,
      rootCauseGraph: data.root_cause_graph,
      candidatePatches: data.candidate_patches || [],
      similarBugs: data.similar_bugs || [],
      gitState: data.git_state,
      diagnosis: data.diagnosis
    };
  }

  public async previewPatch(filePath: string, diff: string, originalHash?: string): Promise<{
    can_apply: boolean;
    conflict: boolean;
    file_path: string;
    current_hash: string;
    lines_added: number;
    lines_removed: number;
    diff_preview: string;
    message: string;
  }> {
    const resp = await fetch(`${this.baseUrl}/api/patch/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch_id: 'preview',
        file_path: filePath,
        diff,
        original_hash: originalHash
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      throw new Error(`Failed to preview patch: ${await resp.text()}`);
    }
    return (await resp.json()) as any;
  }

  public async applyPatch(patchId: string, filePath: string, diff: string, originalFileHash?: string, userApproved: boolean = true): Promise<{ success: boolean; message: string }> {
    const resp = await fetch(`${this.baseUrl}/api/patch/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch_id: patchId,
        file_path: filePath,
        diff,
        original_file_hash: originalFileHash,
        user_approved: userApproved
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      throw new Error(`Failed to apply patch: ${await resp.text()}`);
    }
    return (await resp.json()) as any;
  }

  public async rejectPatch(patchId: string, reason: string = 'User rejected proposed patch'): Promise<{ success: boolean; message: string }> {
    const resp = await fetch(`${this.baseUrl}/api/patch/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch_id: patchId,
        reason
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      throw new Error(`Failed to reject patch: ${await resp.text()}`);
    }
    return (await resp.json()) as any;
  }

  public async verifyPatch(candidatePatch: CandidatePatch, bug: DetectedBug, reproductionTestCode?: string, workspaceRoot?: string): Promise<{
    patch_id: string;
    verification_status: string;
    failure_reproduced: boolean;
    fix_resolved: boolean;
    pre_fix: { exit_code: number; success: boolean; output: string };
    post_fix: { exit_code: number; success: boolean; output: string };
    execution_environment: string;
    is_docker: boolean;
    summary: string;
  }> {
    const resp = await fetch(`${this.baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_patch: candidatePatch,
        bug,
        reproduction_test_code: reproductionTestCode,
        workspace_root: workspaceRoot
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!resp.ok) {
      throw new Error(`Failed to verify patch: ${await resp.text()}`);
    }
    return (await resp.json()) as any;
  }

  public async rollbackPatch(patchId?: string): Promise<{ success: boolean; message: string }> {
    const resp = await fetch(`${this.baseUrl}/api/patch/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch_id: patchId }),
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      throw new Error(`Failed to rollback patch: ${await resp.text()}`);
    }
    return (await resp.json()) as any;
  }

  public async submitFeedback(patchId: string, feedback: string, comments?: string): Promise<{ success: boolean; message: string }> {
    const resp = await fetch(`${this.baseUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch_id: patchId,
        feedback,
        comments
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      throw new Error(`Failed to submit feedback: ${await resp.text()}`);
    }
    return (await resp.json()) as any;
  }

  public async detectAst(sourceCode: string, filePath: string, language: string = 'python'): Promise<DetectedBug[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/detect/ast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_code: sourceCode,
          file_path: filePath,
          language
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const data = (await resp.json()) as { count: number; bugs: DetectedBug[] };
        return data.bugs || [];
      }
    } catch {
      // Backend unreachable or timed out
    }
    return [];
  }

  public async detectTraceback(text: string, language?: string): Promise<DetectedBug | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/detect/traceback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          language
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const data = (await resp.json()) as { count: number; bugs: DetectedBug[] };
        if (data.bugs && data.bugs.length > 0) {
          return data.bugs[0];
        }
      }
    } catch {
      // Backend unreachable or timed out
    }
    return null;
  }

  public async sendSnapshot(snapshot: RuntimeSnapshot, optIn: boolean = false): Promise<RuntimeSnapshot | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/snapshots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ContextGuard-OptIn': optIn ? 'true' : 'false'
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        return (await resp.json()) as RuntimeSnapshot;
      }
    } catch {
      // Backend not running or rejected
    }
    return null;
  }

  public async getSnapshots(limit: number = 50): Promise<RuntimeSnapshot[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/snapshots?limit=${limit}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) {
        return (await resp.json()) as RuntimeSnapshot[];
      }
    } catch {
      // Backend offline
    }
    return [];
  }

  public async clearBackendSnapshots(): Promise<{ cleared: number; message: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/snapshots`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) {
        return (await resp.json()) as { cleared: number; message: string };
      }
    } catch {
      // Backend offline
    }
    return { cleared: 0, message: 'Backend unavailable' };
  }
}

