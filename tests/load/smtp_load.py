#!/usr/bin/env python3
"""SMTP load generator for the 50 msg/s throughput target. Stdlib only (smtplib + threading).

Each worker thread opens one SMTP connection and sends messages back-to-back (one MAIL/RCPT/DATA
per message, connection reused) until the overall --duration elapses; a token-bucket shared
across workers throttles the aggregate rate to --rate messages/sec so this can both find the
saturation point (raise --rate until errors appear) and verify a specific target rate holds.

Recipient rejection (RCPT refused — e.g. the mailbox does not exist yet) is
reported separately from connection/protocol errors: pass --allow-reject (or
MGATE_LOAD_ALLOW_REJECT=1) to treat it as expected when you only want to measure the pipeline's
raw accept throughput before any domain/mailbox has been provisioned.
"""
from __future__ import annotations

import argparse
import os
import smtplib
import statistics
import threading
import time


class RateLimiter:
    """Simple shared token bucket so N worker threads together average --rate msg/s."""

    def __init__(self, rate_per_sec: float) -> None:
        self._interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0.0
        self._lock = threading.Lock()
        self._next_slot = time.monotonic()

    def wait_for_slot(self) -> None:
        if self._interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next_slot)
            self._next_slot = slot + self._interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)


class Stats:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.latencies_ms: list[float] = []
        self.sent = 0
        self.rejected = 0
        self.errors = 0

    def record_ok(self, latency_ms: float) -> None:
        with self._lock:
            self.sent += 1
            self.latencies_ms.append(latency_ms)

    def record_rejected(self) -> None:
        with self._lock:
            self.rejected += 1

    def record_error(self) -> None:
        with self._lock:
            self.errors += 1


def worker(args: argparse.Namespace, limiter: RateLimiter, stats: Stats, stop_at: float,
           worker_id: int) -> None:
    sender = f"loadtest-{worker_id}@{args.domain}"
    conn: smtplib.SMTP | None = None
    msg_no = 0
    while time.monotonic() < stop_at:
        limiter.wait_for_slot()
        msg_no += 1
        body = (
            f"From: {sender}\r\nTo: {args.to}\r\nSubject: mgate load test {worker_id}-{msg_no}\r\n"
            f"\r\nLoad test message (tests/load/smtp_load.py).\r\n"
        )
        started = time.monotonic()
        try:
            if conn is None:
                conn = smtplib.SMTP(args.host, args.port, timeout=args.timeout)
                conn.ehlo("mgate-load-test")
            conn.sendmail(sender, [args.to], body)
            stats.record_ok((time.monotonic() - started) * 1000)
        except smtplib.SMTPRecipientsRefused:
            if args.allow_reject:
                stats.record_rejected()
            else:
                stats.record_error()
        except (smtplib.SMTPException, OSError):
            stats.record_error()
            conn = None  # reconnect next iteration


def percentile(data: list[float], pct: float) -> float:
    if not data:
        return float("nan")
    ordered = sorted(data)
    idx = min(len(ordered) - 1, int(len(ordered) * pct))
    return ordered[idx]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("SMOKE_HOST", "127.0.0.1"))
    # Default follows the compose host port (rootless Docker cannot bind <1024).
    parser.add_argument("--port", type=int, default=int(os.environ.get("MGATE_SMTP_PORT") or 25))
    parser.add_argument("--domain", default=os.environ.get("SMOKE_TEST_DOMAIN", "mail.example.com"))
    parser.add_argument("--to", default=os.environ.get("SMOKE_TEST_USER", "smoketest@mail.example.com"))
    parser.add_argument("--rate", type=float, default=50.0, help="target aggregate messages/sec")
    parser.add_argument("--duration", type=float, default=30.0, help="seconds to run")
    parser.add_argument("--workers", type=int, default=10, help="concurrent SMTP connections")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--allow-reject", action="store_true",
        default=os.environ.get("MGATE_LOAD_ALLOW_REJECT") == "1",
        help="count RCPT-refused as expected (measure accept throughput only)",
    )
    args = parser.parse_args()

    print(
        f"smtp_load: {args.host}:{args.port} target={args.rate} msg/s, "
        f"{args.workers} workers, {args.duration}s, to={args.to}"
    )

    limiter = RateLimiter(args.rate)
    stats = Stats()
    stop_at = time.monotonic() + args.duration
    threads = [
        threading.Thread(target=worker, args=(args, limiter, stats, stop_at, i), daemon=True)
        for i in range(args.workers)
    ]
    start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=args.duration + args.timeout + 5)
    elapsed = time.monotonic() - start

    achieved_rate = stats.sent / elapsed if elapsed > 0 else 0.0
    print()
    print(f"sent={stats.sent} rejected={stats.rejected} errors={stats.errors} elapsed={elapsed:.1f}s")
    print(f"achieved rate: {achieved_rate:.1f} msg/s (target {args.rate} msg/s)")
    if stats.latencies_ms:
        print(
            "latency ms: min={:.1f} p50={:.1f} p95={:.1f} max={:.1f}".format(
                min(stats.latencies_ms),
                statistics.median(stats.latencies_ms),
                percentile(stats.latencies_ms, 0.95),
                max(stats.latencies_ms),
            )
        )

    if stats.sent == 0 and stats.rejected == 0 and stats.errors > 0:
        print(
            "\nEvery attempt errored — is postfix reachable at "
            f"{args.host}:{args.port}? (is the stack up, or are --host/--port wrong?)"
        )
        return 1
    if not args.allow_reject and stats.rejected > 0:
        print(
            "\nSome recipients were refused (mailbox does not exist yet?) — create the domain and mailbox first, "
            "or re-run with --allow-reject to only measure accept "
            "throughput."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
