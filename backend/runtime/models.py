from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

class VariableSnapshot(BaseModel):
    name: str = Field(..., max_length=128)
    type: str = Field(..., max_length=128)
    preview: str = Field(..., max_length=1000)
    truncated: bool = False
    redacted: bool = False

class RuntimeSnapshotModel(BaseModel):
    snapshot_id: str = Field(..., description="Unique identifier for the snapshot")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    language: str = "python"
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    function_name: Optional[str] = None
    variable_snapshots: Dict[str, VariableSnapshot] = Field(default_factory=dict)
    capture_method: str = Field(default="sys_settrace", description="sys_settrace | dap_debugger | diagnostic_runner | frame_inspection")
    capture_status: str = Field(default="success", description="success | partial | unavailable | error")
    failed_expression: Optional[str] = None
    heuristic_explanation: Optional[str] = None
    call_stack: Optional[List[Dict[str, Any]]] = None

    model_config = {"extra": "allow"}
