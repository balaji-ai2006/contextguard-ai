import os
import tempfile
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["version"] == "0.1.0"
    assert data["privacy_mode"] == "local"
    assert "ollama_available" in data
    assert "docker_available" in data
    assert "active_model" in data

def test_cors_headers():
    response = client.options("/health", headers={
        "Origin": "vscode-webview://contextguard",
        "Access-Control-Request-Method": "GET"
    })
    assert response.status_code == 200
    assert "access-control-allow-origin" in response.headers

def test_investigate_endpoint():
    payload = {
        "bug": {
            "id": "bug_001",
            "file": "app/cart.py",
            "line": 42,
            "column": 1,
            "errorType": "TypeError",
            "message": "'NoneType' object is not iterable",
            "source": "terminal",
            "severity": "HIGH",
            "codeSnippet": "def calculate_total(items):\n    return sum(item['price'] for item in items)\nitems = None\ncalculate_total(items)",
            "stackTrace": "Traceback (most recent call last):\n  File 'app/cart.py', line 42, in calculate_total\nTypeError: 'NoneType' object is not iterable"
        },
        "workspace_root": os.getcwd(),
        "privacy_mode": "local"
    }

    response = client.post("/api/investigate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["reproduction_confirmed"] is True
    assert "root_cause_graph" in data
    assert "candidate_patches" in data
    assert len(data["candidate_patches"]) >= 2
    
    # Verify candidate patch structure
    best_patch = data["candidate_patches"][0]
    assert "diff" in best_patch
    assert "confidence" in best_patch
    assert best_patch["confidence"] >= 80
    assert "verificationStatus" in best_patch
    assert "explanation" in best_patch

def test_apply_and_rollback_patch_endpoints():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "cart.py")
        original_code = "def calculate_total(items):\n    return sum(item['price'] for item in items)\n"
        with open(test_file, "w") as f:
            f.write(original_code)

        # Apply patch
        fixed_code = "def calculate_total(items):\n    if not items: return 0\n    return sum(item['price'] for item in items)\n"
        apply_payload = {
            "patch_id": "patch_test_101",
            "file_path": test_file,
            "diff": fixed_code
        }
        res_apply = client.post("/api/patch/apply", json=apply_payload)
        assert res_apply.status_code == 200
        assert res_apply.json()["success"] is True

        # Check content changed
        with open(test_file, "r") as f:
            assert "if not items: return 0" in f.read()

        # Rollback patch
        rollback_payload = {
            "patch_id": "patch_test_101"
        }
        res_rollback = client.post("/api/patch/rollback", json=rollback_payload)
        assert res_rollback.status_code == 200
        assert res_rollback.json()["success"] is True

        # Check restored
        with open(test_file, "r") as f:
            assert f.read() == original_code

def test_feedback_endpoint():
    payload = {
        "patch_id": "patch_test_101",
        "feedback": "fixed",
        "comments": "Fixed the NoneType error cleanly."
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 200
    assert response.json()["success"] is True
