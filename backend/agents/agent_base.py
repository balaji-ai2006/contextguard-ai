import os
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
from backend.security.redaction import RedactionEngine

class BaseAgent:
    """
    Base Agent providing structured JSON communication, Ollama LLM queries,
    and automatic fallback to local symbolic reasoning engine.
    """

    def __init__(self, agent_name: str, model_name: str = "deepseek-coder:latest", ollama_host: str = "http://127.0.0.1:11434"):
        self.agent_name = agent_name
        self.model_name = os.environ.get("CONTEXTGUARD_OLLAMA_MODEL", model_name)
        self.ollama_host = os.environ.get("CONTEXTGUARD_OLLAMA_HOST", ollama_host)

    @staticmethod
    def is_local_host(host_url: str) -> bool:
        if not host_url:
            return True
        lower = host_url.lower()
        return any(h in lower for h in ("127.0.0.1", "localhost", "::1", "0.0.0.0"))

    def query_llm(self, prompt: str, system_prompt: str, allow_external: bool = False) -> Optional[Dict[str, Any]]:
        """
        Sends query to local Ollama instance with structured JSON format enforcement.
        Enforces zero-trust: prompt is sanitized through RedactionEngine.
        Blocks external transmission unless explicitly authorized.
        """
        # Enforce local-only network boundary unless explicitly authorized
        if not allow_external and not self.is_local_host(self.ollama_host):
            return None

        sanitized_prompt = RedactionEngine.redact_text(prompt)

        payload = {
            "model": self.model_name,
            "system": system_prompt + "\nYou MUST respond ONLY in valid JSON format.",
            "prompt": sanitized_prompt,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0.1
            }
        }

        try:
            req = urllib.request.Request(
                f"{self.ollama_host}/api/generate",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=12) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    res_text = data.get("response", "")
                    return json.loads(res_text)
        except Exception:
            # Fall back gracefully to local deterministic reasoning engine
            return None
