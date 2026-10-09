# ContextGuard AI Developer

**Privacy-First, Context-Aware AI Bug Diagnostic & Verified Code-Fix Recommender for VS Code**

---

## 1. Overview

**ContextGuard AI Developer** is an intelligent pair-debugging system built as a VS Code extension and local Python backend. Unlike generic AI coding assistants that generate ungrounded code suggestions, ContextGuard AI:
- Captures failure-point **runtime variable snapshots** directly from exception frames.
- Synthesizes multi-modal context: stack traces, localized source lines, Git branch status/diffs, and sanitized runtime memory.
- Strictly separates **Confirmed Runtime Facts** from **AI Hypotheses**.
- Locally redacts all API keys, access tokens, passwords, and secrets **before** any diagnostic prompt is created.
- Operates in a **strict local-only environment** (defaulting to local Ollama on `127.0.0.1`), never transmitting code to external providers without explicit user authorization.
- Enforces an isolated **sandbox test verification pipeline** (Docker with non-root, restricted subprocess fallback) to verify proposed fixes without touching live project files.
- Protects user workspaces with concurrency drift detection (SHA256 tracking) and reliable one-click rollback checkpoints.

---

## 2. Architecture

```mermaid
flowchart TD
    subgraph VSCodeExt ["VS Code Extension Client (TypeScript)"]
        A[Terminal Traceback Watcher] --> D[Error Detection Engine]
        B[Debugger Frame Watcher] --> D
        C[Static AST Scanner] --> D
        D --> E[Extension Snapshot Manager]
        E --> F[Sidebar UI Provider]
        F --> G[Backend Client]
    end

    subgraph PythonBackend ["Python Backend Service (FastAPI)"]
        G --> H[FastAPI Gateway :8765]
        H --> I[Investigation Orchestrator]
        I --> J[Runtime Snapshot Collector]
        I --> K[Git Intelligence Engine]
        I --> L[ContextGuard Diagnostician Agent]
        I --> M[Fix Generator Agent]
        I --> N[Code Reviewer Agent]
        I --> O[Security Audit Agent]
    end

    subgraph PrivacyAndVerification ["Privacy Boundary & Verification"]
        P[RedactionEngine AST & Regex]
        Q[Deterministic Symbolic Engine Fallback]
        R[Local Ollama LLM :11434]
        S[Sandbox Runner: Docker / Restricted Subprocess]
    end

    L --> P
    M --> P
    P --> R
    R -.->|Offline Fallback| Q
    P --> Q
    I --> S
```

---

## 3. Core Features (Phases 1–8)

1. **Phase 1: Foundation & Classification**: Terminal output parsers for Python and Node.js tracebacks, severity heuristics (CRITICAL, HIGH, MEDIUM, LOW), command dispatch.
2. **Phase 2: Resilient Backend Communication**: Asynchronous API client with offline rule-engine fallback, health status monitoring, and structured JSON contracts.
3. **Phase 3: 12-Class Error Taxonomy & Static Heuristics**: AST pattern matching for null pointer dereferences, infinite loops, resource leaks, zero division, mutable default arguments, security vulnerabilities, and test framework runners (Pytest, Jest).
4. **Phase 4: Runtime Memory Snapshot Engine**: Non-intrusive tracer capturing innermost failing frames (`sys.settrace`), primitive variable previews, collection truncations, secret-keyword redaction, FIFO memory cache, and disabled-by-default opt-in telemetry.
5. **Phase 5: Context-Aware Diagnosis & AI Fix Recommendations**:
   - Fact vs. hypothesis labeling (`is_factually_confirmed: True` vs `is_verified_fact: False`).
   - Pre-prompt local secret redaction.
   - Minimal targeted patch proposals with structured explanations (what happened, proposed fix, why it works, potential side effects).
   - Validation against malformed diffs and path traversal attacks.
6. **Phase 6: Safe Patch Management & Isolated Verification**:
   - Non-destructive unified diff preview.
   - Concurrency drift detection (`SHA256` file tracking).
   - Explicit user approval modal before disk modification.
   - Checkpoint backup (`.bak`) and one-click rollback.
   - Isolated verification pipeline (`TESTS_PASSED`, `PARTIALLY_VERIFIED`, `FAILED`, `NOT_VERIFIED`).
   - Ephemeral Docker container execution (`--network none`, non-root user, resource limits) with restricted subprocess fallback.
7. **Phase 7: Git Intelligence & Multi-Language Readiness**:
   - Safe read-only Git operations (recent commits, merge conflict alerts).
   - Subprocess safety without shell interpolation (`shell=False`).
   - Extended error parsing for Java (`NullPointerException`) and C++ (GCC/Clang compiler errors and AddressSanitizer).
8. **Phase 8: Professional UI & Full End-to-End Integration**:
   - Sidebar with error summaries, confirmed facts, variable inspection, patch diff previews, and verified test execution.

---

## 4. Installation & Setup Guide

### Prerequisites
- Python 3.10+ (Recommended: Python 3.11 or 3.13)
- Node.js 18+ and npm
- VS Code 1.85+
- (Optional) Docker Desktop for sandboxed test verification
- (Optional) Ollama with `deepseek-coder:latest` or `codellama`

### 1. Python Backend Setup
```powershell
# In project root:
cd "c:\Users\Admin\Desktop\main project file\contextguard-ai"

# Install backend dependencies:
pip install -r requirements.txt

# Start local backend service:
python -m backend.main
```
The backend initializes locally at `http://127.0.0.1:8765`. Verify status via `http://127.0.0.1:8765/health`.

### 2. VS Code Extension Setup
```powershell
cd vscode-extension

# Install dependencies:
npm install

# Compile TypeScript:
npm run compile

# Run test suite:
npm test
```

To run the extension in VS Code:
1. Open the repository in VS Code.
2. Press `F5` to open the Extension Development Host.
3. Open the **ContextGuard AI** view in the Activity Bar.

---

## 5. Local LLM / Ollama Configuration

ContextGuard AI runs 100% offline by default using its deterministic symbolic reasoning engine. To enable local generative LLM suggestions:

1. Install [Ollama](https://ollama.ai).
2. Pull the coding model:
   ```powershell
   ollama pull deepseek-coder:latest
   ```
3. Start Ollama:
   ```powershell
   ollama serve
   ```
4. ContextGuard AI connects to Ollama on `http://127.0.0.1:11434`. Environment variables:
   - `CONTEXTGUARD_OLLAMA_HOST`: Defaults to `http://127.0.0.1:11434`.
   - `CONTEXTGUARD_OLLAMA_MODEL`: Defaults to `deepseek-coder:latest`.
   - `CONTEXTGUARD_ALLOW_EXTERNAL`: Set to `true` only if explicitly routing through an authorized external proxy. (Default: `false` / strictly blocked).

---

## 6. Security and Privacy Architecture

- **Zero External Leakage by Default**: Network requests to external domains are blocked at the agent layer.
- **Pre-Prompt Secret Redaction**: All strings entering LLM prompts are scrubbed by `RedactionEngine` for:
  - OpenAI / Anthropic / HuggingFace API keys (`sk-...`, `sk-ant-...`, `hf_...`)
  - AWS Access Keys and Secrets (`AKIA...`)
  - GitHub Personal Access Tokens (`ghp_...`, `gho_...`)
  - JSON Web Tokens (`eyJ...`)
  - RSA / OpenSSH Private Keys (`-----BEGIN PRIVATE KEY-----`)
  - Database connection strings (`postgresql://`, `mongodb://`, etc.)
  - Passwords and auth credentials
- **Defensive Subprocess Execution**: Subprocesses are spawned using list arguments without shell interpretation (`shell=False`), preventing shell injection.
- **Path Traversal Protection**: Model-generated patches targeting paths outside the current workspace are rejected.
- **Explicit User Approval**: The extension prompts the user via a confirmation dialog before modifying any source file.

---

## 7. Isolated Docker Sandbox & Limitations

### Docker Isolation (When Available)
- Disposable containers (`--rm`)
- Disabled network stack (`--network none`)
- Non-root user execution (`-u 1000:1000`)
- Resource throttling: CPU limit `1.0`, memory limit `512MB`, timeout `8s`
- Mounts only temporary scratch directories; never mounts `~/.ssh`, `~/.aws`, or the Docker socket.

### Restricted Subprocess Fallback (When Docker is Offline)
- Executes in an isolated temporary directory with read-only source copies.
- Sanitizes environment variables to prevent leaking credentials.
- Strictly labeled as `restricted_subprocess_fallback` in all UI and API responses (never mislabeled as Docker).

---

## 8. Automated Testing & Verification

Run all test suites locally:

### Python Unit & Integration Tests (63 tests)
```powershell
python -m pytest -v
```

### VS Code Extension Tests (23 tests)
```powershell
cd vscode-extension
npm run compile
npm test
```

---

## 9. Reproducible Demo Scenario

### Reproducing an `AttributeError` Bug

1. Create a sample file `demo_cart.py`:
   ```python
   def calculate_total(items):
       return sum(item["price"] for item in items)

   if __name__ == "__main__":
       # Simulating failure:
       items = None
       print(calculate_total(items))
   ```
2. Run the script in the terminal:
   ```powershell
   python demo_cart.py
   ```
3. ContextGuard AI detects the terminal exception:
   - **Error Type**: `TypeError: 'NoneType' object is not iterable`
   - **Severity**: `HIGH`
   - **Confirmed Facts**: Variable `items` was `None` at failure line 2.
   - **Hypothesis**: Missing defensive null-guard before loop comprehension.
4. Click **Investigate & Recommend Fixes**:
   - Generates 3 candidate patches:
     - *Candidate 1*: Defensive Guard Clause (`if not items: return 0`).
     - *Candidate 2*: Parameter Normalization (`items = items or []`).
     - *Candidate 3*: Explicit Validation (`raise ValueError(...)`).
5. Click **Verify Fix**:
   - Runs isolated reproduction test: pre-fix fails, post-fix succeeds.
   - Status updates to `TESTS_PASSED`.
6. Click **Preview Diff**:
   - Displays side-by-side unified diff.
7. Click **Apply Patch**:
   - Prompts for explicit user approval.
   - Creates rollback checkpoint `.contextguard_checkpoints/`.
   - Modifies `demo_cart.py` safely.
8. Click **Rollback**:
   - Instantly restores original file content from checkpoint.
