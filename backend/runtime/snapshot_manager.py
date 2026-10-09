import threading
from typing import List, Optional, Dict
from backend.runtime.models import RuntimeSnapshotModel

class InMemorySnapshotManager:
    """
    Thread-safe in-memory manager for runtime memory snapshots.
    Enforces maximum history limits and supports snapshot retrieval and clearing.
    Does not persist to disk or database.
    """

    def __init__(self, max_history_size: int = 50):
        self._max_history_size = max(1, max_history_size)
        self._snapshots: Dict[str, RuntimeSnapshotModel] = {}
        self._order: List[str] = []
        self._lock = threading.Lock()

    @property
    def max_history_size(self) -> int:
        return self._max_history_size

    @max_history_size.setter
    def max_history_size(self, size: int):
        with self._lock:
            self._max_history_size = max(1, size)
            self._evict_excess_locked()

    def add_snapshot(self, snapshot: RuntimeSnapshotModel) -> RuntimeSnapshotModel:
        """Adds a snapshot, evicting oldest if max_history_size is reached."""
        with self._lock:
            snap_id = snapshot.snapshot_id
            if snap_id in self._snapshots:
                self._order.remove(snap_id)
            self._snapshots[snap_id] = snapshot
            self._order.append(snap_id)
            self._evict_excess_locked()
            return snapshot

    def get_snapshot(self, snapshot_id: str) -> Optional[RuntimeSnapshotModel]:
        """Retrieves a snapshot by its ID, or returns None if not found."""
        with self._lock:
            return self._snapshots.get(snapshot_id)

    def list_snapshots(self, limit: Optional[int] = None) -> List[RuntimeSnapshotModel]:
        """
        Lists snapshots ordered from most recent to oldest.
        Optionally limits the number of returned items.
        """
        with self._lock:
            # Most recent first
            recent_ids = list(reversed(self._order))
            if limit is not None and limit > 0:
                recent_ids = recent_ids[:limit]
            return [self._snapshots[sid] for sid in recent_ids if sid in self._snapshots]

    def clear_snapshots(self) -> int:
        """Clears all snapshots and returns the count of removed items."""
        with self._lock:
            count = len(self._snapshots)
            self._snapshots.clear()
            self._order.clear()
            return count

    def count(self) -> int:
        with self._lock:
            return len(self._snapshots)

    def _evict_excess_locked(self):
        while len(self._order) > self._max_history_size:
            oldest_id = self._order.pop(0)
            self._snapshots.pop(oldest_id, None)

# Default global in-memory instance
snapshot_manager = InMemorySnapshotManager(max_history_size=50)
