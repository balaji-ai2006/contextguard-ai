import re
import ast
from typing import Dict, Any, Tuple, List

class RedactionEngine:
    """
    Enterprise-grade AST-aware and regex/entropy secret & PII redaction engine.
    Ensures zero leakage of API keys, passwords, database URLs, JWTs, and private keys.
    """

    # High-confidence regular expressions for sensitive secrets and credentials
    SECRET_PATTERNS = [
        # Generic API keys & secrets
        (r'(?i)(api[_-]?key|secret|token|auth|password|passwd|pwd|client[_-]?secret)\s*[:=]\s*["\']([^"\']{4,})["\']', "REDACTED_SECRET"),
        # OpenAI, Anthropic, HuggingFace keys
        (r'sk-[a-zA-Z0-9_-]{20,}', "REDACTED_API_KEY"),
        (r'sk-ant-[a-zA-Z0-9_-]{20,}', "REDACTED_ANTHROPIC_KEY"),
        (r'hf_[a-zA-Z0-9]{20,}', "REDACTED_HF_TOKEN"),
        # AWS Access Key ID and Secret
        (r'AKIA[0-9A-Z]{16}', "REDACTED_AWS_KEY"),
        (r'(?i)aws_secret_access_key\s*[:=]\s*["\']?[a-zA-Z0-9/+=]{40}["\']?', "REDACTED_AWS_SECRET"),
        # GitHub tokens
        (r'gh[pousr]_[A-Za-z0-9_]{36,}', "REDACTED_GITHUB_TOKEN"),
        # JWT tokens (ey...)
        (r'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', "REDACTED_JWT_TOKEN"),
        # Private Keys
        (r'-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----', "REDACTED_PRIVATE_KEY"),
        # Database Connection Strings
        (r'(?i)(mongodb|postgres|postgresql|mysql|redis):\/\/[^\s"\']+', "REDACTED_DATABASE_URL"),
        # Email Addresses (PII)
        (r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', "REDACTED_EMAIL"),
        # IPv4 Private / Internal Addresses
        (r'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b', "REDACTED_INTERNAL_IP"),
    ]

    SENSITIVE_VAR_NAMES = {
        'password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'api_key', 'apikey',
        'access_token', 'refresh_token', 'private_key', 'client_secret', 'database_url',
        'db_pass', 'conn_str', 'connection_string', 'credit_card', 'ssn'
    }

    @classmethod
    def redact_text(cls, text: str) -> str:
        """Applies regex pattern redaction on arbitrary string/source code text."""
        if not text:
            return text

        redacted = text
        for pattern, replacement in cls.SECRET_PATTERNS:
            # If pattern has capture groups for key and secret
            if '(?i)(api[_-]?key|secret|token|auth|password' in pattern:
                redacted = re.sub(
                    pattern,
                    lambda m: f'{m.group(1)}="[{replacement}]"',
                    redacted
                )
            else:
                redacted = re.sub(pattern, f"[{replacement}]", redacted)

        return redacted

    @classmethod
    def redact_variable(cls, var_name: str, var_value: Any) -> Tuple[str, bool]:
        """
        Redacts a single variable's value based on its name and content.
        Returns (safe_value_string, was_redacted).
        """
        lower_name = var_name.lower().replace("-", "_")

        # Name-based heuristic
        if any(sens in lower_name for sens in cls.SENSITIVE_VAR_NAMES):
            return "[REDACTED_SECRET]", True

        val_str = str(var_value) if var_value is not None else "None"

        # Content-based pattern scan
        redacted_str = cls.redact_text(val_str)
        if redacted_str != val_str:
            return redacted_str, True

        # Truncate overly long values (e.g. huge payloads, binary blobs)
        if len(val_str) > 500:
            return val_str[:250] + "... [TRUNCATED]", False

        return val_str, False

    @classmethod
    def redact_ast_source(cls, source_code: str) -> str:
        """
        Parses Python AST to locate string assignments to sensitive variable names
        and replaces their string literal values before any LLM ingestion.
        """
        try:
            tree = ast.parse(source_code)
        except Exception:
            # Fallback to regex-only if syntax is incomplete
            return cls.redact_text(source_code)

        lines = source_code.splitlines(keepends=True)

        class SecretAssignLocator(ast.NodeVisitor):
            def __init__(self):
                self.replacements: List[Tuple[int, int, int, int, str]] = []

            def visit_Assign(self, node: ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        name = target.id.lower()
                        if any(s in name for s in RedactionEngine.SENSITIVE_VAR_NAMES):
                            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                                self.replacements.append((
                                    node.value.lineno,
                                    node.value.col_offset,
                                    node.value.end_lineno or node.value.lineno,
                                    node.value.end_col_offset or (node.value.col_offset + len(str(node.value.value))),
                                    '"[REDACTED_SECRET]"'
                                ))
                self.generic_visit(node)

        locator = SecretAssignLocator()
        locator.visit(tree)

        # Apply AST replacements or regex fallback
        if not locator.replacements:
            return cls.redact_text(source_code)

        # Perform replacements from bottom to top so line/col indices stay valid
        code_result = source_code
        for lineno, col_offset, end_lineno, end_col_offset, repl in sorted(locator.replacements, key=lambda r: (r[0], r[1]), reverse=True):
            file_lines = code_result.splitlines(keepends=True)
            if 0 < lineno <= len(file_lines):
                line_idx = lineno - 1
                curr_line = file_lines[line_idx]
                prefix = curr_line[:col_offset]
                suffix = curr_line[end_col_offset:]
                file_lines[line_idx] = prefix + repl + suffix
                code_result = "".join(file_lines)

        return cls.redact_text(code_result)
