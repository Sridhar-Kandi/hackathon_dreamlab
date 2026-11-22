"""Retry policy for the model connection: expired sessions, a full model pool and dropped connections.

The runner asks `decide(exc)` after a failed request. It returns how long to wait before asking again, or None
when the error should end the trial.
"""


class RetryPolicy:
    def __init__(self, config):
        self.config = config
        self.restarts = 0
        self.capacity_waits = 0
        self.network_retries = 0

    def succeeded(self):
        self.restarts = 0

    def decide(self, exc):
        message = str(exc)
        if type(exc).__name__ == "DreamSessionExpired" and self.restarts < self.config.SESSION_RESTARTS:
            self.restarts += 1
            return 0
        if "NO_CAPACITY" in message and self.capacity_waits < self.config.CAPACITY_WAITS:
            # Physics is paused between replies, so waiting does not change the trial.
            self.capacity_waits += 1
            return min(60, 5 * 2 ** self.capacity_waits)
        if "could not reach" in message and self.network_retries < self.config.NETWORK_RETRIES:
            self.network_retries += 1
            return 2 ** self.network_retries
        return None


def open_waits(recover):
    """Back-off schedule (seconds) for opening a session while the model pool is full."""
    return (5, 10, 20, 40, 60, 90, 0) if recover else (0,)
