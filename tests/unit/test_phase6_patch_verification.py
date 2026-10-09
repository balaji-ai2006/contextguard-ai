import os
import tempfile
import hashlib
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.sandbox.runner import SandboxRunner
from backend.verification.pipeline import PatchVerificationPipeline
from backend.git.intelligence import GitIntelligence

client = TestClient(app)

def test_valid_patch_preview_and_line_count(tmp_path):
    """Verify patch preview computes lines added/removed, SHA256 hash, and can_apply flag."""
    test_file = tmp_path / "app.py"
    test_file.write_text("def run():\n    return 1\n", encoding="utf-8")
    
    pipeline = PatchVerificationPipeline()
    diff = "--- a/app.py\n+++ b/app.py\n@@ -1,2 +1,3 @@\n def run():\n+    print('init')\n     return 1"
    
    preview = pipeline.preview_patch(str(test_file), diff)
    assert preview["can_apply"] is True
    assert preview["conflict"] is False
    assert preview["lines_added"] == 1
    assert preview["lines_removed"] == 0
    assert len(preview["current_hash"]) == 64


def test_file_modification_conflict_detection(tmp_path):
    """Verify concurrency drift detection pauses patch application if file changed."""
    test_file = tmp_path / "drift.py"
    test_file.write_text("initial_content = True\n", encoding="utf-8")
    
    pipeline = PatchVerificationPipeline()
    stale_hash = "a" * 64
    diff = "--- a/drift.py\n+++ b/drift.py\n@@ -1 +1 @@\n-1\n+2"
    
    # Preview with stale hash
    preview = pipeline.preview_patch(str(test_file), diff, original_hash=stale_hash)
    assert preview["conflict"] is True
    assert preview["can_apply"] is False
    assert "File modified concurrently" in preview["message"]
    
    # Safe apply with stale hash
    git_engine = GitIntelligence(repo_path=str(tmp_path))
    res = git_engine.safe_apply_patch(str(test_file), "replacement", "p1", original_file_hash=stale_hash)
    assert res["success"] is False
    assert "WARNING" in res["message"]


def test_patch_application_requires_user_approval(tmp_path):
    """Verify explicit user approval is required by the API before modifying source files."""
    test_file = tmp_path / "module.py"
    test_file.write_text("version = 1\n", encoding="utf-8")
    
    # 1. Without user approval -> 400
    res_rejected = client.post("/api/patch/apply", json={
        "patch_id": "patch_101",
        "file_path": str(test_file),
        "diff": "version = 2\n",
        "user_approved": False
    })
    assert res_rejected.status_code == 400
    assert "approval required" in res_rejected.json()["detail"].lower()
    assert test_file.read_text(encoding="utf-8") == "version = 1\n"
    
    # 2. With user approval -> 200
    res_approved = client.post("/api/patch/apply", json={
        "patch_id": "patch_101",
        "file_path": str(test_file),
        "diff": "version = 2\n",
        "user_approved": True
    })
    assert res_approved.status_code == 200
    assert res_approved.json()["success"] is True
    assert test_file.read_text(encoding="utf-8") == "version = 2\n"


def test_patch_rollback_restores_original_file(tmp_path):
    """Verify reliable rollback restores original file content accurately from checkpoint."""
    test_file = tmp_path / "target.py"
    original_code = "def foo():\n    return 'original'\n"
    test_file.write_text(original_code, encoding="utf-8")
    
    git_engine = GitIntelligence(repo_path=str(tmp_path))
    
    # Apply patch
    apply_res = git_engine.safe_apply_patch(
        file_path=str(test_file),
        diff_or_content="def foo():\n    return 'modified'\n",
        patch_id="patch_test_rollback"
    )
    assert apply_res["success"] is True
    assert test_file.read_text(encoding="utf-8") == "def foo():\n    return 'modified'\n"
    
    # Rollback
    rb_res = git_engine.rollback("patch_test_rollback")
    assert rb_res["success"] is True
    assert test_file.read_text(encoding="utf-8") == original_code


def test_rejected_patch_workflow():
    """Verify rejecting a patch records feedback without altering any file."""
    res = client.post("/api/patch/reject", json={
        "patch_id": "patch_reject_test",
        "reason": "Not idiomatic in this repository"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["patch_id"] == "patch_reject_test"


def test_sandbox_isolated_execution_successful_fix():
    """Verify sandbox runs pre-fix and post-fix tests, detecting reproduction and successful fix."""
    pipeline = PatchVerificationPipeline()
    
    candidate = {
        "id": "patch_cart_1",
        "original_snippet": "def calculate_total(items):\n    return sum(item['price'] for item in items)\n",
        "fixed_snippet": "def calculate_total(items):\n    if not items: return 0\n    return sum(item['price'] for item in items)\n",
        "diff": "--- a/cart.py\n+++ b/cart.py"
    }
    
    bug_info = {"file": "cart.py"}
    
    test_script = (
        "from cart import calculate_total\n"
        "try:\n"
        "    res = calculate_total(None)\n"
        "    assert res == 0\n"
        "except Exception:\n"
        "    exit(1)\n"
    )
    
    result = pipeline.verify_patch(
        candidate_patch=candidate,
        bug_info=bug_info,
        reproduction_test_code=test_script
    )
    
    assert result["verification_status"] == "TESTS_PASSED"
    assert result["failure_reproduced"] is True
    assert result["fix_resolved"] is True
    assert result["pre_fix"]["exit_code"] != 0
    assert result["post_fix"]["exit_code"] == 0


def test_sandbox_test_failure_status():
    """Verify that an ineffective patch that fails post-fix test is flagged as FAILED."""
    pipeline = PatchVerificationPipeline()
    
    # Candidate that fails the test
    bad_candidate = {
        "id": "patch_bad",
        "original_snippet": "def get_val():\n    return 0\n",
        "fixed_snippet": "def get_val():\n    return -1\n", # Incorrect return
        "diff": "--- a/val.py\n+++ b/val.py"
    }
    
    test_script = "from val import get_val\nassert get_val() == 100\n"
    
    result = pipeline.verify_patch(
        candidate_patch=bad_candidate,
        bug_info={"file": "val.py"},
        reproduction_test_code=test_script
    )
    
    assert result["verification_status"] == "FAILED"
    assert result["fix_resolved"] is False
    assert result["post_fix"]["exit_code"] != 0


def test_sandbox_timeout_handling():
    """Verify sandbox execution enforces timeout limits on long-running or hanging scripts."""
    # Use short 1-second timeout
    runner = SandboxRunner(timeout_seconds=1)
    
    infinite_loop_script = "import time\ntime.sleep(5)\n"
    
    res = runner.execute_test(
        test_script_content=infinite_loop_script,
        source_files={"dummy.py": "x = 1\n"},
        command=["python", "test_reproduce.py"]
    )
    
    assert res["timed_out"] is True
    assert res["success"] is False
    assert res["exit_code"] == -1
    assert "timed out" in res["stderr"].lower()


def test_sandbox_docker_unavailability_fallback():
    """Verify that when Docker daemon is unavailable, restricted subprocess fallback is used and labeled."""
    with patch.object(SandboxRunner, "_check_docker_available", return_value=False):
        runner = SandboxRunner(timeout_seconds=5)
        assert runner.is_docker_available() is False
        
        res = runner.execute_test(
            test_script_content="print('sandbox test')\n",
            source_files={"app.py": "a = 1\n"},
            command=["python", "test_reproduce.py"]
        )
        
        # Must clearly identify environment as restricted subprocess fallback
        assert res["execution_environment"] == "restricted_subprocess_fallback"
        assert res["is_docker"] is False
        assert res["success"] is True
