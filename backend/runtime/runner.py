import os
import sys
import json
import runpy
from backend.runtime.tracer import SnapshotTracer

def run_diagnostic(file_path: str) -> int:
    """
    Opt-in diagnostic runner for executing a specified Python file
    under SnapshotTracer to capture runtime memory snapshots upon failure.
    """
    if not os.path.exists(file_path):
        sys.stderr.write(f"Error: File not found: {file_path}\n")
        return 2

    abs_path = os.path.abspath(file_path)
    tracer = SnapshotTracer(target_file=abs_path)

    try:
        tracer.start()
        # Run user script in its directory context
        script_dir = os.path.dirname(abs_path)
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)

        runpy.run_path(abs_path, run_name="__main__")
        tracer.stop()
        return 0
    except BaseException as exc:
        tracer.stop()
        snapshot = tracer.last_snapshot
        if snapshot:
            sys.stdout.write("\n=== CONTEXTGUARD RUNTIME SNAPSHOT ===\n")
            sys.stdout.write(json.dumps(snapshot.dict(), indent=2))
            sys.stdout.write("\n=====================================\n")
        else:
            sys.stderr.write(f"Execution failed with {type(exc).__name__}: {str(exc)}\n")
        return 1

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m backend.runtime.runner <python_file>\n")
        sys.exit(1)

    exit_code = run_diagnostic(sys.argv[1])
    sys.exit(exit_code)
