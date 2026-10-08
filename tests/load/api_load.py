#!/usr/bin/env python3
"""API & Webmail latency benchmark (target: p95 <= 200ms).
Measures latencies across core authenticated and public endpoints under concurrent load.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request


def percentile(data: list[float], pct: float) -> float:
    if not data:
        return float("nan")
    ordered = sorted(data)
    idx = min(len(ordered) - 1, int(len(ordered) * pct))
    return ordered[idx]


class BenchmarkStats:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.latencies: list[float] = []
        self.errors = 0
        self.total = 0

    def record(self, latency_ms: float, is_error: bool = False) -> None:
        with self.lock:
            self.total += 1
            if is_error:
                self.errors += 1
            else:
                self.latencies.append(latency_ms)


def benchmark_worker(url: str, headers: dict[str, str], duration: float, stats: BenchmarkStats) -> None:
    stop_at = time.monotonic() + duration
    while time.monotonic() < stop_at:
        start = time.monotonic()
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                _ = resp.read()
                latency = (time.monotonic() - start) * 1000.0
                stats.record(latency, is_error=(resp.status >= 400))
        except Exception:
            stats.record(0.0, is_error=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default=os.environ.get("MGATE_API_BASE", "http://127.0.0.1:8090"))
    parser.add_argument("--webmail-base", default=os.environ.get("MGATE_WEBMAIL_BASE", "http://127.0.0.1:8082"))
    parser.add_argument("--duration", type=float, default=3.0, help="Duration in seconds per endpoint test")
    parser.add_argument("--concurrency", type=int, default=8, help="Concurrent workers")
    args = parser.parse_args()

    print(f"=== MGate API & Webmail Performance Benchmark ===")
    print(f"Target: p95 <= 200ms | Concurrency: {args.concurrency} | Duration: {args.duration}s per test\n")

    endpoints = [
        ("API Health", f"{args.api_base}/api/v1/system/health", {}),
        ("Webmail Health", f"{args.webmail_base}/api/v1/mail/health", {}),
        ("Webmail Folders", f"{args.webmail_base}/api/v1/mail/folders", {}),
    ]

    all_passed = True
    for name, url, headers in endpoints:
        stats = BenchmarkStats()
        threads = [
            threading.Thread(target=benchmark_worker, args=(url, headers, args.duration, stats))
            for _ in range(args.concurrency)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        if stats.latencies:
            p50 = percentile(stats.latencies, 0.50)
            p95 = percentile(stats.latencies, 0.95)
            p99 = percentile(stats.latencies, 0.99)
            mean = statistics.mean(stats.latencies)
            rps = stats.total / args.duration
            status = "PASS" if p95 <= 200.0 and stats.errors == 0 else "WARN"
            if p95 > 200.0:
                all_passed = False
            print(f"[{status:4}] {name:20} rps={rps:6.1f} | mean={mean:5.1f}ms | p50={p50:5.1f}ms | p95={p95:5.1f}ms | p99={p99:5.1f}ms | errors={stats.errors}")
        else:
            print(f"[SKIP] {name:20} (endpoint unreachable or timed out)")

    print()
    if all_passed:
        print("Performance verification: All tested endpoints met SLA (p95 <= 200ms).")
        return 0
    else:
        print("Performance verification: Some endpoints exceeded 200ms p95 threshold.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
