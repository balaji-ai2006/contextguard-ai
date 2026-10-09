import re
import os
from typing import Optional, Dict, Any, List

class TracebackParser:
    """
    Robust multi-language traceback and test framework failure parser.
    Extracts structured bug information, frame hierarchy, file locations,
    and error messages from terminal logs, test outputs, and exception streams.
    """

    @classmethod
    def parse(cls, text: str) -> Optional[Dict[str, Any]]:
        if not text or not text.strip():
            return None

        # 1. Check for Pytest test failure output
        pytest_bug = cls._parse_pytest(text)
        if pytest_bug:
            return pytest_bug

        # 2. Check for Standard Python traceback
        py_bug = cls._parse_python(text)
        if py_bug:
            return py_bug

        # 3. Check for Jest / Vitest test failure output
        jest_bug = cls._parse_jest(text)
        if jest_bug:
            return jest_bug

        # 4. Check for Node.js / TypeScript stack trace
        node_bug = cls._parse_node(text)
        if node_bug:
            return node_bug

        # 5. Check for Java stack trace
        java_bug = cls._parse_java(text)
        if java_bug:
            return java_bug

        # 6. Check for C++ compiler / runtime diagnostic
        cpp_bug = cls._parse_cpp(text)
        if cpp_bug:
            return cpp_bug

        return None

    @classmethod
    def _parse_python(cls, text: str) -> Optional[Dict[str, Any]]:
        # Python traceback regex
        # Traceback (most recent call last):
        #   File "foo.py", line 12, in bar
        #     code
        # TypeError: 'NoneType' object is not iterable
        pattern = re.compile(
            r'Traceback \(most recent call last\):[\s\S]*?'
            r'File ["\']([^"\']+)["\'], line (\d+)(?:, in ([^\r\n]+))?[\r\n]+'
            r'([\s\S]*?)'
            r'([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception|AssertionError)):[ ]*([^\r\n]+)'
        )
        match = pattern.search(text)
        if not match:
            return None

        # Also collect all frames
        frame_pattern = re.compile(r'File ["\']([^"\']+)["\'], line (\d+)(?:, in ([^\r\n]+))?')
        frames = []
        for f_match in frame_pattern.finditer(match.group(0)):
            frames.append({
                "file": f_match.group(1),
                "line": int(f_match.group(2)),
                "function": (f_match.group(3) or "").strip()
            })

        last_frame = frames[-1] if frames else {
            "file": match.group(1),
            "line": int(match.group(2)),
            "function": match.group(3) or ""
        }

        error_class = match.group(5)
        error_msg = match.group(6).strip()
        full_msg = f"{error_class}: {error_msg}"

        return {
            "id": f"term_py_{os.path.basename(last_frame['file'])}_{last_frame['line']}",
            "file": last_frame["file"],
            "line": last_frame["line"],
            "column": 1,
            "errorType": error_class,
            "message": full_msg,
            "source": "terminal",
            "severity": cls._classify_severity(full_msg),
            "stackTrace": match.group(0).strip(),
            "frames": frames,
            "language": "python"
        }

    @classmethod
    def _parse_pytest(cls, text: str) -> Optional[Dict[str, Any]]:
        # FAILED tests/test_cart.py::test_calc - TypeError: 'NoneType' object is not iterable
        pytest_pattern = re.compile(
            r"FAILED\s+([^\s:]+)(?:::([^\s]+))?\s+-\s+([A-Za-z0-9_]+Error|Exception|AssertionError):\s*([^\r\n]+)"
        )
        match = pytest_pattern.search(text)
        if match:
            test_file = match.group(1)
            test_func = match.group(2) or "test"
            error_class = match.group(3)
            error_msg = match.group(4).strip()
            full_msg = f"{error_class}: {error_msg}"

            # Try to find line number from E line if present: E   File "...", line 12
            line = 1
            line_match = re.search(r'File\s+["\']?([^"\'\n]+)["\']?,\s+line\s+(\d+)', text)
            if line_match:
                test_file = line_match.group(1)
                line = int(line_match.group(2))

            return {
                "id": f"test_pytest_{os.path.basename(test_file)}_{line}",
                "file": test_file,
                "line": line,
                "column": 1,
                "errorType": error_class,
                "message": f"Pytest Failure in {test_func}: {full_msg}",
                "source": "test_framework",
                "severity": cls._classify_severity(full_msg),
                "stackTrace": text.strip(),
                "frames": [{"file": test_file, "line": line, "function": test_func}],
                "language": "python"
            }
        return None

    @classmethod
    def _parse_node(cls, text: str) -> Optional[Dict[str, Any]]:
        # TypeError: Cannot read properties of undefined
        #     at calculateTotal (C:/projects/app/cart.js:15:24)
        node_pattern = re.compile(
            r"([A-Za-z]+Error):\s*([^\r\n]+)[\r\n]+\s+at\s+(?:.*?\s+\()?([^()\r\n]+):(\d+):(\d+)\)?"
        )
        match = node_pattern.search(text)
        if not match:
            return None

        error_class = match.group(1)
        error_msg = match.group(2).strip()
        file_path = match.group(3).strip()
        line = int(match.group(4))
        col = int(match.group(5))
        full_msg = f"{error_class}: {error_msg}"

        return {
            "id": f"term_node_{os.path.basename(file_path)}_{line}",
            "file": file_path,
            "line": line,
            "column": col,
            "errorType": error_class,
            "message": full_msg,
            "source": "terminal",
            "severity": cls._classify_severity(full_msg),
            "stackTrace": text.strip(),
            "frames": [{"file": file_path, "line": line, "function": ""}],
            "language": "javascript"
        }

    @classmethod
    def _parse_jest(cls, text: str) -> Optional[Dict[str, Any]]:
        # FAIL src/cart.test.ts
        #   ● Cart suite › calculateTotal
        #     TypeError: ...
        #       at ... (src/cart.ts:25:10)
        jest_pattern = re.compile(
            r"FAIL\s+([^\r\n]+)[\s\S]*?●\s+([^\r\n]+)[\s\S]*?([A-Za-z]+Error):\s*([^\r\n]+)"
        )
        match = jest_pattern.search(text)
        if match:
            test_file = match.group(1).strip()
            test_suite = match.group(2).strip()
            error_class = match.group(3)
            error_msg = match.group(4).strip()

            line = 1
            col = 1
            line_match = re.search(r'at\s+(?:.*?\s+\()?([^()\r\n]+):(\d+):(\d+)\)?', text)
            if line_match:
                test_file = line_match.group(1).strip()
                line = int(line_match.group(2))
                col = int(line_match.group(3))

            full_msg = f"Jest Failure in '{test_suite}': {error_class}: {error_msg}"

            return {
                "id": f"test_jest_{os.path.basename(test_file)}_{line}",
                "file": test_file,
                "line": line,
                "column": col,
                "errorType": error_class,
                "message": full_msg,
                "source": "test_framework",
                "severity": cls._classify_severity(full_msg),
                "stackTrace": text.strip(),
                "frames": [{"file": test_file, "line": line, "function": test_suite}],
                "language": "typescript"
            }
        return None

    @classmethod
    def _parse_java(cls, text: str) -> Optional[Dict[str, Any]]:
        # java.lang.NullPointerException: ...
        #   at com.example.Cart.total(Cart.java:23)
        java_pattern = re.compile(
            r"(?:Exception in thread \"[^\"]+\"\s+)?([a-zA-Z0-9_.]+(?:Exception|Error))(?::\s*([^\r\n]+))?[\r\n]+\s+at\s+([a-zA-Z0-9_$.]+)\(([^:)]+):(\d+)\)"
        )
        match = java_pattern.search(text)
        if not match:
            return None

        error_class = match.group(1).split(".")[-1]
        error_msg = (match.group(2) or "").strip()
        method_path = match.group(3)
        file_name = match.group(4)
        line = int(match.group(5))
        full_msg = f"{error_class}: {error_msg}" if error_msg else error_class

        return {
            "id": f"term_java_{file_name}_{line}",
            "file": file_name,
            "line": line,
            "column": 1,
            "errorType": error_class,
            "message": full_msg,
            "source": "terminal",
            "severity": cls._classify_severity(full_msg),
            "stackTrace": text.strip(),
            "frames": [{"file": file_name, "line": line, "function": method_path}],
            "language": "java"
        }

    @classmethod
    def _parse_cpp(cls, text: str) -> Optional[Dict[str, Any]]:
        # 1. Clang / GCC compiler diagnostic:
        # main.cpp:14:5: error: 'x' was not declared in this scope
        cpp_pattern = re.compile(
            r'([a-zA-Z0-9_./\\-]+\.(?:cpp|cc|cxx|c|hpp|h)):(\d+):(\d+):\s+(error|fatal error|warning):\s*([^\r\n]+)'
        )
        match = cpp_pattern.search(text)
        if match:
            file_path = match.group(1)
            line = int(match.group(2))
            col = int(match.group(3))
            err_level = match.group(4)
            err_msg = match.group(5).strip()
            full_msg = f"C++ {err_level.title()}: {err_msg}"
            err_type = "CompileError" if "error" in err_level else "Warning"
            return {
                "id": f"term_cpp_{os.path.basename(file_path)}_{line}",
                "file": file_path,
                "line": line,
                "column": col,
                "errorType": err_type,
                "message": full_msg,
                "source": "terminal",
                "severity": "CRITICAL" if "fatal" in err_level else "HIGH",
                "stackTrace": text.strip(),
                "frames": [{"file": file_path, "line": line, "function": ""}],
                "language": "cpp"
            }

        # 2. AddressSanitizer / Segmentation fault
        asan_pattern = re.compile(
            r'==\d+==ERROR:\s+AddressSanitizer:\s+([^\r\n]+)[\s\S]*?(?:#0\s+0x[0-9a-fA-F]+\s+in\s+([^\s]+)\s+([a-zA-Z0-9_./\\-]+\.(?:cpp|cc|cxx)):(\d+))'
        )
        asan_match = asan_pattern.search(text)
        if asan_match:
            issue = asan_match.group(1).strip()
            func = asan_match.group(2)
            file_path = asan_match.group(3)
            line = int(asan_match.group(4))
            full_msg = f"AddressSanitizer: {issue} in {func}"
            return {
                "id": f"term_asan_{os.path.basename(file_path)}_{line}",
                "file": file_path,
                "line": line,
                "column": 1,
                "errorType": "MemoryCorruption",
                "message": full_msg,
                "source": "terminal",
                "severity": "CRITICAL",
                "stackTrace": text.strip(),
                "frames": [{"file": file_path, "line": line, "function": func}],
                "language": "cpp"
            }

        return None

    @classmethod
    def _classify_severity(cls, message: str) -> str:
        low = message.toLowerCase() if hasattr(message, "toLowerCase") else message.lower()
        if any(w in low for w in ["segfault", "security", "vulnerability", "fatal", "overflow", "injection"]):
            return "CRITICAL"
        if any(w in low for w in ["typeerror", "nullpointer", "none", "null", "undefined", "syntaxerror", "referenceerror", "zerodivision"]):
            return "HIGH"
        if any(w in low for w in ["warning", "deprecated", "leak"]):
            return "MEDIUM"
        return "LOW"
