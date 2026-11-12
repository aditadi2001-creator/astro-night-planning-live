"""R2 helper for GitHub Actions jobs, with a hard storage guard.

Credentials come only from the environment (GitHub Actions secrets):
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
The token must be "Object Read & Write" limited to this project's bucket.

Rules enforced here (see README "Cloudflare R2: cost rules"):
  * Only buckets whose name starts with "astro-night-planning-live".
  * Before every upload the bucket is totalled (one ListObjectsV2 call per
    1,000 objects; we keep the object count small on purpose).
  * If the upload would take the bucket above HARD_LIMIT (8 GB), the oldest
    hourly cloud archives (clouds/hourly/) are deleted first (deletes are free);
    if that is still not enough the job FAILS and nothing is uploaded.
  * Above TARGET (5 GB) a warning is printed.

Usage:
    python r2.py usage
    python r2.py upload <local file> <key> [--type MIME] [--cache CACHE-CONTROL]
    python r2.py prune-hourly [--keep-hours 24]
    python r2.py delete <key>
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_PREFIX = "astro-night-planning-live"
DEFAULT_BUCKET = "astro-night-planning-live-data"
GB = 1_000_000_000
HARD_LIMIT = 8 * GB
TARGET = 5 * GB
HOURLY_PREFIX = "clouds/hourly/"
HOURLY_RE = re.compile(r"^clouds/hourly/(\d{10})\.pmtiles$")


@dataclass
class Obj:
    key: str
    size: int


def bucket_name() -> str:
    name = os.environ.get("R2_BUCKET", DEFAULT_BUCKET)
    if not name.startswith(PROJECT_PREFIX):
        sys.exit(f"Refusing to touch bucket '{name}': only '{PROJECT_PREFIX}*' buckets are allowed.")
    return name


def client():
    import boto3
    from botocore.config import Config

    try:
        account = os.environ["R2_ACCOUNT_ID"]
        key_id = os.environ["R2_ACCESS_KEY_ID"]
        secret = os.environ["R2_SECRET_ACCESS_KEY"]
    except KeyError as e:
        sys.exit(f"Missing secret {e.args[0]} (set it as a GitHub Actions secret).")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
        # R2 does not need the newer default CRC checksums.
        config=Config(request_checksum_calculation="when_required",
                      response_checksum_validation="when_required"),
    )


def list_objects(s3, bucket: str) -> list[Obj]:
    out: list[Obj] = []
    token = None
    while True:
        kw = {"Bucket": bucket, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        r = s3.list_objects_v2(**kw)
        out += [Obj(o["Key"], int(o["Size"])) for o in r.get("Contents", [])]
        if not r.get("IsTruncated"):
            return out
        token = r["NextContinuationToken"]


def plan_upload(objects: list[Obj], key: str, new_size: int, limit: int = HARD_LIMIT) -> list[str] | None:
    """Keys to delete (oldest hourly first) so that the upload fits under `limit`,
    or None if it cannot fit even after deleting every hourly archive."""
    total = sum(o.size for o in objects if o.key != key) + new_size
    if total <= limit:
        return []
    hourly = sorted(
        (o for o in objects if HOURLY_RE.match(o.key) and o.key != key),
        key=lambda o: o.key,  # YYYYMMDDHH sorts chronologically
    )
    deletes = []
    for o in hourly:
        deletes.append(o.key)
        total -= o.size
        if total <= limit:
            return deletes
    return None


def cmd_usage(s3, bucket: str) -> None:
    objs = list_objects(s3, bucket)
    total = sum(o.size for o in objs)
    by_prefix: dict[str, int] = {}
    for o in objs:
        p = o.key.split("/", 1)[0]
        by_prefix[p] = by_prefix.get(p, 0) + o.size
    print(f"bucket {bucket}: {len(objs)} objects, {total / GB:.3f} GB "
          f"(target {TARGET / GB:.0f} GB, hard limit {HARD_LIMIT / GB:.0f} GB)")
    for p, s in sorted(by_prefix.items()):
        print(f"  {p}/: {s / GB:.3f} GB")


def cmd_upload(s3, bucket: str, path: Path, key: str, ctype: str | None, cache: str | None) -> None:
    size = path.stat().st_size
    objs = list_objects(s3, bucket)
    plan = plan_upload(objs, key, size)
    if plan is None:
        total = sum(o.size for o in objs)
        sys.exit(f"REFUSED: uploading {key} ({size / GB:.3f} GB) would take the bucket from "
                 f"{total / GB:.3f} GB above the {HARD_LIMIT / GB:.0f} GB hard limit, "
                 "even after deleting all hourly cloud files. Nothing was uploaded.")
    for k in plan:
        print(f"  freeing space: delete {k}")
        s3.delete_object(Bucket=bucket, Key=k)
    extra = {}
    if ctype:
        extra["ContentType"] = ctype
    if cache:
        extra["CacheControl"] = cache
    with open(path, "rb") as f:
        # Single PUT (one Class A op) for files under 5 GB; R2 allows up to 5 GiB per PUT.
        s3.put_object(Bucket=bucket, Key=key, Body=f, **extra)
    after = sum(o.size for o in objs if o.key not in plan and o.key != key) + size
    print(f"uploaded {key} ({size / 1e6:.1f} MB); bucket now ~{after / GB:.3f} GB")
    if after > TARGET:
        print(f"WARNING: bucket is above the {TARGET / GB:.0f} GB target.")


def cmd_prune_hourly(s3, bucket: str, keep_hours: int) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=keep_hours)
    removed = 0
    for o in list_objects(s3, bucket):
        m = HOURLY_RE.match(o.key)
        if not m:
            continue
        t = datetime.strptime(m.group(1), "%Y%m%d%H").replace(tzinfo=timezone.utc)
        if t < cutoff:
            s3.delete_object(Bucket=bucket, Key=o.key)  # deletes are free in R2
            removed += 1
    print(f"pruned {removed} hourly archives older than {keep_hours} h")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("usage")
    up = sub.add_parser("upload")
    up.add_argument("file")
    up.add_argument("key")
    up.add_argument("--type")
    up.add_argument("--cache")
    pr = sub.add_parser("prune-hourly")
    pr.add_argument("--keep-hours", type=int, default=24)
    de = sub.add_parser("delete")
    de.add_argument("key")
    a = ap.parse_args()

    bucket = bucket_name()
    s3 = client()
    if a.cmd == "usage":
        cmd_usage(s3, bucket)
    elif a.cmd == "upload":
        cmd_upload(s3, bucket, Path(a.file), a.key, a.type, a.cache)
    elif a.cmd == "prune-hourly":
        cmd_prune_hourly(s3, bucket, a.keep_hours)
    elif a.cmd == "delete":
        s3.delete_object(Bucket=bucket, Key=a.key)
        print(f"deleted {a.key}")


if __name__ == "__main__":
    main()
