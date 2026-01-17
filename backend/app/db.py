from __future__ import annotations

import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.getenv("RSS_DB_PATH", DATA_DIR / "rss_reader.db"))
SCHEMA_PATH = BASE_DIR / "schema.sql"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 3000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"schema file not found: {SCHEMA_PATH}")
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with get_connection() as conn:
        conn.executescript(schema)
        ensure_item_metrics_columns(conn)
        conn.commit()


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]


def ensure_item_metrics_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(items)").fetchall()}
    column_defs = {
        "metrics_status": "TEXT NOT NULL DEFAULT 'pending' CHECK (metrics_status IN ('pending','done','failed'))",
        "metrics_fetched_at": "TEXT",
        "has_purechase_cta": "INTEGER",
        "total_character_count": "INTEGER",
        "h2_count": "INTEGER",
        "h3_count": "INTEGER",
        "img_count": "INTEGER",
        "link_count": "INTEGER",
        "p_count": "INTEGER",
        "br_in_p_count": "INTEGER",
        "period_count": "INTEGER",
    }
    for name, definition in column_defs.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE items ADD COLUMN {name} {definition}")