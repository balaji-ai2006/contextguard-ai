import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.parser.python_parser import PythonASTAnalyzer
from backend.parser.traceback_parser import TracebackParser

client = TestClient(app)

def test_ast_null_none_detection():
    code = """
items = None
def calculate_total(items):
    return [item["price"] for item in items]
"""
    analyzer = PythonASTAnalyzer(code, "cart.py")
    bugs = analyzer.analyze()
    assert any(b["errorType"] == "NullOrNoneError" for b in bugs)
    none_bug = next(b for b in bugs if b["errorType"] == "NullOrNoneError")
    assert "TypeError: 'NoneType' object is not iterable" in none_bug["message"]
    assert none_bug["severity"] == "HIGH"

def test_ast_syntax_error_detection():
    code = "def broken_func(\n    print('missing paren'"
    analyzer = PythonASTAnalyzer(code, "broken.py")
    bugs = analyzer.analyze()
    assert len(bugs) == 1
    assert bugs[0]["errorType"] == "SyntaxError"
    assert bugs[0]["category"] == "CompileError"

def test_ast_resource_leak_detection():
    code = """
def read_data():
    f = open('data.csv', 'r')
    content = f.read()
    return content
"""
    analyzer = PythonASTAnalyzer(code, "io.py")
    bugs = analyzer.analyze()
    assert any(b["errorType"] == "ResourceLeak" for b in bugs)

def test_ast_infinite_loop_detection():
    code = """
def worker():
    while True:
        process_task()
"""
    analyzer = PythonASTAnalyzer(code, "worker.py")
    bugs = analyzer.analyze()
    assert any(b["errorType"] == "InfiniteLoop" for b in bugs)

def test_ast_zero_division_detection():
    code = """
def calc(x):
    return x / 0
"""
    analyzer = PythonASTAnalyzer(code, "math_util.py")
    bugs = analyzer.analyze()
    assert any(b["errorType"] == "ZeroDivisionError" for b in bugs)

def test_ast_security_detection():
    code = """
import subprocess
api_key = "sk-live-998877665544"
def run(cmd):
    eval(cmd)
    subprocess.run(cmd, shell=True)
"""
    analyzer = PythonASTAnalyzer(code, "sec.py")
    bugs = analyzer.analyze()
    sec_bugs = [b for b in bugs if b["errorType"] == "SecurityIssue"]
    assert len(sec_bugs) >= 2 # api_key, eval, shell=True
    assert any("eval" in b["message"] for b in sec_bugs)
    assert any("shell=True" in b["message"] for b in sec_bugs)

def test_ast_mutable_default_api_misuse():
    code = """
def add_item(item, basket=[]):
    basket.append(item)
    return basket
"""
    analyzer = PythonASTAnalyzer(code, "basket.py")
    bugs = analyzer.analyze()
    assert any(b["errorType"] == "APIMisuse" for b in bugs)

def test_traceback_parser_python():
    tb = """
Traceback (most recent call last):
  File "app/cart.py", line 42, in calculate_total
    return sum(item["price"] for item in items)
TypeError: 'NoneType' object is not iterable
"""
    bug = TracebackParser.parse(tb)
    assert bug is not None
    assert bug["errorType"] == "TypeError"
    assert bug["line"] == 42
    assert "calculate_total" in bug["frames"][0]["function"]

def test_traceback_parser_pytest():
    log = """
============================= FAILURES =============================
_________________________ test_calculate_total _________________________
FAILED tests/test_cart.py::test_calculate_total - TypeError: 'NoneType' object is not iterable
"""
    bug = TracebackParser.parse(log)
    assert bug is not None
    assert bug["errorType"] == "TypeError"
    assert bug["source"] == "test_framework"
    assert "test_cart.py" in bug["file"]

def test_traceback_parser_node():
    stack = """
TypeError: Cannot read properties of undefined (reading 'price')
    at calculateTotal (C:/projects/app/cart.js:15:24)
    at Object.<anonymous> (C:/projects/app/index.js:5:1)
"""
    bug = TracebackParser.parse(stack)
    assert bug is not None
    assert bug["errorType"] == "TypeError"
    assert bug["line"] == 15
    assert bug["column"] == 24

def test_traceback_parser_jest():
    log = """
FAIL src/cart.test.ts
  ● Cart test suite › calculateTotal
    TypeError: Cannot read properties of undefined
      at calculateTotal (src/cart.ts:25:10)
"""
    bug = TracebackParser.parse(log)
    assert bug is not None
    assert bug["errorType"] == "TypeError"
    assert bug["source"] == "test_framework"
    assert bug["line"] == 25

def test_api_detect_ast_endpoint():
    res = client.post("/api/detect/ast", json={
        "source_code": "items = None\nfor x in items: pass",
        "file_path": "main.py"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["count"] >= 1
    assert data["bugs"][0]["errorType"] == "NullOrNoneError"

def test_api_detect_traceback_endpoint():
    res = client.post("/api/detect/traceback", json={
        "text": "Traceback (most recent call last):\n  File 'main.py', line 10, in run\nValueError: invalid input"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1
    assert data["bugs"][0]["errorType"] == "ValueError"
