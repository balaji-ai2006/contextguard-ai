import shutil
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Request, Header, Query
from backend.api.models import (
    HealthResponse,
    InvestigateRequest,
    PreviewPatchRequest,
    ApplyPatchRequest,
    VerifyPatchRequest,
    RejectPatchRequest,
    RollbackRequest,
    FeedbackRequest,
    DetectASTRequest,
    DetectTracebackRequest,
    DetectResponse,
    SnapshotOptInRequest,
    SnapshotOptInResponse,
    ClearSnapshotsResponse
)
from backend.runtime.models import RuntimeSnapshotModel
from backend.runtime.snapshot_manager import snapshot_manager
from backend.security.redaction import RedactionEngine

router = APIRouter()

# Backend snapshot ingestion state (disabled by default)
backend_snapshot_state = {"opt_in": False}
MAX_PAYLOAD_BYTES = 65536  # 64 KB limit
MAX_VARIABLES_COUNT = 50

def is_ollama_available() -> bool:
    return shutil.which("ollama") is not None

def is_docker_available() -> bool:
    return shutil.which("docker") is not None

@router.get("/health", response_model=HealthResponse)
def get_health():
    return HealthResponse(
        status="healthy",
        version="0.1.0",
        privacy_mode="local",
        ollama_available=is_ollama_available(),
        docker_available=is_docker_available(),
        active_model="deepseek-coder:latest"
    )

@router.post("/api/investigate")
def investigate_bug(req: InvestigateRequest):
    from backend.verification.orchestrator import InvestigationOrchestrator
    orchestrator = InvestigationOrchestrator()
    result = orchestrator.investigate(req)
    return result

@router.post("/api/patch/preview")
def preview_patch(req: PreviewPatchRequest):
    from backend.verification.pipeline import PatchVerificationPipeline
    pipeline = PatchVerificationPipeline()
    return pipeline.preview_patch(req.file_path, req.diff, req.original_hash)

@router.post("/api/patch/apply")
def apply_patch(req: ApplyPatchRequest):
    if not req.user_approved:
        raise HTTPException(status_code=400, detail="Explicit user approval required to apply patch.")
    from backend.git.intelligence import GitIntelligence
    git_engine = GitIntelligence()
    res = git_engine.safe_apply_patch(
        file_path=req.file_path,
        diff_or_content=req.diff,
        patch_id=req.patch_id,
        original_file_hash=req.original_file_hash
    )
    return res

@router.post("/api/patch/reject")
def reject_patch(req: RejectPatchRequest):
    from backend.knowledge.feedback import FeedbackManager
    fb = FeedbackManager()
    res = fb.record_feedback(req.patch_id, "rejected", req.reason)
    return {"success": True, "message": "Patch proposal rejected.", "patch_id": req.patch_id}

@router.post("/api/verify")
def verify_candidate_patch(req: VerifyPatchRequest):
    from backend.verification.pipeline import PatchVerificationPipeline
    pipeline = PatchVerificationPipeline()
    res = pipeline.verify_patch(
        candidate_patch=req.candidate_patch,
        bug_info=req.bug.model_dump(),
        reproduction_test_code=req.reproduction_test_code,
        workspace_root=req.workspace_root
    )
    return res

@router.post("/api/patch/rollback")
def rollback_patch(req: RollbackRequest):
    from backend.git.intelligence import GitIntelligence
    git_engine = GitIntelligence()
    res = git_engine.rollback(req.patch_id)
    return res

@router.post("/api/feedback")
def submit_feedback(req: FeedbackRequest):
    from backend.knowledge.feedback import FeedbackManager
    fb = FeedbackManager()
    res = fb.record_feedback(req.patch_id, req.feedback, req.comments)
    return res

@router.post("/api/detect/ast", response_model=DetectResponse)
def detect_ast_anomalies(req: DetectASTRequest):
    from backend.parser.python_parser import PythonASTAnalyzer
    analyzer = PythonASTAnalyzer(source_code=req.source_code, file_path=req.file_path)
    bugs = analyzer.analyze()
    return DetectResponse(count=len(bugs), bugs=bugs)

@router.post("/api/detect/traceback", response_model=DetectResponse)
def detect_traceback_anomalies(req: DetectTracebackRequest):
    from backend.parser.traceback_parser import TracebackParser
    bug = TracebackParser.parse(req.text)
    bugs = [bug] if bug else []
    return DetectResponse(count=len(bugs), bugs=bugs)

@router.get("/snapshots/opt-in", response_model=SnapshotOptInResponse)
def get_snapshot_opt_in_status():
    return SnapshotOptInResponse(
        snapshots_enabled=backend_snapshot_state["opt_in"],
        message="Backend snapshot transmission status"
    )

@router.post("/snapshots/opt-in", response_model=SnapshotOptInResponse)
def set_snapshot_opt_in(req: SnapshotOptInRequest):
    backend_snapshot_state["opt_in"] = req.enabled
    return SnapshotOptInResponse(
        snapshots_enabled=backend_snapshot_state["opt_in"],
        message=f"Backend snapshot transmission is now {'enabled' if req.enabled else 'disabled'}."
    )

@router.post("/snapshots", response_model=RuntimeSnapshotModel)
async def create_snapshot(
    req: RuntimeSnapshotModel,
    request: Request,
    x_opt_in: Optional[str] = Header(None, alias="X-ContextGuard-OptIn"),
    opt_in: Optional[bool] = Query(None)
):
    # Opt-in enforcement: disabled by default
    has_opt_in = (
        backend_snapshot_state["opt_in"]
        or (x_opt_in is not None and x_opt_in.lower() in ("true", "1"))
        or (opt_in is True)
    )
    if not has_opt_in:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "OPT_IN_REQUIRED",
                "message": "Backend snapshot transmission is disabled by default. Explicit developer opt-in is required."
            }
        )

    # Size limit enforcement
    body_bytes = await request.body()
    if len(body_bytes) > MAX_PAYLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "error": "PAYLOAD_TOO_LARGE",
                "message": f"Snapshot payload size ({len(body_bytes)} bytes) exceeds limit ({MAX_PAYLOAD_BYTES} bytes)."
            }
        )

    if len(req.variable_snapshots) > MAX_VARIABLES_COUNT:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "TOO_MANY_VARIABLES",
                "message": f"Snapshot variable count ({len(req.variable_snapshots)}) exceeds limit ({MAX_VARIABLES_COUNT})."
            }
        )

    # Sanitize and ensure redaction on any ingested snapshot data
    for var_name, var_snap in req.variable_snapshots.items():
        if any(kw in var_name.lower() for kw in ("password", "secret", "token", "api_key", "auth", "credential", "private_key")):
            var_snap.preview = "[REDACTED_SECRET]"
            var_snap.redacted = True
        else:
            redacted_preview = RedactionEngine.redact_text(var_snap.preview)
            if redacted_preview != var_snap.preview:
                var_snap.preview = redacted_preview
                var_snap.redacted = True

    # Note: Variable contents are intentionally NOT logged to protect privacy
    saved = snapshot_manager.add_snapshot(req)
    return saved

@router.get("/snapshots", response_model=List[RuntimeSnapshotModel])
def list_snapshots(limit: Optional[int] = Query(default=50, ge=1, le=100)):
    return snapshot_manager.list_snapshots(limit=limit)

@router.get("/snapshots/{snapshot_id}", response_model=RuntimeSnapshotModel)
def get_snapshot(snapshot_id: str):
    snap = snapshot_manager.get_snapshot(snapshot_id)
    if not snap:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "SNAPSHOT_NOT_FOUND",
                "message": f"Runtime snapshot '{snapshot_id}' not found."
            }
        )
    return snap

@router.delete("/snapshots", response_model=ClearSnapshotsResponse)
def clear_snapshots():
    count = snapshot_manager.clear_snapshots()
    return ClearSnapshotsResponse(
        cleared=count,
        message=f"Successfully cleared {count} in-memory runtime snapshot(s)."
    )

