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
exports.BackendClient = void 0;
const vscode = __importStar(require("vscode"));
class BackendClient {
    baseUrl;
    constructor(baseUrl) {
        const config = vscode.workspace.getConfiguration('contextguard');
        this.baseUrl = baseUrl || config.get('backendUrl', 'http://127.0.0.1:8765');
    }
    updateBaseUrl(url) {
        this.baseUrl = url;
    }
    async getHealth() {
        try {
            const resp = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(3000)
            });
            if (resp.ok) {
                const data = (await resp.json());
                return {
                    connected: true,
                    privacyMode: data.privacy_mode || 'local',
                    ollamaAvailable: data.ollama_available ?? false,
                    dockerAvailable: data.docker_available ?? false,
                    activeModel: data.active_model || 'deepseek-coder:latest',
                    version: data.version || '0.1.0'
                };
            }
        }
        catch {
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
    async analyzeBug(bug, workspaceRoot) {
        const payload = {
            bug,
            workspace_root: workspaceRoot,
            privacy_mode: vscode.workspace.getConfiguration('contextguard').get('privacyMode', 'local')
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
        const data = (await resp.json());
        return {
            reproductionConfirmed: data.reproduction_confirmed ?? false,
            reproductionTestCode: data.reproduction_test_code,
            rootCauseGraph: data.root_cause_graph,
            candidatePatches: data.candidate_patches || [],
            similarBugs: data.similar_bugs || [],
            gitState: data.git_state
        };
    }
    async applyPatch(patchId, filePath, diff) {
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
        return (await resp.json());
    }
    async rollbackPatch(patchId) {
        const resp = await fetch(`${this.baseUrl}/api/patch/rollback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch_id: patchId }),
            signal: AbortSignal.timeout(10000)
        });
        if (!resp.ok) {
            throw new Error(`Failed to rollback patch: ${await resp.text()}`);
        }
        return (await resp.json());
    }
    async submitFeedback(patchId, feedback, comments) {
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
        return (await resp.json());
    }
}
exports.BackendClient = BackendClient;
//# sourceMappingURL=backendClient.js.map