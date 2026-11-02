"""
API load test for NFR-03 (performance) and NFR-05 (scalability): many
simulated users hitting the read paths an event day leans on, at rising
concurrency, reporting latency percentiles, throughput and errors.

    python scripts/loadtest.py --base http://localhost:8000 --phone 0711000880

--phone signs in once (development /auth/login) for the authenticated
endpoints; leave it out to test only the public ones. Only GET requests:
it never buys, lists or scans anything, so it's safe against a demo
server. Writes nothing; prints a table (and --csv for the report).
"""
import argparse
import asyncio
import csv
import statistics
import sys
import time

import httpx

LEVELS = (1, 10, 50, 100)


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(p / 100 * len(ordered)))]


async def run_level(client: httpx.AsyncClient, paths: list[tuple[str, dict]], concurrency: int, total: int) -> dict:
    """`total` requests spread over `concurrency` simultaneous users, each
    cycling through the endpoints."""
    latencies, errors = [], 0
    queue = asyncio.Queue()
    for i in range(total):
        queue.put_nowait(paths[i % len(paths)])

    async def user():
        nonlocal errors
        while True:
            try:
                path, headers = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            start = time.perf_counter()
            try:
                res = await client.get(path, headers=headers)
                ok = res.status_code < 400
            except httpx.HTTPError:
                ok = False
            latencies.append((time.perf_counter() - start) * 1000)
            errors += not ok

    started = time.perf_counter()
    await asyncio.gather(*(user() for _ in range(concurrency)))
    elapsed = time.perf_counter() - started
    return {
        "concurrency": concurrency,
        "requests": total,
        "p50_ms": percentile(latencies, 50),
        "p95_ms": percentile(latencies, 95),
        "p99_ms": percentile(latencies, 99),
        "mean_ms": statistics.mean(latencies),
        "req_per_s": total / elapsed,
        "errors": errors,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default="http://localhost:8000")
    parser.add_argument("--phone", help="sign in as this (development) account for the authenticated endpoints")
    parser.add_argument("--per-level", type=int, default=400, help="requests at each concurrency level")
    parser.add_argument("--levels", default=",".join(map(str, LEVELS)))
    parser.add_argument("--csv", help="also write the results here")
    args = parser.parse_args()

    async with httpx.AsyncClient(base_url=args.base, timeout=30, limits=httpx.Limits(max_connections=200)) as client:
        events = (await client.get("/api/v1/events/?limit=20")).json()
        paths = [("/", {}), ("/api/v1/events/?limit=20", {}), ("/api/v1/resale/listings", {})]
        paths += [(f"/api/v1/events/{e['id']}", {}) for e in events[:5]]
        if args.phone:
            login = (await client.post("/api/v1/auth/login", json={"phone_number": args.phone})).json()
            auth = {"Authorization": f"Bearer {login['access_token']}"}
            paths += [("/api/v1/auth/me", auth), ("/api/v1/tickets/my", auth), ("/api/v1/resale/wallet", auth)]
        print(f"{args.base}: {len(paths)} endpoints, {args.per_level} requests per level")

        rows = []
        for level in (int(x) for x in args.levels.split(",")):
            row = await run_level(client, paths, level, args.per_level)
            rows.append(row)
            print(f"  {level:>4} users  p50 {row['p50_ms']:7.1f} ms  p95 {row['p95_ms']:7.1f} ms  "
                  f"p99 {row['p99_ms']:7.1f} ms  {row['req_per_s']:6.1f} req/s  errors {row['errors']}")

    if args.csv:
        with open(args.csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    return 0 if all(r["errors"] == 0 for r in rows) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
