import pytest
from backend.security.redaction import RedactionEngine
from backend.runtime.snapshot import RuntimeSnapshotCollector

def test_redaction_regex_patterns():
    # OpenAI key
    raw = 'api_key = "sk-1234567890abcdef1234567890"'
    redacted = RedactionEngine.redact_text(raw)
    assert "sk-" not in redacted or "[REDACTED" in redacted

    # Password
    raw_pwd = 'password = "SuperSecretPassword123!"'
    redacted_pwd = RedactionEngine.redact_text(raw_pwd)
    assert "SuperSecretPassword123!" not in redacted_pwd
    assert "[REDACTED_SECRET]" in redacted_pwd

    # Database URL
    raw_db = 'mongodb://user:pass@localhost:27017/mydb'
    redacted_db = RedactionEngine.redact_text(raw_db)
    assert "mongodb://" not in redacted_db or "[REDACTED_DATABASE_URL]" in redacted_db

def test_redaction_ast():
    code = """
def connect():
    secret_token = "my-secret-token-val"
    username = "admin"
    return username
"""
    sanitized = RedactionEngine.redact_ast_source(code)
    assert "my-secret-token-val" not in sanitized
    assert "[REDACTED_SECRET]" in sanitized
    assert "admin" in sanitized

def test_runtime_snapshot_redaction():
    def dummy_func():
        password = "MySecretPassword123"
        items = None
        count = 42
        return RuntimeSnapshotCollector.collect_from_frame()

    snapshot = dummy_func()
    assert "password" in snapshot["variables"]
    assert snapshot["variables"]["password"]["redacted"] is True
    assert snapshot["variables"]["password"]["value"] == "[REDACTED_SECRET]"

    assert "items" in snapshot["variables"]
    assert snapshot["variables"]["items"]["value"] == "None"
    assert snapshot["variables"]["items"]["type"] == "NoneType"

    assert "environment" in snapshot
    assert "os" in snapshot["environment"]
    assert "dependency_versions" in snapshot
