import * as vscode from 'vscode';
import {
  BackendStatus,
  CandidatePatch,
  DetectedBug,
  GitState,
  RootCauseGraph,
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
      gitState: data.git_state
    };
  }

  public async applyPatch(patchId: string, filePath: string, diff: string): Promise<{ success: boolean; message: string }> {
    const resp = await fetch(`${this.baseUrl}/api/patch/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch_id: patchId,
        file_path: filePath,
        diff
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      throw new Error(`Failed to apply patch: ${await resp.text()}`);
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
}
