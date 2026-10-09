import os
import subprocess
import pytest
from unittest.mock import patch, MagicMock
from backend.git.intelligence import GitIntelligence
from backend.security.redaction import RedactionEngine
from backend.parser.traceback_parser import TracebackParser
from backend.sandbox.runner import SandboxRunner

def test_git_team_conflict_detection(tmp_path):
    """Verify GitIntelligence detects overlapping uncommitted files and potential merge conflicts."""
    git = GitIntelligence(repo_path=str(tmp_path))
    
    with patch.object(git, "get_git_state", return_value={
        "branch": "feature/billing",
        "lastCommitHash": "abc1234",
        "isClean": False,
        "hasConflicts": False,
        "uncommittedFiles": ["services/payment.py", "models/invoice.py"]
    }):
        # Overlapping file
        conflict_res = git.detect_team_conflicts(["services/payment.py"])
        assert conflict_res["has_conflict"] is True
        assert "services/payment.py" in conflict_res["conflicting_files"]
        
        # Non-overlapping file
        clean_res = git.detect_team_conflicts(["controllers/auth.py"])
        assert clean_res["has_conflict"] is False
        assert len(clean_res["conflicting_files"]) == 0


def test_git_recent_commits_read_only(tmp_path):
    """Verify get_recent_commits safely queries log in read-only fashion."""
    git = GitIntelligence(repo_path=str(tmp_path))
    
    mock_log = "a1b2c3d|Alice Developer|Fix null check in cart|2026-10-08\ne4f5g6h|Bob Engineer|Update dependencies|2026-10-07"
    with patch.object(git, "_run_git", return_value=(True, mock_log)):
        commits = git.get_recent_commits(limit=2)
        assert len(commits) == 2
        assert commits[0]["hash"] == "a1b2c3d"
        assert commits[0]["author"] == "Alice Developer"
        assert commits[0]["summary"] == "Fix null check in cart"
        assert commits[0]["date"] == "2026-10-08"


def test_secret_redaction_and_log_sanitization():
    """Verify RedactionEngine prevents credential exposure in prompts, logs, and variable values."""
    sensitive_log = (
        "Server startup failed with DB_PASSWORD='SuperSecretPassword123!' "
        "and API_KEY='sk-12345678901234567890abcdef' "
        "and GITHUB_TOKEN='ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'"
    )
    
    sanitized = RedactionEngine.redact_text(sensitive_log)
    
    # Secrets must be scrubbed
    assert "SuperSecretPassword123!" not in sanitized
    assert "sk-12345678901234567890abcdef" not in sanitized
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" not in sanitized
    assert "[REDACTED_" in sanitized


def test_path_validation_blocks_directory_traversal():
    """Verify path traversal patterns are strictly caught and blocked."""
    from backend.agents.fix_generator import FixGeneratorAgent
    agent = FixGeneratorAgent()
    
    # Check traversal rejection
    assert agent._validate_candidate_patch({
        "title": "Bad", "description": "D", "diff": "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-1\n+2",
        "original_snippet": "1", "fixed_snippet": "2",
        "affected_files": ["../../windows/system32/cmd.exe"]
    }, "f", "/workspace") is False


def test_subprocess_safety_no_shell_true():
    """Verify SandboxRunner invokes commands without shell=True to eliminate shell injection vulnerabilities."""
    runner = SandboxRunner()
    
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="OK", stderr="")
        runner.execute_test(
            test_script_content="assert 1 == 1\n",
            source_files={"test.py": "a = 1\n"},
            command=["python", "test_reproduce.py"]
        )
        # Ensure subprocess.run was called with a list argument and NOT shell=True
        assert mock_run.called
        call_args, call_kwargs = mock_run.call_args
        assert isinstance(call_args[0], list)
        assert call_kwargs.get("shell") is not True


def test_multilang_java_exception_parsing():
    """Verify Java NullPointerException traceback parsing."""
    java_trace = """
Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "str" is null
    at com.example.CartService.calculateTotal(CartService.java:42)
    at com.example.App.main(App.java:15)
"""
    bug = TracebackParser.parse(java_trace)
    assert bug is not None
    assert bug["language"] == "java"
    assert bug["errorType"] == "NullPointerException"
    assert bug["file"] == "CartService.java"
    assert bug["line"] == 42
    assert bug["severity"] == "HIGH"


def test_multilang_cpp_compiler_diagnostic_parsing():
    """Verify C++ GCC/Clang compiler error parsing."""
    cpp_output = """
src/network/client.cpp:58:12: error: 'socket_fd' was not declared in this scope
   58 |     close(socket_fd);
      |           ^~~~~~~~~
"""
    bug = TracebackParser.parse(cpp_output)
    assert bug is not None
    assert bug["language"] == "cpp"
    assert bug["errorType"] == "CompileError"
    assert bug["file"] == "src/network/client.cpp"
    assert bug["line"] == 58
    assert bug["column"] == 12
    assert "socket_fd" in bug["message"]


def test_multilang_cpp_asan_memory_error_parsing():
    """Verify C++ AddressSanitizer memory corruption error parsing."""
    asan_output = """
==41920==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x602000000014
READ of size 4 at 0x602000000014 thread T0
    #0 0x000000401234 in process_packet src/packet_parser.cpp:104
"""
    bug = TracebackParser.parse(asan_output)
    assert bug is not None
    assert bug["language"] == "cpp"
    assert bug["errorType"] == "MemoryCorruption"
    assert bug["file"] == "src/packet_parser.cpp"
    assert bug["line"] == 104
    assert bug["severity"] == "CRITICAL"


def test_unsupported_language_graceful_handling():
    """Verify random text or unsupported formats do not crash the parser and return None."""
    assert TracebackParser.parse("Hello, this is just arbitrary log output without an error.") is None
    assert TracebackParser.parse("") is None
    assert TracebackParser.parse(None) is None
