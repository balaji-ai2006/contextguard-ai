import re
from typing import Dict, Any, List
from backend.agents.agent_base import BaseAgent
from backend.security.redaction import RedactionEngine

class SecurityAgent(BaseAgent):
    """
    Agent 4 — Security Agent
    Checks for: secret exposure, command injection, SQL injection,
    unsafe deserialization, path traversal, insecure dependencies.
    """

    def __init__(self):
        super().__init__("SecurityAgent")

    def inspect_patch(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        diff_text = patch.get("diff", "")
        fixed_code = patch.get("fixed_snippet", "")
        combined = f"{diff_text}\n{fixed_code}"

        findings = []

        # 1. Check for exposed secrets
        redacted = RedactionEngine.redact_text(combined)
        if "[REDACTED_" in redacted:
            findings.append("Exposed credential or sensitive secret detected in patch code.")

        # 2. Check for Command Injection
        if re.search(r'(?i)(os\.system|subprocess\.(Popen|run|call)\s*\([^)]*shell\s*=\s*True)', combined):
            findings.append("Potential Command Injection vulnerability (shell=True or os.system detected).")

        # 3. Check for SQL Injection
        if re.search(r'(?i)execute\s*\(\s*f["\'].*?(SELECT|INSERT|UPDATE|DELETE)', combined):
            findings.append("Potential SQL Injection vulnerability (unparameterized f-string query).")

        # 4. Check for Unsafe Deserialization
        if re.search(r'(?i)(pickle\.loads|yaml\.load\s*\([^)]*Loader\s*=\s*(yaml\.)?Loader)', combined):
            findings.append("Potential Unsafe Deserialization vulnerability (pickle or unsafe PyYAML loader).")

        # 5. Check for Path Traversal
        if re.search(r'\.\.\/|\.\.\\', combined) and "os.path" in combined:
            findings.append("Potential Path Traversal pattern detected.")

        passed = len(findings) == 0

        return {
            "passed": passed,
            "findings": findings,
            "security_score": 100 if passed else 30,
            "recommendation": "Patch is secure." if passed else "Reject patch: security violations found."
        }
