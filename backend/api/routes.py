import shutil
from fastapi import APIRouter, HTTPException
from backend.api.models import (
    HealthResponse,
    InvestigateRequest,
    ApplyPatchRequest,
    RollbackRequest,
    FeedbackRequest
)

router = APIRouter()

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
    # This will integrate the full pipeline:
    # 1. Local context collection
    # 2. Secret redaction
    # 3. Bug reproduction
    # 4. Root cause analysis
    # 5. Fix generation
    # 6. Isolated verification
    # 7. Confidence calculation
    from backend.verification.orchestrator import InvestigationOrchestrator
    orchestrator = InvestigationOrchestrator()
    result = orchestrator.investigate(req)
    return result

@router.post("/api/patch/apply")
def apply_patch(req: ApplyPatchRequest):
    from backend.git.intelligence import GitIntelligence
    git_engine = GitIntelligence()
    res = git_engine.safe_apply_patch(req.file_path, req.diff, req.patch_id)
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
