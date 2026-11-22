"""The replay buffer: the most recent commanded rows, kept so a stalled grasp can be backed out in reverse."""

from collections import deque


class ReplayBuffer:
    """A bounded history of (left, right) command rows. Its size comes from the harness config."""

    def __init__(self, rows):
        self.rows = deque(maxlen=max(1, int(rows)))

    @classmethod
    def from_config(cls, config):
        return cls(config.replay_rows)

    @property
    def capacity(self):
        return self.rows.maxlen

    def __len__(self):
        return len(self.rows)

    def append(self, left, right):
        self.rows.append((left.copy(), right.copy()))

    def clear(self):
        self.rows.clear()

    def drain_reversed(self):
        """Return the stored rows newest first and empty the buffer."""
        past = list(self.rows)[::-1]
        self.rows.clear()
        return past
