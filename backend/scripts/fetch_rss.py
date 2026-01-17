#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import logging
import sys
import time
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Tuple
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from dateutil import parser

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DIR = SCRIPT_DIR.parent
sys.path.append(str(BASE_DIR))

from app.db import get_connection, init_db  # noqa: E402
from app.metrics import NOTE_DOMAIN_PREFIX, process_item_metrics  # noqa: E402

LOG_DIR = BASE_DIR / "logs"
LOG_FILE = LOG_DIR / "fetch.log"
DATA_DIR = BASE_DIR / "data"
LOCK_FILE = DATA_DIR / "fetch.lock"

USER_AGENT = "rss-reader-fetcher/1.0"
REQUEST_TIMEOUT = 30


def setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("fetch_rss")
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setFormatter(formatter)

    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)

    return logger


def normalize_link(link: str) -> str:
    normalized = link.strip()
    if normalized.endswith("/"):
        normalized = normalized.rstrip("/")
    return normalized


def fingerprint_for_link(link: str) -> str:
    normalized = normalize_link(link)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def text_from_child(element: ET.Element, name: str) -> str | None:
    for child in element:
        if local_name(child.tag) == name:
            if child.text and child.text.strip():
                return child.text.strip()
            href = child.attrib.get("href")
            if href:
                return href.strip()
    return None


def normalize_tag_name(tag: str) -> str:
    if ":" in tag:
        return tag.split(":", 1)[1]
    return tag


def normalize_creator_tag(creator_tag: str) -> str:
    return creator_tag.split(":", 1)[-1].strip()


def extract_creator_name(entry: ET.Element, creator_tag: str) -> str | None:
    tag_name = normalize_creator_tag(creator_tag)
    for child in entry:
        if local_name(child.tag) == tag_name:
            if child.text and child.text.strip():
                return child.text.strip()
            nested_name = text_from_child(child, "name")
            if nested_name:
                return nested_name
            attrib_name = child.attrib.get("name")
            if attrib_name and attrib_name.strip():
                return attrib_name.strip()
    return None


def load_blocked_authors(conn, source_id: int) -> set[str]:
    rows = conn.execute(
        "SELECT creator_name FROM author_rules WHERE source_id = ? AND rule_type = 'block'",
        (source_id,),
    ).fetchall()
    return {row["creator_name"] for row in rows}


def parse_pub_date(pub_date: str | None) -> Tuple[str | None, str | None]:
    if not pub_date:
        return None, None
    try:
        parsed = parser.parse(pub_date)
        return parsed.isoformat(), None
    except (ValueError, OverflowError):
        return None, fallback_date(pub_date)


def fallback_date(pub_date: str) -> str:
    for token in ("-", "/"):
        if token in pub_date:
            parts = pub_date.split(token)
            if len(parts) >= 3 and all(part.strip().isdigit() for part in parts[:3]):
                year, month, day = (part.strip().zfill(2) for part in parts[:3])
                return f"{year}-{month}-{day}"
    return datetime.now(timezone.utc).date().isoformat()


def fetch_feed(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def iter_entries(root: ET.Element) -> Iterable[ET.Element]:
    entries = [element for element in root.iter() if local_name(element.tag) == "item"]
    if entries:
        return entries
    return [element for element in root.iter() if local_name(element.tag) == "entry"]


def process_source(conn, logger: logging.Logger, source: dict) -> bool:
    source_id = source["id"]
    feed_url = source["feed_url"]
    creator_tag = source["creator_tag"]
    blocked_authors = load_blocked_authors(conn, source_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        xml_text = fetch_feed(feed_url)
        root = ET.fromstring(xml_text)
        inserted = 0
        for entry in iter_entries(root):
            title = text_from_child(entry, "title")
            link = text_from_child(entry, "link")
            pub_date = text_from_child(entry, "pubDate")
            if not pub_date:
                pub_date = text_from_child(entry, "published") or text_from_child(entry, "updated")
            if not title or not link:
                logger.info("skip item: missing title/link source_id=%s", source_id)
                continue
            creator_name = extract_creator_name(entry, creator_tag)
            if creator_name and creator_name in blocked_authors:
                logger.info(
                    "skip item: blocked author source_id=%s creator=%s", source_id, creator_name
                )
                continue
            published_at, published_date = parse_pub_date(pub_date)
            fingerprint = fingerprint_for_link(link)
            conn.execute(
                """
                INSERT OR IGNORE INTO items
                    (source_id, title, link, creator_name, published_at, published_date, fingerprint)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (source_id, title, link, creator_name, published_at, published_date, fingerprint),
            )
            inserted += 1
        conn.execute(
            "UPDATE sources SET last_fetched_at = ? WHERE id = ?",
            (now_iso, source_id),
        )
        conn.commit()
        logger.info(
            "fetched source_id=%s url=%s items=%s", source_id, feed_url, inserted
        )
        return True
    except Exception:
        logger.exception("failed source_id=%s url=%s", source_id, feed_url)
        with suppress(Exception):
            conn.execute(
                "UPDATE sources SET last_fetched_at = ? WHERE id = ?",
                (now_iso, source_id),
            )
            conn.commit()
        return False


def acquire_lock() -> bool:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        LOCK_FILE.touch(exist_ok=False)
    except FileExistsError:
        return False
    return True


def release_lock() -> None:
    with suppress(FileNotFoundError):
        LOCK_FILE.unlink()


def main() -> int:
    logger = setup_logger()
    if not acquire_lock():
        logger.info("lock exists, exiting")
        return 0

    try:
        init_db()
        has_error = False
        with get_connection() as conn:
            sources = conn.execute(
                "SELECT id, feed_url, creator_tag FROM sources WHERE is_enabled = 1"
            ).fetchall()
            for row in sources:
                if not process_source(conn, logger, dict(row)):
                    has_error = True
            pending_items = conn.execute(
                """
                SELECT id, link FROM items
                WHERE metrics_status = 'pending'
                AND link LIKE ?
                ORDER BY COALESCE(published_at, published_date) DESC
                LIMIT 10
                """,
                (f"{NOTE_DOMAIN_PREFIX}%",),
            ).fetchall()
            for item in pending_items:
                try:
                    process_item_metrics(conn, item["id"], item["link"])
                except Exception:
                    logger.exception("failed metrics item_id=%s", item["id"])
                time.sleep(5)
            deleted = conn.execute(
                """
                DELETE FROM items
                WHERE status = 'ignored'
                  AND updated_at <= datetime('now', '-24 hours')
                """
            ).rowcount
            if deleted:
                logger.info("deleted ignored items count=%s", deleted)
            conn.commit()
        return 1 if has_error else 0
    finally:
        release_lock()


if __name__ == "__main__":
    raise SystemExit(main())