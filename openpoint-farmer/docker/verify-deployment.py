#!/usr/bin/env python3
"""Verify a running farmer without exposing its API key or token."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def http_json(url: str, *, api_key: str | None = None, timeout: float = 5.0):
    headers = {"Accept": "application/json"}
    data = None
    method = "GET"
    if api_key is not None:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["Content-Type"] = "application/json"
        data = b"{}"
        method = "POST"

    request = urllib.request.Request(
        url, headers=headers, data=data, method=method
    )
    started_at = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        try:
            payload = json.load(exc)
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {}
    return status, payload, (time.perf_counter() - started_at) * 1000


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * fraction) - 1)
    return ordered[index]


def wait_until_healthy(base_url: str, timeout: float) -> tuple[dict, float]:
    started_at = time.monotonic()
    deadline = started_at + timeout
    last_error = "health endpoint has not responded"
    while time.monotonic() < deadline:
        try:
            status, payload, _ = http_json(f"{base_url}/health", timeout=3)
            if status == 200 and payload.get("status") == "ok":
                return payload, time.monotonic() - started_at
            last_error = (
                f"HTTP {status}, status={payload.get('status')}, "
                f"stage={payload.get('fetch_stage')}"
            )
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        time.sleep(1)
    raise RuntimeError(f"farmer did not become healthy: {last_error}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5000")
    parser.add_argument(
        "--api-key-file", default="private/farmer_api_key.txt", type=Path
    )
    parser.add_argument("--wait-seconds", type=float, default=420)
    parser.add_argument("--requests", type=int, default=500)
    parser.add_argument("--concurrency", type=int, default=32)
    parser.add_argument("--request-timeout", type=float, default=5)
    parser.add_argument("--max-p95-ms", type=float)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.requests < 1 or args.concurrency < 1:
        raise SystemExit("--requests and --concurrency must be positive")

    api_key = args.api_key_file.read_text(encoding="utf-8").strip()
    if not api_key:
        raise SystemExit(f"API key file is empty: {args.api_key_file}")

    base_url = args.base_url.rstrip("/")
    health, healthy_wait = wait_until_healthy(base_url, args.wait_seconds)
    token_url = f"{base_url}/get_token"

    unauthorized_status, _, _ = http_json(token_url, api_key="invalid-key")
    if unauthorized_status != 401:
        raise RuntimeError(
            f"unauthorized request returned HTTP {unauthorized_status}, expected 401"
        )

    def query_once(_index: int):
        status, payload, latency_ms = http_json(
            token_url, api_key=api_key, timeout=args.request_timeout
        )
        token = payload.get("mid_v") if status == 200 else None
        return status, token, latency_ms

    for index in range(min(10, args.concurrency)):
        status, token, _ = query_once(index)
        if status != 200 or not token:
            raise RuntimeError(f"warm-up query failed with HTTP {status}")

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=args.concurrency
    ) as executor:
        results = list(executor.map(query_once, range(args.requests)))

    successes = [
        (token, latency)
        for status, token, latency in results
        if status == 200 and token
    ]
    failures = len(results) - len(successes)
    if not successes:
        raise RuntimeError("all benchmark requests failed")

    tokens = {token for token, _ in successes}
    latencies = [latency for _, latency in successes]
    summary = {
        "status": "ok" if failures == 0 else "failed",
        "healthy_wait_seconds": round(healthy_wait, 3),
        "requests": len(results),
        "successes": len(successes),
        "failures": failures,
        "concurrency": args.concurrency,
        "unique_tokens": len(tokens),
        "latency_ms": {
            "mean": round(statistics.fmean(latencies), 3),
            "p50": round(percentile(latencies, 0.50), 3),
            "p95": round(percentile(latencies, 0.95), 3),
            "p99": round(percentile(latencies, 0.99), 3),
            "max": round(max(latencies), 3),
        },
        "farmer": {
            "successful_fetches": health.get("successful_fetches"),
            "validation_failures": health.get("validation_failures"),
            "app_state": health.get("app_state"),
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if failures:
        return 1
    p95 = summary["latency_ms"]["p95"]
    if args.max_p95_ms is not None and p95 > args.max_p95_ms:
        print(
            f"p95 exceeds limit: {p95}ms > {args.max_p95_ms}ms",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
