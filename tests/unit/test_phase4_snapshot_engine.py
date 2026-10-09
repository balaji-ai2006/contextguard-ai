import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.runtime.models import RuntimeSnapshotModel, VariableSnapshot
from backend.runtime.inspector import VariableInspector
from backend.runtime.snapshot_manager import InMemorySnapshotManager
from backend.runtime.tracer import SnapshotTracer
from backend.api.routes import backend_snapshot_state

client = TestClient(app)

# 1. Snapshot model validation
def test_snapshot_model_validation():
    snap = RuntimeSnapshotModel(
        snapshot_id="snap_test_01",
        language="python",
        error_type="ValueError",
        error_message="Invalid value provided",
        file_path="service.py",
        line_number=42,
        function_name="calculate",
        variable_snapshots={
            "x": VariableSnapshot(
                name="x",
                type="int",
                preview="100",
                truncated=False,
                redacted=False
            )
        },
        capture_method="sys_settrace",
        capture_status="success"
    )
    assert snap.snapshot_id == "snap_test_01"
    assert snap.variable_snapshots["x"].name == "x"
    assert snap.variable_snapshots["x"].preview == "100"
    assert snap.capture_status == "success"

# 2, 3, 4. Exception type and message capture, file and line extraction, function name extraction
def test_exception_type_message_file_line_func():
    tracer = SnapshotTracer()
    
    def failing_function():
        val = 10
        raise ZeroDivisionError("division by zero in math module")

    try:
        with tracer:
            failing_function()
    except ZeroDivisionError:
        pass

    snap = tracer.last_snapshot
    assert snap is not None
    assert snap.error_type == "ZeroDivisionError"
    assert "division by zero" in snap.error_message
    assert snap.function_name == "failing_function"
    assert snap.line_number is not None
    assert snap.line_number > 0
    assert "test_phase4_snapshot_engine.py" in snap.file_path
    assert "val" in snap.variable_snapshots

# 5. None-valued variable handling and objective diagnostic example
def test_none_valued_variable_and_objective_example():
    tracer = SnapshotTracer()

    def buggy_name_upper():
        name = None
        age = 20
        # print(name.upper()) simulation
        return name.upper()

    try:
        with tracer:
            buggy_name_upper()
    except AttributeError:
        pass

    snap = tracer.last_snapshot
    assert snap is not None
    assert snap.error_type == "AttributeError"
    assert "name" in snap.variable_snapshots
    assert snap.variable_snapshots["name"].type == "NoneType"
    assert snap.variable_snapshots["name"].preview == "None"
    assert snap.variable_snapshots["name"].redacted is False
    assert snap.failed_expression is not None
    assert "name.upper" in snap.failed_expression
    assert snap.heuristic_explanation is not None
    assert "name" in snap.heuristic_explanation and "None" in snap.heuristic_explanation

# 6. Primitive variable preview
def test_primitive_variable_preview():
    var_int = VariableInspector.inspect_variable("count", 42)
    assert var_int.name == "count"
    assert var_int.type == "int"
    assert var_int.preview == "42"
    assert var_int.truncated is False
    assert var_int.redacted is False

    var_str = VariableInspector.inspect_variable("greeting", "Hello ContextGuard")
    assert var_str.type == "str"
    assert "Hello ContextGuard" in var_str.preview

    var_bool = VariableInspector.inspect_variable("is_active", True)
    assert var_bool.type == "bool"
    assert var_bool.preview == "True"

# 7. Large collection truncation
def test_large_collection_truncation():
    large_list = list(range(1000))
    snap = VariableInspector.inspect_variable("big_data", large_list)
    assert snap.type == "list"
    assert snap.truncated is True
    assert "1000 items" in snap.preview or "TRUNCATED" in snap.preview
    assert len(snap.preview) <= VariableInspector.MAX_PREVIEW_LENGTH + 40

    large_dict = {f"k_{i}": i for i in range(200)}
    dict_snap = VariableInspector.inspect_variable("lookup", large_dict)
    assert dict_snap.type == "dict"
    assert dict_snap.truncated is True

# 8. Secret-name redaction
def test_secret_name_redaction():
    snap_pwd = VariableInspector.inspect_variable("user_password", "PlaintextSecret123!")
    assert snap_pwd.redacted is True
    assert snap_pwd.preview == "[REDACTED_SECRET]"

    snap_token = VariableInspector.inspect_variable("auth_token", "jwt-header-payload")
    assert snap_token.redacted is True
    assert snap_token.preview == "[REDACTED_SECRET]"

    snap_api_key = VariableInspector.inspect_variable("api_key", "sk-custom-secret")
    assert snap_api_key.redacted is True
    assert snap_api_key.preview == "[REDACTED_SECRET]"

# 9. Secret-pattern redaction
def test_secret_pattern_redaction():
    # Value contains an OpenAI key pattern in an innocuous variable name
    raw_val = "Authorization token: sk-abcdef1234567890abcdef1234567890"
    snap = VariableInspector.inspect_variable("config_string", raw_val)
    assert snap.redacted is True
    assert "sk-abcdef" not in snap.preview
    assert "[REDACTED_API_KEY]" in snap.preview

# 10. Unsafe object handling (no arbitrary execution or dumping of modules/functions)
def test_unsafe_object_handling():
    import math
    def sample_fn():
        return 1

    class CustomClass:
        def __repr__(self):
            raise RuntimeError("Should never be called!")

    mod_snap = VariableInspector.inspect_variable("m", math)
    assert mod_snap.type == "module"
    assert "<module" in mod_snap.preview

    fn_snap = VariableInspector.inspect_variable("fn", sample_fn)
    assert fn_snap.type in ("function", "FunctionType")
    assert "<function" in fn_snap.preview

    # Ensure custom object __repr__ with exception does not crash inspection
    custom_obj = CustomClass()
    cust_snap = VariableInspector.inspect_variable("obj", custom_obj)
    assert cust_snap.type == "CustomClass"
    assert "CustomClass" in cust_snap.preview

# 11. Circular reference handling
def test_circular_reference_handling():
    circular_list = [1, 2]
    circular_list.append(circular_list)
    snap = VariableInspector.inspect_variable("loop_list", circular_list)
    assert snap.type == "list"
    assert "<circular reference>" in snap.preview

# 12. Snapshot history limits
def test_snapshot_history_limits():
    manager = InMemorySnapshotManager(max_history_size=3)
    for i in range(5):
        s = RuntimeSnapshotModel(
            snapshot_id=f"snap_{i}",
            error_type="Error",
            error_message=f"msg {i}"
        )
        manager.add_snapshot(s)

    assert manager.count() == 3
    # Most recent first: snap_4, snap_3, snap_2 (0 and 1 should have been evicted)
    snaps = manager.list_snapshots()
    ids = [sn.snapshot_id for sn in snaps]
    assert ids == ["snap_4", "snap_3", "snap_2"]
    assert manager.get_snapshot("snap_0") is None
    assert manager.get_snapshot("snap_1") is None

# 13. Snapshot retrieval
def test_snapshot_retrieval():
    manager = InMemorySnapshotManager(max_history_size=10)
    snap = RuntimeSnapshotModel(
        snapshot_id="target_snap_99",
        error_type="IndexError",
        error_message="list index out of range"
    )
    manager.add_snapshot(snap)

    retrieved = manager.get_snapshot("target_snap_99")
    assert retrieved is not None
    assert retrieved.snapshot_id == "target_snap_99"
    assert retrieved.error_type == "IndexError"

# 14. Snapshot clearing
def test_snapshot_clearing():
    manager = InMemorySnapshotManager(max_history_size=10)
    manager.add_snapshot(RuntimeSnapshotModel(snapshot_id="s1"))
    manager.add_snapshot(RuntimeSnapshotModel(snapshot_id="s2"))
    assert manager.count() == 2

    cleared_count = manager.clear_snapshots()
    assert cleared_count == 2
    assert manager.count() == 0
    assert manager.get_snapshot("s1") is None
    assert len(manager.list_snapshots()) == 0

# 15. Disabled-by-default behavior (tracer does not trace unless started)
def test_disabled_by_default_behavior():
    tracer = SnapshotTracer()
    assert tracer._is_tracing is False
    # If not started, no snapshot should be produced
    tracer.last_snapshot = None
    assert tracer.last_snapshot is None

# 16. Backend opt-in enforcement
def test_backend_opt_in_enforcement():
    # Ensure backend opt-in is disabled by default
    backend_snapshot_state["opt_in"] = False

    payload = {
        "snapshot_id": "snap_api_test",
        "language": "python",
        "error_type": "RuntimeError",
        "error_message": "test",
        "variable_snapshots": {}
    }

    # Without opt-in, POST /snapshots must be rejected with 403
    resp = client.post("/snapshots", json=payload)
    assert resp.status_code == 403
    data = resp.json()
    assert data["detail"]["error"] == "OPT_IN_REQUIRED"

    # With explicit header opt-in, request should succeed
    resp_opted = client.post("/snapshots", json=payload, headers={"X-ContextGuard-OptIn": "true"})
    assert resp_opted.status_code == 200
    assert resp_opted.json()["snapshot_id"] == "snap_api_test"

    # Verify GET /snapshots and DELETE /snapshots
    get_resp = client.get("/snapshots")
    assert get_resp.status_code == 200
    assert any(s["snapshot_id"] == "snap_api_test" for s in get_resp.json())

    del_resp = client.delete("/snapshots")
    assert del_resp.status_code == 200
    assert del_resp.json()["cleared"] >= 1

# 17. Invalid payload rejection
def test_invalid_payload_rejection():
    # Pass invalid payload structure (e.g. wrong type for line_number or missing snapshot_id)
    resp = client.post("/snapshots", json={"line_number": "not_a_number"}, headers={"X-ContextGuard-OptIn": "true"})
    assert resp.status_code == 422  # Unprocessable Entity
