import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional


@dataclass
class SpaceOccupancyState:
    occupied: Optional[bool] = None
    candidate: Optional[bool] = None
    candidate_since: Optional[float] = None


class OccupancySmoother:
    """Keep spot occupancy stable until a new state stays consistent long enough."""

    def __init__(
        self,
        confirm_seconds: float,
        now_fn: Optional[Callable[[], float]] = None,
    ):
        self.confirm_seconds = max(0.0, float(confirm_seconds))
        self._now = now_fn or time.monotonic
        self.space_state: Dict[int, SpaceOccupancyState] = {}

    def apply(self, space_ids: List[int], raw_occupancy: Dict[int, bool]) -> Dict[int, bool]:
        now = self._now()
        active_space_ids = set(space_ids)
        self.space_state = {
            space_id: self.space_state.get(space_id, SpaceOccupancyState())
            for space_id in active_space_ids
        }

        smoothed_occupancy: Dict[int, bool] = {}

        for space_id in space_ids:
            state = self.space_state[space_id]
            detected_occupied = bool(raw_occupancy.get(space_id, False))

            if state.occupied is None:
                state.occupied = detected_occupied
            elif detected_occupied == state.occupied:
                state.candidate = None
                state.candidate_since = None
            elif self.confirm_seconds == 0.0:
                state.occupied = detected_occupied
                state.candidate = None
                state.candidate_since = None
            elif state.candidate != detected_occupied:
                state.candidate = detected_occupied
                state.candidate_since = now
            elif state.candidate_since is not None and now - state.candidate_since >= self.confirm_seconds:
                state.occupied = detected_occupied
                state.candidate = None
                state.candidate_since = None

            smoothed_occupancy[space_id] = bool(state.occupied)

        return smoothed_occupancy
