# ContextGuard AI Developer for Visual Studio Code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://marketplace.visualstudio.com/items?itemName=contextguard-ai.contextguard-ai)
[![Security: Privacy--First](https://img.shields.io/badge/Privacy-Local%20First-success.svg)](https://github.com/balaji-ai2006/contextguard-ai)

**Privacy-First, Context-Aware AI Bug Diagnostic & Verified Code-Fix Recommender**

ContextGuard AI Developer transforms debugging in VS Code by capturing failing-point runtime context, strictly distinguishing **confirmed runtime facts** from **AI hypotheses**, redacting secrets before prompt construction, and testing candidate fixes in an isolated sandbox before applying them to your workspace.

---

## Key Features

- **🔍 Intelligent Traceback & AST Parsing**: Detects errors across Python, Node.js/TypeScript, Java, and C++ (including GCC/Clang and AddressSanitizer).
- **🧠 Confirmed Facts vs. AI Hypotheses**: Replaces hallucinated diagnostics with a clear split between observed facts (exact failing line, variables, return codes) and AI hypotheses (root cause explanations with confidence ratings).
- **🛡️ Pre-Prompt Secret Redaction**: Automatically scrubs API keys, JWTs, OAuth tokens, AWS credentials, and passwords with high-entropy regex patterns and keyword detectors before prompt synthesis.
- **🔒 Local-First by Default**: Runs 100% locally with local Ollama (`127.0.0.1:11434`) or offline deterministic symbolic heuristics. Never transmits your code to external APIs without explicit opt-in.
- **⚡ Non-Intrusive Runtime Memory Snapshots**: Opt-in capture of innermost exception stack frame variables, with collection truncation and sensitive value masking. Disabled by default.
- **🧪 Isolated Sandbox Verification**: Runs candidate patches in an ephemeral Docker container (`--network none`, non-root user, CPU/memory bounded) or restricted subprocess fallback before modifying source files.
- **↩️ Safe Checkpoints & Rollback**: Automatic SHA256 concurrency drift detection and backup checkpoints (`.contextguard_checkpoints/`) enable instant one-click rollback.
- **✋ Explicit User Approval**: Untrusted model-generated code is never applied automatically without explicit confirmation via a native modal dialog.

---

## Quick Start Guide

### 1. Prerequisites
- **VS Code**: Version `1.85.0` or higher.
- **Python**: Version `3.10+` (for the local diagnostic backend).
- **(Optional) Docker Desktop**: For containerized patch verification.
- **(Optional) Ollama**: For local generative AI capabilities (`ollama pull deepseek-coder:latest`).

### 2. Start the Local Backend Engine
ContextGuard AI includes a Python backend service that powers multi-agent diagnosis and sandbox verification:
```powershell
# From the ContextGuard AI repository:
pip install -r requirements.txt
python -m backend.main
```
The backend starts at `http://127.0.0.1:8765`. Check status anytime with the command:
`ContextGuard: Check Backend Status`.

### 3. Using the Extension
1. Open any project workspace in VS Code.
2. Click the **ContextGuard AI** shield icon in the Activity Bar.
3. When a traceback or exception occurs in the terminal or debugger:
   - ContextGuard automatically highlights the issue in the status bar (`$(shield) ContextGuard: 1 Issue Detected`).
   - Click the notification to open the **ContextGuard Engine** sidebar.
4. Review the **Observed Facts** and **AI Hypotheses**.
5. Inspect the candidate patch with the expandable **Unified Diff Preview**.
6. Click **`🛡️ Verify`** to test the patch in an isolated sandbox.
7. Click **`Apply Fix`** to review and confirm application to your workspace.
8. If needed, click **`↩️ Rollback to Safe Checkpoint`** to instantly restore your original code.

---

## Extension Settings

ContextGuard AI provides granular configuration through `Settings > Extensions > ContextGuard AI`:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `contextguard.backendUrl` | `http://127.0.0.1:8765` | URL of the local ContextGuard Python backend engine. |
| `contextguard.privacyMode` | `local` | Privacy mode: `local` (100% offline), `hybrid`, or `cloud`. |
| `contextguard.ollamaModel` | `deepseek-coder:latest` | Local Ollama model identifier for diagnosis. |
| `contextguard.autoScanOnSave` | `true` | Automatically run static AST scans on file save. |
| `contextguard.sandboxEngine` | `auto` | Sandbox isolation mode: `auto`, `docker`, or `venv_process`. |
| `contextguard.runtimeSnapshots.enabled` | `false` | Enable runtime snapshot capture at exception points. |
| `contextguard.runtimeSnapshots.backendTransmission` | `false` | Opt-in to transmit sanitized snapshots to the local backend. |
| `contextguard.runtimeSnapshots.maxHistorySize` | `50` | Maximum number of in-memory snapshots retained. |

---

## Security & Privacy Policy

- **No Secret Telemetry**: ContextGuard AI does not collect usage analytics or private telemetry.
- **Local Isolation**: All communication between the extension and backend happens over local loopback (`127.0.0.1`).
- **Gated External Transmission**: External LLM forwarding is blocked unless `CONTEXTGUARD_ALLOW_EXTERNAL=true` is explicitly set in backend environment variables.
- **Sandbox Bounds**: Subprocess fallbacks run with bounded execution timeouts (10 seconds) and stripped environment variables when Docker is unavailable.

---

## Troubleshooting & FAQ

**Q: The status bar says "ContextGuard: Offline".**  
A: Ensure the Python backend is running on `http://127.0.0.1:8765`. Run `python -m backend.main` in your terminal or use command `ContextGuard: Start Local Backend Engine`.

**Q: How do I verify a fix in Docker?**  
A: Start Docker Desktop. ContextGuard detects the Docker daemon and automatically runs verification in a disposable `python:3.11-slim` container with `--network none`.

**Q: Are my source files safe from unverified changes?**  
A: Yes. Every patch application creates a rollback checkpoint and requires explicit confirmation in a modal prompt. Unverified patches can be rejected with one click.

---

## License & Repository

- **License**: MIT License ([LICENSE](https://github.com/balaji-ai2006/contextguard-ai/blob/main/LICENSE))
- **Source Code**: [https://github.com/balaji-ai2006/contextguard-ai](https://github.com/balaji-ai2006/contextguard-ai)
- **Issue Tracker**: [https://github.com/balaji-ai2006/contextguard-ai/issues](https://github.com/balaji-ai2006/contextguard-ai/issues)
