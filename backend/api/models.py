from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class DetectedBugRequest(BaseModel):
    id: str
    file: str
    line: int
    column: int = 1
    errorType: str
    message: str
    source: str = "manual"
    severity: str = "HIGH"
    codeSnippet: Optional[str] = None
    stackTrace: Optional[str] = None
    timestamp: Optional[str] = None

class InvestigateRequest(BaseModel):
    bug: DetectedBugRequest
    workspace_root: Optional[str] = None
    privacy_mode: str = "local"

class PreviewPatchRequest(BaseModel):
    patch_id: str
    file_path: str
    diff: str
    original_hash: Optional[str] = None

class ApplyPatchRequest(BaseModel):
    patch_id: str
    file_path: str
    diff: str
    original_file_hash: Optional[str] = None
    user_approved: bool = True

class VerifyPatchRequest(BaseModel):
    candidate_patch: Dict[str, Any]
    bug: DetectedBugRequest
    reproduction_test_code: Optional[str] = None
    workspace_root: Optional[str] = None

class RejectPatchRequest(BaseModel):
    patch_id: str
    reason: Optional[str] = "User rejected proposed patch."

class RollbackRequest(BaseModel):
    patch_id: Optional[str] = None

class FeedbackRequest(BaseModel):
    patch_id: str
    feedback: str # 'fixed', 'not_fixed', 'partially_fixed'
    comments: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    version: str
    privacy_mode: str
    ollama_available: bool
    docker_available: bool
    active_model: str

class DetectASTRequest(BaseModel):
    source_code: str
    file_path: str = "main.py"
    language: str = "python"

class DetectTracebackRequest(BaseModel):
    text: str
    language: Optional[str] = None

class DetectResponse(BaseModel):
    count: int
    bugs: List[Dict[str, Any]]

class SnapshotOptInRequest(BaseModel):
    enabled: bool

class SnapshotOptInResponse(BaseModel):
    snapshots_enabled: bool
    message: str

class ClearSnapshotsResponse(BaseModel):
    cleared: int
    message: str

