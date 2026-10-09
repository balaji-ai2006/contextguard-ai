import os
import pytest
from unittest.mock import patch, MagicMock
from backend.agents.diagnostician import DiagnosticianAgent
from backend.agents.agent_base import BaseAgent
from backend.security.redaction import RedactionEngine

def test_diagnosis_full_context_synthesis():
    """Verify diagnosis engine combines error details, traceback, source window, runtime snapshot, and git context."""
    agent = DiagnosticianAgent()
    
    bug_info = {
        "file": "services/cart.py",
        "line": 42,
        "errorType": "AttributeError",
        "message": "'NoneType' object has no attribute 'items'",
        "stackTrace": "Traceback (most recent call last):\n  File 'services/cart.py', line 42, in calculate_total\n    for item in cart.items:\nAttributeError: 'NoneType' object has no attribute 'items'",
        "severity": "CRITICAL"
    }
    
    code_snippet = (
        "def calculate_total(cart):\n"
        "    total = 0\n"
        "    for item in cart.items:\n"
        "        total += item.price\n"
        "    return total\n"
    )
    
    runtime_snapshot = {
        "snapshot_id": "snap_123",
        "function_name": "calculate_total",
        "line_number": 42,
        "file_path": "services/cart.py",
        "failed_expression": "cart.items",
        "variable_snapshots": {
            "cart": {"type": "NoneType", "preview": "None", "redacted": False},
            "total": {"type": "int", "preview": "0", "redacted": False}
        },
        "capture_status": "captured"
    }
    
    git_context = {
        "branch": "feature/checkout",
        "isClean": False,
        "uncommittedFiles": ["services/cart.py"],
        "activeDiff": "diff --git a/services/cart.py b/services/cart.py\n+def calculate_total(cart):"
    }
    
    result = agent.diagnose(
        bug_info=bug_info,
        runtime_snapshot=runtime_snapshot,
        code_snippet=code_snippet,
        git_context=git_context
    )
    
    # 1. Check top-level contract
    assert "root_cause" in result
    assert "failure_point" in result
    assert "propagation_path" in result
    assert "confirmed_facts" in result
    assert "hypotheses" in result
    assert "evidence_sources" in result
    assert "privacy_status" in result
    assert "engine" in result
    
    # 2. Check confirmed facts
    facts = result["confirmed_facts"]
    assert facts["is_factually_confirmed"] is True
    assert facts["observed_error"]["type"] == "AttributeError"
    assert facts["observed_error"]["message"] == "'NoneType' object has no attribute 'items'"
    assert facts["failure_location"]["file"] == "services/cart.py"
    assert facts["failure_location"]["line"] == 42
    assert facts["failure_location"]["function"] == "calculate_total"
    assert facts["failed_expression"] == "cart.items"
    assert "cart" in facts["observed_variables"]
    assert facts["observed_variables"]["cart"]["value"] == "None"
    assert facts["observed_variables"]["cart"]["is_confirmed_runtime_value"] is True
    
    # 3. Check evidence sources
    sources = result["evidence_sources"]
    assert "static_inspection" in sources
    assert "runtime_memory_snapshot" in sources
    assert "git_intelligence" in sources
    assert "traceback_parser" in sources
    
    # 4. Check hypotheses
    hypotheses = result["hypotheses"]
    assert hypotheses["is_verified_fact"] is False
    assert "root_cause" in hypotheses
    assert "propagation_path" in hypotheses
    assert isinstance(hypotheses["propagation_path"], list)
    assert len(hypotheses["propagation_path"]) >= 2
    assert hypotheses["confidence_score"] > 0.0


def test_strict_separation_of_facts_and_hypotheses():
    """Verify that confirmed facts and hypotheses are clearly separated and unobserved variables are never fabricated."""
    agent = DiagnosticianAgent()
    
    bug_info = {
        "file": "app/models.py",
        "line": 15,
        "errorType": "KeyError",
        "message": "'user_id'"
    }
    
    runtime_snapshot = {
        "failed_expression": "user['user_id']",
        "variable_snapshots": {
            "user": {"type": "dict", "preview": "{'name': 'Alice'}", "redacted": False}
        }
    }
    
    result = agent.diagnose(bug_info=bug_info, runtime_snapshot=runtime_snapshot)
    
    # Facts are strictly marked
    assert result["confirmed_facts"]["is_factually_confirmed"] is True
    # Hypotheses are marked as unverified
    assert result["hypotheses"]["is_verified_fact"] is False
    
    # Check that observed variables ONLY contain what was observed
    observed = result["confirmed_facts"]["observed_variables"]
    assert "user" in observed
    assert "session_token" not in observed  # Unobserved variable is not invented
    assert "user_id" not in observed        # The missing key is not in variables


def test_pre_prompt_secret_redaction():
    """Verify API keys, passwords, tokens, and sensitive runtime values are redacted locally before prompt construction."""
    agent = DiagnosticianAgent()
    
    bug_info = {
        "file": "payment/stripe_client.py",
        "line": 88,
        "errorType": "ValueError",
        "message": "Invalid auth header with sk-99887766554433221100aabbccdd",
        "stackTrace": "File 'payment/stripe_client.py', line 88\nAuthorization: Bearer sk-ant-api03-abcdef1234567890abcdef123"
    }
    
    code_snippet = (
        "api_key = 'sk-12345678901234567890abcdef'\n"
        "client = StripeClient(api_key=api_key)\n"
    )
    
    git_context = {
        "branch": "fix/auth",
        "isClean": False,
        "activeDiff": "+db_password = 'super_secret_password_123!'\n+gh_token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'"
    }
    
    runtime_snapshot = {
        "variable_snapshots": {
            "api_key": {"type": "str", "preview": "sk-12345678901234567890abcdef", "redacted": True},
            "user_password": {"type": "str", "preview": "secret_pass_word_999", "redacted": True},
            "safe_counter": {"type": "int", "preview": "5", "redacted": False}
        }
    }
    
    # Test prompt synthesis directly
    confirmed_facts = agent._extract_confirmed_facts(
        bug=bug_info,
        file_path="payment/stripe_client.py",
        line_no=88,
        err_type="ValueError",
        err_msg=bug_info["message"],
        snapshot=runtime_snapshot,
        git_context=git_context,
        source_snippet=code_snippet
    )
    
    prompt, system_prompt, redaction_meta = agent.synthesize_privacy_safe_prompt(
        confirmed_facts=confirmed_facts,
        code_snippet=code_snippet,
        stack_trace=bug_info["stackTrace"],
        git_context=git_context
    )
    
    # 1. Plaintext secrets must NEVER appear in synthesized prompt
    assert "sk-12345678901234567890abcdef" not in prompt
    assert "sk-ant-api03-abcdef1234567890abcdef123" not in prompt
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" not in prompt
    assert "secret_pass_word_999" not in prompt
    
    # 2. Redaction markers must be present
    assert "[REDACTED_API_KEY]" in prompt or "[REDACTED_SECRET]" in prompt
    assert redaction_meta["redacted_count"] >= 2
    
    # 3. Diagnose with this bug and verify privacy_status
    diag_result = agent.diagnose(
        bug_info=bug_info,
        runtime_snapshot=runtime_snapshot,
        code_snippet=code_snippet,
        git_context=git_context
    )
    privacy = diag_result["privacy_status"]
    assert privacy["privacy_mode"] == "local"
    assert privacy["zero_leakage_verified"] is True
    assert privacy["secrets_redacted_count"] >= 2
    assert privacy["external_transmission_authorized"] is False


def test_missing_context_graceful_handling():
    """Verify robust execution when parts of context (code, snapshot, git, stack trace) are missing."""
    agent = DiagnosticianAgent()
    
    # Case 1: Minimal bug info, no code, no snapshot, no git
    minimal_bug = {
        "file": "non_existent_module.py",
        "line": 10,
        "errorType": "ZeroDivisionError",
        "message": "division by zero"
    }
    
    result = agent.diagnose(
        bug_info=minimal_bug,
        runtime_snapshot=None,
        code_snippet=None,
        git_context=None
    )
    
    assert result["confirmed_facts"]["is_factually_confirmed"] is True
    assert result["confirmed_facts"]["variable_capture_status"] == "unavailable"
    assert result["confirmed_facts"]["observed_variables"] == {}
    assert "Line 10 in non_existent_module.py" in result["failure_point"]
    assert result["hypotheses"]["is_verified_fact"] is False
    assert "ZeroDivisionError" in result["root_cause"] or "0" in result["root_cause"]
    
    # Case 2: No stack trace
    bug_no_trace = {
        "file": "utils.py",
        "line": 5,
        "errorType": "IndexError",
        "message": "list index out of range"
    }
    result2 = agent.diagnose(bug_info=bug_no_trace)
    assert result2["confirmed_facts"]["observed_error"]["type"] == "IndexError"


def test_malformed_input_resilience():
    """Verify that unexpected, invalid, or malformed input types do not crash the engine."""
    agent = DiagnosticianAgent()
    
    # 1. bug_info is None
    res1 = agent.diagnose(bug_info=None)
    assert res1["confirmed_facts"]["is_factually_confirmed"] is True
    assert res1["confirmed_facts"]["failure_location"]["line"] == 1
    
    # 2. bug_info is empty dict
    res2 = agent.diagnose(bug_info={})
    assert res2["confirmed_facts"]["is_factually_confirmed"] is True
    
    # 3. line is not a valid number
    malformed_line_bug = {
        "file": "test.py",
        "line": "not_a_valid_line_number",
        "errorType": "TypeError",
        "message": "unsupported operand type"
    }
    res3 = agent.diagnose(bug_info=malformed_line_bug)
    assert res3["confirmed_facts"]["failure_location"]["line"] == 1
    
    # 4. runtime_snapshot is not a dict
    res4 = agent.diagnose(bug_info={"file": "a.py", "line": 2}, runtime_snapshot="invalid_snapshot_string")
    assert res4["confirmed_facts"]["variable_capture_status"] == "unavailable"


def test_backend_disconnection_and_offline_fallback():
    """Verify that when Ollama/LLM backend is offline or disconnected, deterministic symbolic reasoning succeeds."""
    # Point agent to a closed port / non-existent host
    offline_agent = DiagnosticianAgent(ollama_host="http://127.0.0.1:59999")
    
    bug_info = {
        "file": "pricing.py",
        "line": 30,
        "errorType": "ZeroDivisionError",
        "message": "division by zero"
    }
    
    result = offline_agent.diagnose(bug_info=bug_info)
    
    # Must cleanly fall back to deterministic symbolic engine
    assert result["engine"] == "deterministic_symbolic_engine"
    assert result["llm_available"] is False
    assert result["hypotheses"]["inference_engine"] == "deterministic_symbolic_engine"
    assert "0" in result["root_cause"] or "divisor" in result["root_cause"].lower()
    assert result["hypotheses"]["is_verified_fact"] is False
    assert len(result["propagation_path"]) >= 2


def test_symbolic_reasoning_scenarios():
    """Verify deterministic symbolic reasoning engine handles key error classes correctly."""
    agent = DiagnosticianAgent(ollama_host="http://127.0.0.1:59999")
    
    # 1. AttributeError with None variable
    bug_none = {
        "file": "user.py",
        "line": 12,
        "errorType": "AttributeError",
        "message": "'NoneType' object has no attribute 'get'"
    }
    snap_none = {
        "variable_snapshots": {
            "user_obj": {"type": "NoneType", "preview": "None"}
        }
    }
    res_none = agent.diagnose(bug_info=bug_none, runtime_snapshot=snap_none)
    assert "user_obj" in res_none["root_cause"]
    assert "None" in res_none["root_cause"]
    
    # 2. KeyError scenario
    bug_key = {
        "file": "config.py",
        "line": 20,
        "errorType": "KeyError",
        "message": "'database_port'"
    }
    res_key = agent.diagnose(bug_info=bug_key)
    assert "database_port" in res_key["root_cause"]


def test_external_authorization_enforcement():
    """Verify external transmission is blocked unless explicitly authorized."""
    # Agent configured with external endpoint
    external_agent = DiagnosticianAgent(ollama_host="https://api.external-cloud-llm.com")
    
    bug_info = {
        "file": "service.py",
        "line": 10,
        "errorType": "ValueError",
        "message": "invalid literal"
    }
    
    # Case 1: allow_external is False (default)
    with patch("urllib.request.urlopen") as mock_url:
        res_blocked = external_agent.diagnose(bug_info=bug_info, allow_external=False)
        # urlopen should NEVER be called on external host when unauthorized
        mock_url.assert_not_called()
        assert res_blocked["engine"] == "deterministic_symbolic_engine"
        assert res_blocked["privacy_status"]["external_transmission_authorized"] is False
        
    # Case 2: allow_external is True
    res_auth = external_agent.diagnose(bug_info=bug_info, allow_external=True)
    assert res_auth["privacy_status"]["external_transmission_authorized"] is True
