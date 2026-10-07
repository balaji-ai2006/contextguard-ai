import os
import tempfile
import pytest
from backend.git.intelligence import GitIntelligence

def test_git_state_detection():
    git_engine = GitIntelligence(repo_path=os.getcwd())
    state = git_engine.get_git_state()
    assert "branch" in state
    assert "isClean" in state
    assert "hasConflicts" in state
    assert isinstance(state["uncommittedFiles"], list)

def test_safe_checkpoint_and_rollback():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "calculator.py")
        original_code = "def add(a, b):\n    return a + b\n"
        with open(test_file, "w") as f:
            f.write(original_code)

        git_engine = GitIntelligence(repo_path=tmpdir)
        original_hash = git_engine.get_file_hash(test_file)

        # Apply new code
        new_code = "def add(a, b):\n    # fixed type\n    return int(a) + int(b)\n"
        res = git_engine.safe_apply_patch(test_file, new_code, patch_id="patch_001", original_file_hash=original_hash)
        assert res["success"] is True

        # Verify content changed
        with open(test_file, "r") as f:
            assert "int(a)" in f.read()

        # Rollback
        rollback_res = git_engine.rollback("patch_001")
        assert rollback_res["success"] is True

        # Verify restored
        with open(test_file, "r") as f:
            assert f.read() == original_code

def test_concurrency_drift_detection():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "app.py")
        with open(test_file, "w") as f:
            f.write("x = 1\n")

        git_engine = GitIntelligence(repo_path=tmpdir)
        old_hash = git_engine.get_file_hash(test_file)

        # External edit occurs
        with open(test_file, "w") as f:
            f.write("x = 2 # modified by coworker\n")

        # Try to apply patch with outdated original hash
        res = git_engine.safe_apply_patch(test_file, "x = 3\n", patch_id="patch_002", original_file_hash=old_hash)
        assert res["success"] is False
        assert "WARNING" in res["message"]
        assert "File changed by another process" in res["message"]
