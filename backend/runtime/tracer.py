import sys
import uuid
import linecache
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple
from backend.runtime.models import RuntimeSnapshotModel
from backend.runtime.inspector import VariableInspector
from backend.runtime.snapshot_manager import snapshot_manager

class SnapshotTracer:
    """
    Opt-in execution tracer using Python's sys.settrace.
    Captures runtime memory state, local variables, and diagnostic context
    at the exact moment an exception is raised in user code.
    """

    def __init__(self, target_file: Optional[str] = None):
        self.target_file = target_file
        self.last_snapshot: Optional[RuntimeSnapshotModel] = None
        self._is_tracing = False
        self._prev_trace = None
        self._last_exc: Optional[BaseException] = None

    def start(self):
        """Explicitly starts tracing. Will not trace unless start() is called."""
        if not self._is_tracing:
            self._last_exc = None
            self._prev_trace = sys.gettrace()
            sys.settrace(self._trace_dispatch)
            self._is_tracing = True

    def stop(self):
        """Stops tracing and restores previous trace function."""
        if self._is_tracing:
            sys.settrace(self._prev_trace)
            self._is_tracing = False

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()
        if exc_val is not None and not self.last_snapshot:
            # Capture from exception if traceback is available
            tb = exc_tb
            while tb and tb.tb_next:
                tb = tb.tb_next
            if tb:
                self._capture_frame(tb.tb_frame, exc_val)
        return False  # Do not suppress the exception

    def _trace_dispatch(self, frame, event, arg):
        if event == "call":
            return self._trace_dispatch
        elif event == "exception":
            exc_type, exc_val, exc_tb = arg
            # Only capture if not an internal control-flow exception
            if not issubclass(exc_type, (StopIteration, GeneratorExit, KeyboardInterrupt)):
                self._handle_exception_event(frame, exc_val)
        return self._trace_dispatch

    def _handle_exception_event(self, frame, exc_val: BaseException):
        filename = frame.f_code.co_filename
        # Avoid tracing into standard library internals or pytest runner frames
        if ("<frozen" in filename or
            "importlib" in filename or
            ("lib" in filename.lower() and "site-packages" in filename.lower() and "contextguard" not in filename.lower())):
            return

        # If a specific target file was requested, check it
        if self.target_file and self.target_file not in filename:
            return

        # Do not overwrite the innermost originating frame for the same exception instance
        if self._last_exc is exc_val:
            return

        self._last_exc = exc_val
        self._capture_frame(frame, exc_val)

    def _capture_frame(self, frame, exc_val: BaseException):
        try:
            filename = frame.f_code.co_filename
            lineno = frame.f_lineno
            func_name = frame.f_code.co_name
            exc_type_name = type(exc_val).__name__
            exc_msg = str(exc_val)

            # Read source line
            line_content = linecache.getline(filename, lineno).strip()

            # Inspect variables
            var_snapshots = VariableInspector.inspect_locals(frame.f_locals)

            # Synthesize diagnostic info & heuristic explanation
            failed_expr, explanation = self._analyze_failure(
                exc_type_name, exc_msg, line_content, frame.f_locals
            )

            # Build call stack frames
            call_stack = []
            curr = frame
            while curr and len(call_stack) < 10:
                call_stack.append({
                    "function": curr.f_code.co_name,
                    "file": curr.f_code.co_filename,
                    "line": curr.f_lineno
                })
                curr = curr.f_back

            snap = RuntimeSnapshotModel(
                snapshot_id=f"snap_{uuid.uuid4().hex[:12]}",
                timestamp=datetime.now(timezone.utc).isoformat(),
                language="python",
                error_type=exc_type_name,
                error_message=exc_msg,
                file_path=filename,
                line_number=lineno,
                function_name=func_name,
                variable_snapshots=var_snapshots,
                capture_method="sys_settrace",
                capture_status="success",
                failed_expression=failed_expr,
                heuristic_explanation=explanation,
                call_stack=call_stack
            )

            self.last_snapshot = snap
            snapshot_manager.add_snapshot(snap)
        except Exception as e:
            # Fallback safe capture on unexpected inspection error
            fallback_snap = RuntimeSnapshotModel(
                snapshot_id=f"snap_{uuid.uuid4().hex[:12]}",
                timestamp=datetime.now(timezone.utc).isoformat(),
                language="python",
                error_type=type(exc_val).__name__,
                error_message=str(exc_val),
                capture_method="sys_settrace",
                capture_status="partial",
                heuristic_explanation=f"Partial inspection due to: {str(e)}"
            )
            self.last_snapshot = fallback_snap
            snapshot_manager.add_snapshot(fallback_snap)

    @classmethod
    def _analyze_failure(
        cls,
        exc_type: str,
        exc_msg: str,
        line_content: str,
        f_locals: Dict[str, Any]
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Dynamically analyzes the failed code expression and local variables
        to produce a likely heuristic explanation without hardcoding values.
        """
        failed_expr: Optional[str] = None
        explanation: Optional[str] = None

        if exc_type == "AttributeError":
            # e.g., "'NoneType' object has no attribute 'upper'"
            attr_match = re.search(r"attribute ['\"](\w+)['\"]", exc_msg)
            if attr_match:
                attr_name = attr_match.group(1)
                # Look for <var>.<attr> in line_content
                pattern = rf"([a-zA-Z_]\w*)\.{re.escape(attr_name)}"
                m = re.search(pattern, line_content)
                if m:
                    var_name = m.group(1)
                    val = f_locals.get(var_name)
                    # Expression like name.upper()
                    expr_call_match = re.search(rf"([a-zA-Z_]\w*\.{re.escape(attr_name)}(?:\([^\)]*\))?)", line_content)
                    failed_expr = expr_call_match.group(1) if expr_call_match else f"{var_name}.{attr_name}"
                    
                    if val is None:
                        explanation = f"Variable '{var_name}' is None when {attr_name}() is called."
                    else:
                        explanation = f"Variable '{var_name}' of type {type(val).__name__} has no attribute '{attr_name}'."
                else:
                    # If line_content is not available or pattern didn't match, check f_locals
                    none_vars = [k for k, v in f_locals.items() if v is None and not k.startswith("__")]
                    if "NoneType" in exc_msg and len(none_vars) >= 1:
                        var_name = none_vars[0]
                        failed_expr = f"{var_name}.{attr_name}()"
                        explanation = f"Variable '{var_name}' is None when {attr_name}() is called."
                    else:
                        failed_expr = f".{attr_name}"
                        explanation = f"Attempted to access attribute '{attr_name}' on an object that does not support it ({exc_msg})."

        elif exc_type == "TypeError":
            if "NoneType" in exc_msg:
                # e.g., "'NoneType' object is not iterable" or "'NoneType' object is not subscriptable"
                # Check which local variable is None
                none_vars = [k for k, v in f_locals.items() if v is None and not k.startswith("__")]
                matched_var = None
                for nv in none_vars:
                    if re.search(rf"\b{re.escape(nv)}\b", line_content):
                        matched_var = nv
                        break

                if matched_var:
                    failed_expr = matched_var
                    explanation = f"Variable '{matched_var}' is None at runtime ({exc_msg})."
                else:
                    explanation = f"Runtime TypeError involving None value: {exc_msg}."
            elif "unsupported operand type" in exc_msg:
                explanation = f"Operator mismatch on line '{line_content}': {exc_msg}."
                failed_expr = line_content

        elif exc_type == "ZeroDivisionError":
            failed_expr = line_content or "/"
            explanation = "Division by zero occurred during expression evaluation."

        elif exc_type == "KeyError":
            key_match = re.search(r"['\"]([^'\"]+)['\"]", exc_msg)
            key_name = key_match.group(1) if key_match else exc_msg
            failed_expr = f"[{key_name}]"
            explanation = f"Key '{key_name}' does not exist in the accessed dictionary."

        elif exc_type == "IndexError":
            failed_expr = line_content
            explanation = "Attempted to access index outside the valid bounds of sequence."

        elif exc_type == "NameError":
            name_match = re.search(r"name ['\"](\w+)['\"]", exc_msg)
            name_val = name_match.group(1) if name_match else "variable"
            failed_expr = name_val
            explanation = f"Identifier '{name_val}' is referenced before assignment or not defined."

        if not failed_expr and line_content:
            failed_expr = line_content
        if not explanation and exc_msg:
            explanation = f"Failure caused by {exc_type}: {exc_msg}."

        return failed_expr, explanation
