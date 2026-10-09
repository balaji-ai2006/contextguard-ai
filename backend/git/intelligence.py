import os
import shutil
import subprocess
import hashlib
from typing import Dict, Any, List, Optional

class GitIntelligence:
    """
    Manages local Git context, concurrency drift detection, safe checkpoints,
    and reversible patch application.
    """

    def __init__(self, repo_path: Optional[str] = None):
        self.repo_path = repo_path or os.getcwd()
        self.checkpoints_dir = os.path.join(self.repo_path, ".contextguard_checkpoints")
        os.makedirs(self.checkpoints_dir, exist_ok=True)

    def _run_git(self, args: List[str]) -> tuple[bool, str]:
        try:
            res = subprocess.run(
                ["git"] + args,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=5
            )
            return (res.returncode == 0, res.stdout.strip() if res.returncode == 0 else res.stderr.strip())
        except Exception as e:
            return (False, str(e))

    def get_git_state(self) -> Dict[str, Any]:
        """Analyzes branch, uncommitted files, and conflicts."""
        ok_branch, branch = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"])
        if not ok_branch:
            branch = "main"

        ok_hash, last_commit = self._run_git(["rev-parse", "--short", "HEAD"])
        if not ok_hash:
            last_commit = "unknown"

        ok_status, status_out = self._run_git(["status", "--porcelain"])
        uncommitted_files = []
        has_conflicts = False

        if ok_status and status_out:
            for line in status_out.splitlines():
                if len(line) >= 3:
                    state_code = line[:2]
                    file_name = line[3:].strip()
                    uncommitted_files.append(file_name)
                    if "U" in state_code or "AA" in state_code:
                        has_conflicts = True

        return {
            "branch": branch,
            "lastCommitHash": last_commit,
            "isClean": len(uncommitted_files) == 0,
            "hasConflicts": has_conflicts,
            "uncommittedFiles": uncommitted_files
        }

    def get_recent_commits(self, limit: int = 5) -> List[Dict[str, str]]:
        """Safe read-only inspection of recent commits for team context."""
        ok, out = self._run_git(["log", f"-n{limit}", "--pretty=format:%h|%an|%s|%cd", "--date=short"])
        commits = []
        if ok and out:
            for line in out.splitlines():
                parts = line.split("|", 3)
                if len(parts) == 4:
                    commits.append({
                        "hash": parts[0],
                        "author": parts[1],
                        "summary": parts[2],
                        "date": parts[3]
                    })
        return commits

    def detect_team_conflicts(self, proposed_files: List[str]) -> Dict[str, Any]:
        """
        Detects whether proposed fix files overlap with uncommitted changes or branch conflicts.
        Never modifies, stages, commits, or discards any file.
        """
        state = self.get_git_state()
        uncommitted = set(os.path.normpath(f) for f in state.get("uncommittedFiles", []))
        conflicts = []
        for pf in proposed_files:
            norm_pf = os.path.normpath(pf)
            base_pf = os.path.basename(norm_pf)
            for uf in uncommitted:
                if base_pf == os.path.basename(uf) or norm_pf in uf:
                    conflicts.append(pf)
                    break
        return {
            "has_conflict": len(conflicts) > 0 or state.get("hasConflicts", False),
            "conflicting_files": conflicts,
            "is_clean": state.get("isClean", True)
        }

    def get_file_hash(self, file_path: str) -> Optional[str]:
        """Computes SHA256 of file content to detect concurrent modification drift."""
        if not os.path.exists(file_path):
            return None
        with open(file_path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def get_blame(self, file_path: str, line_no: int) -> Dict[str, str]:
        """Fetches commit blame for a given line."""
        ok, out = self._run_git(["blame", "-L", f"{line_no},{line_no}", "--porcelain", file_path])
        if ok and out:
            lines = out.splitlines()
            commit_hash = lines[0].split()[0] if lines else "unknown"
            author = "unknown"
            for l in lines:
                if l.startswith("author "):
                    author = l[7:].strip()
                    break
            return {"commit": commit_hash, "author": author}
        return {"commit": "unknown", "author": "unknown"}

    def create_safe_checkpoint(self, file_path: str, patch_id: str) -> str:
        """Saves a timestamped backup copy before patch modification."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Cannot checkpoint non-existent file: {file_path}")

        base_name = os.path.basename(file_path)
        checkpoint_file = os.path.join(self.checkpoints_dir, f"{patch_id}_{base_name}.bak")
        shutil.copy2(file_path, checkpoint_file)

        # Write metadata mapping
        meta_file = os.path.join(self.checkpoints_dir, f"{patch_id}.meta")
        try:
            with open(meta_file, "w", encoding="utf-8") as f:
                f.write(os.path.abspath(file_path))
        except Exception:
            pass

        return checkpoint_file

    def safe_apply_patch(self, file_path: str, diff_or_content: str, patch_id: str, original_file_hash: Optional[str] = None) -> Dict[str, Any]:
        """
        Safely applies patch to file after checking for concurrency drift.
        Automatically creates a rollback checkpoint.
        """
        if not os.path.exists(file_path):
            return {"success": False, "message": f"Target file does not exist: {file_path}"}

        # Concurrency drift check:
        if original_file_hash:
            current_hash = self.get_file_hash(file_path)
            if current_hash != original_file_hash:
                return {
                    "success": False,
                    "message": "WARNING: File changed by another process/team member. Patch application paused."
                }

        # Create checkpoint
        checkpoint_path = self.create_safe_checkpoint(file_path, patch_id)

        # Apply patch or replacement
        try:
            # Check if diff_or_content is full content or unified diff
            if diff_or_content.startswith("---") or diff_or_content.startswith("@@"):
                applied = self._apply_unified_diff(file_path, diff_or_content)
                if not applied:
                    # Rollback if failed
                    shutil.copy2(checkpoint_path, file_path)
                    return {"success": False, "message": "Failed to apply unified diff cleanly."}
            else:
                # Direct replacement content
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(diff_or_content)

            return {
                "success": True,
                "message": f"Patch applied safely with checkpoint at {os.path.basename(checkpoint_path)}",
                "checkpoint": checkpoint_path
            }
        except Exception as e:
            shutil.copy2(checkpoint_path, file_path)
            return {"success": False, "message": f"Error applying patch: {str(e)}"}

    def rollback(self, patch_id: Optional[str] = None) -> Dict[str, Any]:
        """Restores file from the last checkpoint."""
        if not os.path.exists(self.checkpoints_dir):
            return {"success": False, "message": "No checkpoints available for rollback."}

        checkpoints = sorted(
            [f for f in os.listdir(self.checkpoints_dir) if f.endswith(".bak")],
            key=lambda x: os.path.getmtime(os.path.join(self.checkpoints_dir, x)),
            reverse=True
        )

        if not checkpoints:
            return {"success": False, "message": "No checkpoints found."}

        target_checkpoint = None
        target_pid = patch_id
        if patch_id:
            for cp in checkpoints:
                if cp.startswith(patch_id + "_"):
                    target_checkpoint = cp
                    break

        if not target_checkpoint:
            target_checkpoint = checkpoints[0]
            target_pid = target_checkpoint.split("_")[0]

        meta_file = os.path.join(self.checkpoints_dir, f"{target_pid}.meta")
        found_target = None
        if os.path.exists(meta_file):
            with open(meta_file, "r", encoding="utf-8") as f:
                candidate = f.read().strip()
                if os.path.exists(candidate):
                    found_target = candidate

        if not found_target:
            # Fallback search by filename
            base_part = target_checkpoint[len(target_pid) + 1:-4]
            for root, _, files in os.walk(self.repo_path):
                if base_part in files:
                    found_target = os.path.join(root, base_part)
                    break

        if not found_target:
            return {"success": False, "message": f"Could not locate destination file for {target_checkpoint}"}

        shutil.copy2(os.path.join(self.checkpoints_dir, target_checkpoint), found_target)
        return {
            "success": True,
            "message": f"Successfully restored {os.path.basename(found_target)} from checkpoint"
        }

    def _apply_unified_diff(self, file_path: str, diff_text: str) -> bool:
        """Applies unified diff text using patch or manual chunk replacement."""
        # Simple hunk parsing for single-file replacements
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                lines = f.readlines()

            # If unified diff contains - and + lines
            diff_lines = diff_text.splitlines()
            old_chunk = []
            new_chunk = []
            for dl in diff_lines:
                if dl.startswith("-") and not dl.startswith("---"):
                    old_chunk.append(dl[1:])
                elif dl.startswith("+") and not dl.startswith("+++"):
                    new_chunk.append(dl[1:])

            if old_chunk and new_chunk:
                old_text = "\n".join([c.strip() for c in old_chunk])
                new_text = "\n".join([c.strip() for c in new_chunk])
                full_content = "".join(lines)
                if old_text in full_content:
                    updated = full_content.replace(old_text, new_text, 1)
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(updated)
                    return True

            return False
        except Exception:
            return False
