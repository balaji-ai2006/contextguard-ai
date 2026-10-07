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

class ApplyPatchRequest(BaseModel):
    patch_id: str
    file_path: str
    diff: str

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
