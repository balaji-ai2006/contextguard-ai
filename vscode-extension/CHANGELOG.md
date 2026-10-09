# Change Log — ContextGuard AI Developer

All notable changes to the "contextguard-ai" extension will be documented in this file.

## [0.1.0] - 2026-10-09

### Added
- **Core Error Detection**: Terminal traceback watchers for Python, Node.js, Pytest, and Jest.
- **12-Class Error Taxonomy**: AST-based static pattern matching for null pointer dereferences, resource leaks, infinite loops, zero division, mutable defaults, and security vulnerabilities.
- **Runtime Memory Snapshot Engine**: Non-intrusive tracer capturing locals from the innermost failing exception frame with secret-keyword and regex redaction. Disabled by default with strict user opt-in.
- **Context-Aware Diagnosis**: Strict separation of confirmed observed facts from AI-generated hypotheses. Pre-prompt secret redaction for zero credential exposure.
- **Minimal Code Fixes**: Targeted unified diff generation with path traversal guards and syntax validation.
- **Isolated Sandbox Verification**: Ephemeral Docker container isolation with restricted subprocess fallback, timeout guards, and resource limits.
- **Safety & Rollback**: Concurrency drift detection via SHA256 hashing, safe rollback checkpoints, and mandatory user approval modals before modifying files on disk.
- **Multi-Language Error Normalization**: Detection and normalization for Java NullPointerExceptions, C++ GCC/Clang compiler errors, and C++ AddressSanitizer memory corruptions.
- **Review Workflow UI**: Interactive Activity Bar sidebar with Facts vs. Hypotheses cards, sanitized runtime inspection, unified diff preview, and actions for Verify, Apply, Reject, and Rollback.
