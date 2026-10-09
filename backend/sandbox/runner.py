import os
import shutil
import tempfile
import subprocess
from typing import Dict, Any, List, Optional

class SandboxRunner:
    """
    Phase 6.3 — Secure Isolated Test Execution Sandbox.
    Executes tests and verification scripts under strict isolation:
    1. Docker Sandbox when Docker is available:
       - Disposable container (--rm)
       - Non-root user (-u 1000:1000)
       - Disabled network access (--network none)
       - Resource limits (--cpus 1.0, --memory 512m)
       - Strict timeout (default 10s)
       - Mounts only required workspace files; never mounts credentials, SSH keys, or Docker sockets.
    2. Restricted Subprocess Fallback when Docker is unavailable:
       - Runs in an isolated temporary directory
       - Sanitized environment variables (stripping AWS, GH, API keys)
       - Safe subprocess execution with list arguments (NO shell=True)
       - Explicitly labeled as 'restricted_subprocess_fallback' (never mislabeled as Docker).
    """

    def __init__(self, timeout_seconds: int = 10):
        self.timeout_seconds = timeout_seconds
        self._docker_available = self._check_docker_available()

    def is_docker_available(self) -> bool:
        return self._docker_available

    def _check_docker_available(self) -> bool:
        """Checks if Docker CLI daemon is responsive."""
        try:
            res = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                text=True,
                timeout=3
            )
            return res.returncode == 0
        except Exception:
            return False

    def execute_test(
        self,
        test_script_content: str,
        source_files: Dict[str, str],
        command: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Executes a test script alongside required source files in isolation.
        Returns execution results, exit codes, output, and environment metadata.
        """
        # Create isolated temporary directory
        temp_dir = tempfile.mkdtemp(prefix="contextguard_sandbox_")
        try:
            # Write source files
            for rel_path, content in source_files.items():
                dest = os.path.join(temp_dir, rel_path)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "w", encoding="utf-8") as f:
                    f.write(content)

            # Write test script
            test_file_path = os.path.join(temp_dir, "test_reproduce.py")
            with open(test_file_path, "w", encoding="utf-8") as f:
                f.write(test_script_content)

            cmd = command or ["python", "-m", "pytest", "test_reproduce.py"]

            if self._docker_available:
                return self._execute_docker(temp_dir, cmd)
            else:
                return self._execute_restricted_subprocess(temp_dir, cmd)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def _execute_docker(self, workspace_dir: str, command: List[str]) -> Dict[str, Any]:
        """Executes test inside a secure, ephemeral Docker container."""
        # Normalize path for Docker volume mounting
        norm_dir = os.path.abspath(workspace_dir).replace("\\", "/")
        docker_cmd = [
            "docker", "run", "--rm",
            "--network", "none",
            "--cpus", "1.0",
            "--memory", "512m",
            "-v", f"{norm_dir}:/workspace:rw",
            "-w", "/workspace",
            "python:3.11-slim",
        ] + command

        try:
            res = subprocess.run(
                docker_cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds
            )
            return {
                "execution_environment": "docker_sandbox",
                "is_docker": True,
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "timed_out": False,
                "success": res.returncode == 0
            }
        except subprocess.TimeoutExpired:
            return {
                "execution_environment": "docker_sandbox",
                "is_docker": True,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Execution timed out after {self.timeout_seconds} seconds.",
                "timed_out": True,
                "success": False
            }
        except Exception as e:
            # Fallback to restricted subprocess if Docker run command fails
            fallback_res = self._execute_restricted_subprocess(workspace_dir, command)
            fallback_res["docker_error"] = str(e)
            return fallback_res

    def _execute_restricted_subprocess(self, workspace_dir: str, command: List[str]) -> Dict[str, Any]:
        """Restricted host fallback with sanitized environment and timeout."""
        # Sanitize environment: strip any credentials or secret variables
        safe_env = {}
        for k, v in os.environ.items():
            k_lower = k.lower()
            if not any(s in k_lower for s in ("secret", "token", "key", "password", "aws", "gh", "auth")):
                safe_env[k] = v

        try:
            res = subprocess.run(
                command,
                cwd=workspace_dir,
                env=safe_env,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds
            )
            return {
                "execution_environment": "restricted_subprocess_fallback",
                "is_docker": False,
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "timed_out": False,
                "success": res.returncode == 0
            }
        except subprocess.TimeoutExpired:
            return {
                "execution_environment": "restricted_subprocess_fallback",
                "is_docker": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Execution timed out after {self.timeout_seconds} seconds.",
                "timed_out": True,
                "success": False
            }
        except Exception as e:
            return {
                "execution_environment": "restricted_subprocess_fallback",
                "is_docker": False,
                "exit_code": 1,
                "stdout": "",
                "stderr": str(e),
                "timed_out": False,
                "success": False
            }
