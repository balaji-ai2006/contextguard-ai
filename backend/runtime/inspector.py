import re
import types
from typing import Any, Dict, Set, Tuple
from backend.runtime.models import VariableSnapshot
from backend.security.redaction import RedactionEngine

# Unsafe types that should never have user-defined __repr__ executed or internal state dumped
UNSAFE_TYPES = (
    types.ModuleType,
    types.FunctionType,
    types.MethodType,
    types.CodeType,
    types.FrameType,
    types.TracebackType,
    types.GeneratorType,
    types.CoroutineType,
    type,  # Class objects
)

# Standard safe built-in primitive types
PRIMITIVE_TYPES = (
    int,
    float,
    bool,
    str,
    bytes,
    type(None),
)

class VariableInspector:
    """
    Safely inspects and sanitizes runtime variables.
    Prevents arbitrary repr() execution, detects circular references,
    enforces length and variable limits, and applies secret redaction.
    """

    MAX_VARIABLES = 25
    MAX_PREVIEW_LENGTH = 120
    MAX_COLLECTION_ITEMS = 5

    SENSITIVE_VAR_KEYWORDS = {
        "password", "passwd", "pwd", "secret", "token", "auth", "api_key",
        "apikey", "access_token", "refresh_token", "private_key", "client_secret",
        "database_url", "db_pass", "conn_str", "connection_string", "credentials",
        "credential", "authorization", "bearer"
    }

    @classmethod
    def is_sensitive_name(cls, var_name: str) -> bool:
        lower = var_name.lower().replace("-", "_")
        return any(kw in lower for kw in cls.SENSITIVE_VAR_KEYWORDS)

    @classmethod
    def inspect_locals(
        cls,
        f_locals: Dict[str, Any],
        max_vars: int = MAX_VARIABLES,
        max_preview_len: int = MAX_PREVIEW_LENGTH
    ) -> Dict[str, VariableSnapshot]:
        """
        Inspects up to max_vars local variables from a frame's locals dictionary.
        Filters out internal dunder variables and safely serializes values.
        """
        snapshots: Dict[str, VariableSnapshot] = {}
        count = 0

        for name, val in f_locals.items():
            if name.startswith("__") and name.endswith("__"):
                continue
            if count >= max_vars:
                break

            snapshot = cls.inspect_variable(name, val, max_preview_len=max_preview_len)
            snapshots[name] = snapshot
            count += 1

        return snapshots

    @classmethod
    def inspect_variable(
        cls,
        var_name: str,
        value: Any,
        max_preview_len: int = MAX_PREVIEW_LENGTH
    ) -> VariableSnapshot:
        """
        Inspects a single variable with safety guards:
        1. Checks name-based secret redaction.
        2. Resolves safe type name.
        3. Formats preview without calling arbitrary unsafe repr().
        4. Detects circular references.
        5. Truncates large values.
        6. Scans content for secrets and redacts.
        """
        safe_type = cls._get_safe_type_name(value)

        # Name-based redaction check
        if cls.is_sensitive_name(var_name):
            return VariableSnapshot(
                name=var_name,
                type=safe_type,
                preview="[REDACTED_SECRET]",
                truncated=False,
                redacted=True
            )

        seen_ids: Set[int] = set()
        preview, was_truncated = cls._safe_format(value, seen_ids, max_preview_len)

        # Content-based secret redaction
        redacted_preview = RedactionEngine.redact_text(preview)
        was_redacted = redacted_preview != preview

        return VariableSnapshot(
            name=var_name,
            type=safe_type,
            preview=redacted_preview,
            truncated=was_truncated,
            redacted=was_redacted
        )

    @classmethod
    def _get_safe_type_name(cls, value: Any) -> str:
        try:
            return type(value).__name__
        except Exception:
            return "unknown"

    @classmethod
    def _safe_format(
        cls,
        value: Any,
        seen_ids: Set[int],
        max_len: int
    ) -> Tuple[str, bool]:
        """
        Formats a preview safely without executing user-defined repr() on unknown classes.
        Returns (preview_string, was_truncated).
        """
        # Circular reference check
        val_id = id(value)
        if val_id in seen_ids:
            return "<circular reference>", False

        # NoneType
        if value is None:
            return "None", False

        # Primitives
        if isinstance(value, (int, float, bool)):
            s = str(value)
            if len(s) > max_len:
                return s[:max_len] + "... [TRUNCATED]", True
            return s, False

        # String
        if isinstance(value, str):
            if len(value) > max_len:
                return repr(value[:max_len])[1:-1] + "... [TRUNCATED]", True
            return repr(value), False

        # Bytes
        if isinstance(value, (bytes, bytearray)):
            if len(value) > max_len:
                return repr(value[:32]) + f"... ({len(value)} bytes) [TRUNCATED]", True
            return repr(value), False

        # Unsafe types: modules, functions, classes, frames, tracebacks, etc.
        if isinstance(value, UNSAFE_TYPES):
            type_name = cls._get_safe_type_name(value)
            name = getattr(value, "__name__", getattr(value, "f_code", None) and value.f_code.co_name or "unknown")
            return f"<{type_name} '{name}'>", False

        # Check for open file handles / sockets / streams
        if hasattr(value, "read") or hasattr(value, "fileno"):
            type_name = cls._get_safe_type_name(value)
            return f"<{type_name} stream/file>", False

        seen_ids.add(val_id)
        try:
            # Lists and tuples
            if isinstance(value, (list, tuple)):
                is_tuple = isinstance(value, tuple)
                open_bracket = "(" if is_tuple else "["
                close_bracket = ")" if is_tuple else "]"
                total_items = len(value)
                truncated = total_items > cls.MAX_COLLECTION_ITEMS

                items_to_show = value[:cls.MAX_COLLECTION_ITEMS]
                item_previews = []
                for item in items_to_show:
                    ip, _ = cls._safe_format(item, seen_ids, 20)
                    item_previews.append(ip)

                joined = ", ".join(item_previews)
                if truncated:
                    preview = f"{open_bracket}{joined}, ... ({total_items} items){close_bracket}"
                else:
                    preview = f"{open_bracket}{joined}{close_bracket}"

                if len(preview) > max_len:
                    return preview[:max_len] + "... [TRUNCATED]", True
                return preview, truncated

            # Sets
            if isinstance(value, (set, frozenset)):
                total_items = len(value)
                truncated = total_items > cls.MAX_COLLECTION_ITEMS
                item_previews = []
                for idx, item in enumerate(value):
                    if idx >= cls.MAX_COLLECTION_ITEMS:
                        break
                    ip, _ = cls._safe_format(item, seen_ids, 20)
                    item_previews.append(ip)

                joined = ", ".join(item_previews)
                if truncated:
                    preview = f"{{{joined}, ... ({total_items} items)}}"
                else:
                    preview = f"{{{joined}}}"

                if len(preview) > max_len:
                    return preview[:max_len] + "... [TRUNCATED]", True
                return preview, truncated

            # Dictionaries
            if isinstance(value, dict):
                total_items = len(value)
                truncated = total_items > cls.MAX_COLLECTION_ITEMS
                pairs = []
                for idx, (k, v) in enumerate(value.items()):
                    if idx >= cls.MAX_COLLECTION_ITEMS:
                        break
                    kp, _ = cls._safe_format(k, seen_ids, 15)
                    vp, _ = cls._safe_format(v, seen_ids, 15)
                    pairs.append(f"{kp}: {vp}")

                joined = ", ".join(pairs)
                if truncated:
                    preview = f"{{{joined}, ... ({total_items} keys)}}"
                else:
                    preview = f"{{{joined}}}"

                if len(preview) > max_len:
                    return preview[:max_len] + "... [TRUNCATED]", True
                return preview, truncated

            # Custom user-defined objects:
            # NEVER execute arbitrary user-defined __repr__!
            # Check if __repr__ is from builtins/object
            type_obj = type(value)
            if hasattr(type_obj, "__repr__") and type_obj.__repr__ is object.__repr__:
                return f"<{type_obj.__name__} object at {hex(val_id)}>", False
            
            # If standard exception instance:
            if isinstance(value, Exception):
                return f"{type_obj.__name__}('{str(value)[:max_len]}')", False

            # For other custom classes, return safe descriptor without evaluating arbitrary user code
            return f"<{type_obj.__name__} instance at {hex(val_id)}>", False

        finally:
            seen_ids.discard(val_id)
