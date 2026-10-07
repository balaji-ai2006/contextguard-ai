import os
import json
from typing import Dict, Any, Optional

class FeedbackManager:
    """
    Manages developer feedback loop for accepted, rejected, or partially fixed patches.
    Stores feedback locally for project memory without external transmission.
    """

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = storage_dir or os.path.join(os.getcwd(), ".contextguard_feedback")
        os.makedirs(self.storage_dir, exist_ok=True)
        self.feedback_file = os.path.join(self.storage_dir, "feedback_history.json")

    def record_feedback(self, patch_id: str, feedback: str, comments: Optional[str] = None) -> Dict[str, Any]:
        """
        Records feedback ('fixed', 'not_fixed', 'partially_fixed') for a patch.
        """
        records = []
        if os.path.exists(self.feedback_file):
            try:
                with open(self.feedback_file, "r", encoding="utf-8") as f:
                    records = json.load(f)
            except Exception:
                records = []

        entry = {
            "patch_id": patch_id,
            "feedback": feedback,
            "comments": comments or "",
            "recorded_at": str(os.path.getmtime(self.storage_dir))
        }
        records.append(entry)

        with open(self.feedback_file, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2)

        return {
            "success": True,
            "message": f"Feedback '{feedback}' recorded locally for patch {patch_id}"
        }
