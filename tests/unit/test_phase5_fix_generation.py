import os
import pytest
from unittest.mock import patch
from backend.agents.fix_generator import FixGeneratorAgent

def test_generate_candidates_with_structured_explanations():
    """Verify generated candidate patches include structured explanations, diffs, and risk analysis."""
    agent = FixGeneratorAgent(ollama_host="http://127.0.0.1:59999")
    
    bug_info = {
        "file": "services/cart.py",
        "line": 42,
        "errorType": "AttributeError",
        "message": "'NoneType' object has no attribute 'items'"
    }
    
    diagnosis = {
        "root_cause": "Variable 'cart' evaluated to None",
        "failure_point": "Line 42 in services/cart.py"
    }
    
    source_code = (
        "def calculate_total(items):\n"
        "    return sum(item['price'] for item in items)\n"
    )
    
    candidates = agent.generate_candidates(
        bug_info=bug_info,
        diagnosis=diagnosis,
        source_code=source_code,
        workspace_root="/workspace"
    )
    
    assert isinstance(candidates, list)
    assert len(candidates) >= 2
    
    for cand in candidates:
        assert "id" in cand
        assert "title" in cand
        assert "description" in cand
        assert "diff" in cand
        assert "original_snippet" in cand
        assert "fixed_snippet" in cand
        assert "affected_files" in cand
        assert "risks" in cand
        assert "why_it_works" in cand
        assert isinstance(cand["risks"], list)
        assert len(cand["risks"]) > 0
        assert "services/cart.py" in cand["affected_files"]


def test_model_output_validation_rejects_malformed_candidates():
    """Verify that malformed candidates (missing fields, wrong types) from LLM are rejected."""
    agent = FixGeneratorAgent()
    
    # Candidate missing diff and description
    malformed_cand_1 = {
        "title": "Bad Patch",
        "original_snippet": "foo",
        "fixed_snippet": "bar"
    }
    assert agent._validate_candidate_patch(malformed_cand_1, "test.py", None) is False
    
    # Candidate with empty diff
    malformed_cand_2 = {
        "title": "Empty Diff Patch",
        "description": "Does nothing",
        "diff": "",
        "original_snippet": "foo",
        "fixed_snippet": "bar"
    }
    assert agent._validate_candidate_patch(malformed_cand_2, "test.py", None) is False
    
    # Candidate not a dict
    assert agent._validate_candidate_patch("not_a_dict", "test.py", None) is False


def test_model_output_validation_rejects_path_traversal():
    """Verify that path traversal attempts and out-of-workspace files in model output are rejected."""
    agent = FixGeneratorAgent()
    
    # Path traversal with ..
    traversal_cand = {
        "title": "Malicious Patch",
        "description": "Attempts traversal",
        "diff": "--- a/test.py\n+++ b/test.py\n@@ -1 +1 @@\n-1\n+2",
        "original_snippet": "1",
        "fixed_snippet": "2",
        "affected_files": ["../../etc/passwd"]
    }
    assert agent._validate_candidate_patch(traversal_cand, "test.py", "C:\\myproject") is False
    
    # Target file mismatch
    mismatch_cand = {
        "title": "Wrong File Patch",
        "description": "Targets another file",
        "diff": "--- a/other.py\n+++ b/other.py\n@@ -1 +1 @@\n-1\n+2",
        "original_snippet": "1",
        "fixed_snippet": "2",
        "affected_files": ["other.py"]
    }
    assert agent._validate_candidate_patch(mismatch_cand, "test.py", "C:\\myproject") is False


def test_pre_prompt_secret_redaction_in_fix_generator():
    """Verify secrets in code or error message are redacted before constructing fix generation prompt."""
    agent = FixGeneratorAgent()
    
    bug_info = {
        "file": "payment.py",
        "line": 10,
        "errorType": "ValueError",
        "message": "Auth failed for sk-12345678901234567890abcdef"
    }
    
    source_code = "api_key = 'sk-ant-api03-secrettoken1234567890abcdef'\nclient = API(api_key)"
    diagnosis = {"root_cause": "Invalid API key"}
    
    prompt, system_prompt = agent._build_privacy_safe_prompt(bug_info, diagnosis, source_code)
    
    # Secrets must NOT appear in prompt
    assert "sk-12345678901234567890abcdef" not in prompt
    assert "sk-ant-api03-secrettoken1234567890abcdef" not in prompt
    assert "[REDACTED_API_KEY]" in prompt or "[REDACTED_" in prompt


def test_offline_fallback_when_llm_disconnected():
    """Verify graceful deterministic fallback when LLM is offline or connection fails."""
    # Closed port
    offline_agent = FixGeneratorAgent(ollama_host="http://127.0.0.1:59999")
    
    candidates = offline_agent.generate_candidates(
        bug_info={"file": "math.py", "errorType": "ZeroDivisionError", "message": "division by zero"},
        diagnosis={"root_cause": "Divisor was 0"},
        source_code="return a / b"
    )
    
    assert len(candidates) >= 1
    assert "math.py" in candidates[0]["affected_files"]
    assert "Zero-Divisor Guard" in candidates[0]["title"] or "Defensive" in candidates[0]["title"]


def test_deterministic_patch_generation_key_error():
    """Verify deterministic generation handles KeyError with safe .get() candidate."""
    agent = FixGeneratorAgent(ollama_host="http://127.0.0.1:59999")
    
    candidates = agent.generate_candidates(
        bug_info={"file": "config.py", "errorType": "KeyError", "message": "'database_port'"},
        diagnosis={"root_cause": "Key 'database_port' missing"},
        source_code="port = config['database_port']"
    )
    
    assert len(candidates) >= 1
    assert ".get(" in candidates[0]["diff"]
    assert "database_port" in candidates[0]["diff"]


def test_no_auto_execution_contract():
    """Verify that fix generator returns pure data and never modifies disk or executes code."""
    agent = FixGeneratorAgent(ollama_host="http://127.0.0.1:59999")
    
    test_file = "non_existent_dummy_file_for_test.py"
    assert not os.path.exists(test_file)
    
    candidates = agent.generate_candidates(
        bug_info={"file": test_file, "errorType": "TypeError", "message": "unsupported"},
        diagnosis={"root_cause": "Incompatible type"},
        source_code="x = 1 + 'a'"
    )
    
    # File must never be created on disk during generation
    assert not os.path.exists(test_file)
    assert len(candidates) >= 1
