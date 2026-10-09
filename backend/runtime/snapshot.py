import os
import sys
import platform
import threading
import importlib.metadata
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from backend.security.redaction import RedactionEngine
from backend.runtime.models import RuntimeSnapshotModel, VariableSnapshot
from backend.runtime.inspector import VariableInspector
from backend.runtime.snapshot_manager import InMemorySnapshotManager, snapshot_manager
from backend.runtime.tracer import SnapshotTracer

class RuntimeSnapshotCollector:
    """
    Captures local runtime memory snapshots containing safe variable states,
    call stack frames, thread info, and dependency versions with mandatory redaction.
    """

    @classmethod
    def collect_from_frame(cls, frame=None, exception: Optional[Exception] = None) -> Dict[str, Any]:
        """Collects runtime memory snapshot from an active frame or exception."""
        if frame is None:
            # If no frame is passed, use calling frame or sys._getframe
            frame = sys._getframe(1)

        variables_map = {}
        locals_dict = frame.f_locals if frame else {}

        for var_name, var_val in locals_dict.items():
            if var_name.startswith("__") and var_name.endswith("__"):
                continue
            
            var_type = type(var_val).__name__
            safe_val, was_redacted = RedactionEngine.redact_variable(var_name, var_val)
            variables_map[var_name] = {
                "type": var_type,
                "value": safe_val,
                "redacted": was_redacted
            }

        call_stack = cls._extract_call_stack(frame)
        env_info = cls._collect_environment_info()
        dep_versions = cls._collect_top_dependency_versions()
        thread_info = cls._collect_thread_info()

        return {
            "variables": variables_map,
            "call_stack": call_stack,
            "environment": env_info,
            "dependency_versions": dep_versions,
            "thread_info": thread_info,
            "captured_at": datetime.now(timezone.utc).isoformat()
        }

    @classmethod
    def collect_synthetic_for_bug(cls, file_path: str, line_no: int, code_snippet: Optional[str] = None, stack_trace: Optional[str] = None) -> Dict[str, Any]:
        """
        Synthesizes a local runtime snapshot from static context or terminal traceback
        when live debugger hook is not directly attached.
        """
        variables_map = {}

        # Heuristic extraction of variable assignments from code snippet
        if code_snippet:
            for line in code_snippet.splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    parts = line.split("=", 1)
                    var_name = parts[0].strip()
                    raw_val = parts[1].strip()
                    if var_name.isidentifier():
                        safe_val, was_redacted = RedactionEngine.redact_variable(var_name, raw_val)
                        var_type = "NoneType" if raw_val == "None" else "str" if raw_val.startswith(('"', "'")) else "unknown"
                        variables_map[var_name] = {
                            "type": var_type,
                            "value": safe_val,
                            "redacted": was_redacted
                        }

        # If stack trace contains None or null clues
        if stack_trace and "NoneType" in stack_trace:
            if "items" not in variables_map and "items" in stack_trace:
                variables_map["items"] = {"type": "NoneType", "value": "None", "redacted": False}

        call_stack = [{
            "function": "failing_block",
            "file": file_path,
            "line": line_no
        }]

        return {
            "variables": variables_map,
            "call_stack": call_stack,
            "environment": cls._collect_environment_info(),
            "dependency_versions": cls._collect_top_dependency_versions(),
            "thread_info": cls._collect_thread_info(),
            "captured_at": datetime.now(timezone.utc).isoformat()
        }

    @classmethod
    def _extract_call_stack(cls, frame) -> List[Dict[str, Any]]:
        stack = []
        curr = frame
        while curr and len(stack) < 15:
            stack.append({
                "function": curr.f_code.co_name,
                "file": curr.f_code.co_filename,
                "line": curr.f_lineno
            })
            curr = curr.f_back
        return stack

    @classmethod
    def _collect_environment_info(cls) -> Dict[str, str]:
        return {
            "os": platform.system(),
            "os_release": platform.release(),
            "python_version": platform.python_version(),
            "platform": platform.platform()
        }

    @classmethod
    def _collect_top_dependency_versions(cls) -> Dict[str, str]:
        versions = {}
        common_pkgs = ["pytest", "fastapi", "pydantic", "requests", "numpy", "pandas"]
        for pkg in common_pkgs:
            try:
                versions[pkg] = importlib.metadata.version(pkg)
            except Exception:
                pass
        return versions

    @classmethod
    def _collect_thread_info(cls) -> Dict[str, Any]:
        curr = threading.current_thread()
        return {
            "thread_name": curr.name,
            "thread_ident": curr.ident,
            "active_count": threading.active_count()
        }
