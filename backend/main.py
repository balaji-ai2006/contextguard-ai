import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.routes import router

app = FastAPI(
    title="ContextGuard AI — Autonomous Bug Detection, Fix & Verification Engine",
    description="Privacy-first, autonomous local debugging engine with minimal reproduction and sandbox verification.",
    version="0.1.0"
)

# Enable CORS for local VS Code webviews and local tools
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

def start():
    port = int(os.environ.get("CONTEXTGUARD_PORT", "8765"))
    uvicorn.run("backend.main:app", host="127.0.0.1", port=port, reload=False, log_level="info")

if __name__ == "__main__":
    start()
