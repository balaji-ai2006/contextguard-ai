from typing import Dict, Any, List
from backend.agents.agent_base import BaseAgent

class DiagnosticianAgent(BaseAgent):
    """
    Agent 1 — Diagnostician
    Analyzes: stack trace, runtime snapshot, source code, dependencies, reproduction test.
    Produces a root-cause hypothesis, failure point, and propagation path.
    """

    def __init__(self):
        super().__init__("Diagnostician")

    def diagnose(self, bug_info: Dict[str, Any], runtime_snapshot: Dict[str, Any], code_snippet: str) -> Dict[str, Any]:
        prompt = f"""
Bug Info: {bug_info}
Runtime Snapshot: {runtime_snapshot}
Code Snippet:
{code_snippet}

Identify the root cause, failure point, and propagation path. Return JSON with keys:
"root_cause", "failure_point", "propagation_path" (list of strings), "hypothesis"
"""
        system_prompt = "You are an expert root cause analysis debugging engineer. Return structured JSON with root_cause, failure_point, propagation_path, hypothesis."
        llm_result = self.query_llm(prompt, system_prompt)
        if llm_result and "root_cause" in llm_result:
            return llm_result

        # Deterministic local root cause analysis fallback
        msg = str(bug_info.get("message", "")).lower()
        err_type = str(bug_info.get("errorType", ""))

        if "nonetype" in msg or "none" in msg or "null" in msg:
            root_cause = "Variable was passed or initialized as None/null instead of an iterable collection."
            failure_point = f"Line {bug_info.get('line', '?')} attempted iteration over NoneType."
            propagation_path = [
                "Caller invoked function with items = None",
                "Function received None without input validation",
                "Generator expression attempted iteration over None",
                f"TypeError raised: {bug_info.get('message', 'NoneType object is not iterable')}"
            ]
        elif "keyerror" in msg:
            root_cause = "Dictionary access with a key that does not exist in the record."
            failure_point = f"Line {bug_info.get('line', '?')} dictionary lookup failed."
            propagation_path = [
                "Record created missing required key",
                "Subscript operator [] executed",
                "KeyError raised"
            ]
        elif "zerodivision" in msg:
            root_cause = "Denominator evaluated to 0 during arithmetic division."
            failure_point = f"Line {bug_info.get('line', '?')} division by zero."
            propagation_path = [
                "Denominator calculated as 0",
                "Division operation executed",
                "ZeroDivisionError raised"
            ]
        else:
            root_cause = f"Unhandled {err_type} condition in application logic."
            failure_point = f"Execution reached line {bug_info.get('line', '?')} with invalid state."
            propagation_path = [
                "Input passed to function",
                "Condition not guarded",
                f"{err_type} triggered"
            ]

        return {
            "root_cause": root_cause,
            "failure_point": failure_point,
            "propagation_path": propagation_path,
            "hypothesis": f"Adding defensive validation and handling for {err_type} at function boundary will prevent the failure."
        }
