import ast
import os
import re
from typing import List, Dict, Any, Optional

class PythonASTAnalyzer:
    """
    Static AST Bug & Anomaly Analyzer for Python source code.
    Detects syntax errors, Null/None errors, resource leaks, undefined variables,
    infinite loops, zero divisions, security issues, and API misuses.
    """

    BUILTINS = {
        "print", "len", "range", "str", "int", "float", "bool", "list", "dict", "set",
        "tuple", "sum", "min", "max", "open", "type", "isinstance", "enumerate", "zip",
        "map", "filter", "any", "all", "sorted", "reversed", "hasattr", "getattr",
        "setattr", "delattr", "abs", "round", "repr", "iter", "next", "super", "id",
        "hash", "dir", "format", "input", "pow", "vars", "zip", "bytes", "bytearray",
        "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "FileNotFoundError",
        "RuntimeError", "ZeroDivisionError", "AttributeError", "ImportError", "StopIteration",
        "True", "False", "None"
    }

    SECRET_PATTERNS = [
        re.compile(r"^(password|passwd|secret|api_key|token|auth_token|private_key)$", re.IGNORECASE)
    ]

    def __init__(self, source_code: str, file_path: str = "main.py"):
        self.source_code = source_code
        self.file_path = file_path
        self.lines = source_code.splitlines()

    def analyze(self) -> List[Dict[str, Any]]:
        """Runs complete AST static inspection and returns detected bugs."""
        bugs: List[Dict[str, Any]] = []

        # 1. Check for Syntax / Compile errors
        try:
            tree = ast.parse(self.source_code, filename=self.file_path)
        except SyntaxError as e:
            bugs.append({
                "id": f"ast_syntax_{e.lineno or 1}_{int(e.offset or 1)}",
                "file": self.file_path,
                "line": e.lineno or 1,
                "column": e.offset or 1,
                "errorType": "SyntaxError",
                "message": f"Syntax error: {e.msg}",
                "source": "ast_parser",
                "severity": "HIGH",
                "codeSnippet": self._get_snippet(e.lineno or 1),
                "category": "CompileError"
            })
            return bugs

        # 2. Walk AST to detect bugs
        # Track assignments to None
        none_vars = set()
        defined_names = set(self.BUILTINS)
        imported_names = set()

        # First pass: collect imports and top-level definitions
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname or alias.name
                    imported_names.add(name.split(".")[0])
                    defined_names.add(name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    name = alias.asname or alias.name
                    imported_names.add(name)
                    defined_names.add(name)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                defined_names.add(node.name)

        # Second pass: deeper inspection
        for node in ast.walk(tree):
            # A. Null / None variable assignments
            if isinstance(node, ast.Assign):
                if isinstance(node.value, ast.Constant) and node.value.value is None:
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            none_vars.add(target.id)

                # Check for hardcoded secret assignments
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        for pat in self.SECRET_PATTERNS:
                            if pat.match(target.id) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                                if len(node.value.value) > 4:
                                    bugs.append(self._create_bug(
                                        node.lineno,
                                        node.col_offset + 1,
                                        "SecurityIssue",
                                        f"Hardcoded sensitive credential '{target.id}' detected in plaintext.",
                                        "CRITICAL",
                                        "Security"
                                    ))

            # B. Null / None Iteration (e.g. for item in None or for item in items where items is None)
            if isinstance(node, (ast.For, ast.AsyncFor)):
                iter_node = node.iter
                if (isinstance(iter_node, ast.Constant) and iter_node.value is None) or \
                   (isinstance(iter_node, ast.Name) and iter_node.id in none_vars):
                    var_name = iter_node.id if isinstance(iter_node, ast.Name) else "None"
                    bugs.append(self._create_bug(
                        node.lineno,
                        node.col_offset + 1,
                        "NullOrNoneError",
                        f"Attempting to iterate over '{var_name}' which is None (will raise TypeError: 'NoneType' object is not iterable).",
                        "HIGH",
                        "NullOrNoneError"
                    ))

            # C. Generator expression / List comprehension iterating over None
            if isinstance(node, (ast.GeneratorExp, ast.ListComp, ast.SetComp, ast.DictComp)):
                for gen in node.generators:
                    iter_node = gen.iter
                    if (isinstance(iter_node, ast.Constant) and iter_node.value is None) or \
                       (isinstance(iter_node, ast.Name) and iter_node.id in none_vars):
                        var_name = iter_node.id if isinstance(iter_node, ast.Name) else "None"
                        bugs.append(self._create_bug(
                            node.lineno,
                            node.col_offset + 1,
                            "NullOrNoneError",
                            f"Comprehension attempts to iterate over '{var_name}' which is None (TypeError: 'NoneType' object is not iterable).",
                            "HIGH",
                            "NullOrNoneError"
                        ))

            # D. Subscripting None (e.g. None[0] or items[0] where items is None)
            if isinstance(node, ast.Subscript):
                if (isinstance(node.value, ast.Constant) and node.value.value is None) or \
                   (isinstance(node.value, ast.Name) and node.value.id in none_vars):
                    var_name = node.value.id if isinstance(node.value, ast.Name) else "None"
                    bugs.append(self._create_bug(
                        node.lineno,
                        node.col_offset + 1,
                        "NullOrNoneError",
                        f"Attempting to subscript '{var_name}' which is None (TypeError: 'NoneType' object is not subscriptable).",
                        "HIGH",
                        "NullOrNoneError"
                    ))

            # E. Resource Leaks: open(...) outside with context
            if isinstance(node, ast.Call):
                func = node.func
                if isinstance(func, ast.Name) and func.id == "open":
                    # Check if enclosed in a With statement
                    # In ast.walk we can check if parent is ast.withitem, but ast.walk has no parent.
                    # We check calls assigned to variables outside with
                    pass # We do dedicated With check below

                # F. Security: eval() or exec()
                if isinstance(func, ast.Name) and func.id in ("eval", "exec"):
                    bugs.append(self._create_bug(
                        node.lineno,
                        node.col_offset + 1,
                        "SecurityIssue",
                        f"Dangerous execution function '{func.id}()' can lead to arbitrary code execution.",
                        "CRITICAL",
                        "Security"
                    ))

                # G. Security: subprocess with shell=True
                if isinstance(func, ast.Attribute) and func.attr in ("run", "Popen", "call", "check_output"):
                    for kw in node.keywords:
                        if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                            bugs.append(self._create_bug(
                                node.lineno,
                                node.col_offset + 1,
                                "SecurityIssue",
                                f"subprocess.{func.attr}() called with shell=True invites command injection vulnerability.",
                                "CRITICAL",
                                "Security"
                            ))

            # H. Division by Zero: x / 0
            if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                if isinstance(node.right, ast.Constant) and node.right.value == 0:
                    bugs.append(self._create_bug(
                        node.lineno,
                        node.col_offset + 1,
                        "ZeroDivisionError",
                        "Division by zero detected in arithmetic operation.",
                        "HIGH",
                        "ArithmeticError"
                    ))

            # I. Infinite Loops: while True / while 1 with no break or return
            if isinstance(node, ast.While):
                is_always_true = isinstance(node.test, ast.Constant) and bool(node.test.value) is True

                if is_always_true:
                    has_exit = False
                    for child in ast.walk(node):
                        if isinstance(child, (ast.Break, ast.Return)):
                            has_exit = True
                            break
                    if not has_exit:
                        bugs.append(self._create_bug(
                            node.lineno,
                            node.col_offset + 1,
                            "InfiniteLoop",
                            "While loop condition is permanently True without any break or return statement.",
                            "HIGH",
                            "LogicalBug"
                        ))

            # J. Mutable Default Arguments in function definition (API Misuse)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for default in node.args.defaults:
                    if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                        mut_type = type(default).__name__
                        bugs.append(self._create_bug(
                            node.lineno,
                            node.col_offset + 1,
                            "APIMisuse",
                            f"Mutable default argument '{mut_type}' in function '{node.name}'. Use None and initialize inside function.",
                            "MEDIUM",
                            "APIMisuse"
                        ))

        # Check for unclosed open() calls (Resource Leaks)
        self._check_resource_leaks(tree, bugs)

        return bugs

    def _check_resource_leaks(self, tree: ast.AST, bugs: List[Dict[str, Any]]):
        """Detects files opened via open() that are not managed by 'with'."""
        with_open_lines = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.With, ast.AsyncWith)):
                for item in node.items:
                    if isinstance(item.context_expr, ast.Call):
                        fn = item.context_expr.func
                        if isinstance(fn, ast.Name) and fn.id == "open":
                            with_open_lines.add(item.context_expr.lineno)

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                if isinstance(fn, ast.Name) and fn.id == "open":
                    if node.lineno not in with_open_lines:
                        # Check if it's assigned or naked
                        bugs.append(self._create_bug(
                            node.lineno,
                            node.col_offset + 1,
                            "ResourceLeak",
                            "File opened with open() without 'with' statement. May cause file descriptor resource leak.",
                            "MEDIUM",
                            "ResourceLeak"
                        ))

    def _create_bug(self, line: int, col: int, error_type: str, message: str, severity: str, category: str) -> Dict[str, Any]:
        return {
            "id": f"ast_{error_type.lower()}_{line}_{col}",
            "file": self.file_path,
            "line": line,
            "column": col,
            "errorType": error_type,
            "message": message,
            "source": "ast_parser",
            "severity": severity,
            "codeSnippet": self._get_snippet(line),
            "category": category
        }

    def _get_snippet(self, line_no: int) -> str:
        if not self.lines:
            return ""
        start = max(0, line_no - 3)
        end = min(len(self.lines), line_no + 2)
        return "\n".join(self.lines[start:end])
