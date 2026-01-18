from __future__ import annotations

from datetime import datetime
import logging
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

from .db import get_connection, init_db, rows_to_dicts
from .metrics import process_item_metrics, should_auto_block_item

SourceType = Literal["search", "tag", "user", "magazine"]
ItemStatus = Literal["unread", "saved", "ignored"]
RuleTypeAuthor = Literal["block", "allow", "boost"]
RuleTypeKeyword = Literal["mute", "boost", "tab"]


class SourceIn(BaseModel):
    site_name: str
    feed_url: HttpUrl
    source_type: SourceType
    creator_tag: str = "note:creatorName"
    is_enabled: bool = True
    fetch_interval_min: int = 180


class SourceOut(SourceIn):
    id: int
    last_fetched_at: Optional[str] = None
    created_at: Optional[str] = None


class ItemOut(BaseModel):
    id: int
    source_id: int
    site_name: str
    title: str
    link: HttpUrl
    creator_name: Optional[str] = None
    published_at: Optional[str] = None
    published_date: Optional[str] = None
    status: ItemStatus
    metrics_status: Optional[str] = None
    metrics_fetched_at: Optional[str] = None
    has_purechase_cta: Optional[int] = None
    total_character_count: Optional[int] = None
    h2_count: Optional[int] = None
    h3_count: Optional[int] = None
    img_count: Optional[int] = None
    link_count: Optional[int] = None
    p_count: Optional[int] = None
    br_in_p_count: Optional[int] = None
    period_count: Optional[int] = None


class TagsIn(BaseModel):
    tags: list[str]


class AuthorRuleIn(BaseModel):
    source_id: int
    creator_name: str
    rule_type: RuleTypeAuthor
    memo: Optional[str] = None


class KeywordRuleIn(BaseModel):
    keyword: str
    rule_type: RuleTypeKeyword


class FetchJobRequest(BaseModel):
    source_ids: Optional[list[int]] = None


class FetchJobStatus(BaseModel):
    last_run_at: Optional[str]
    last_run_sources: list[int]
    last_error: Optional[str]


app = FastAPI(title="RSS Reader")
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5175"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

job_status = FetchJobStatus(last_run_at=None, last_run_sources=[], last_error=None)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/items/unread", response_model=dict)
def list_unread_items(
    source_id: Optional[int] = None,
    tab: Optional[str] = Query(default=None, pattern="^(all|other|keyword)?$"),
    keyword_id: Optional[int] = None,
    keyword: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "published_desc",
) -> dict:
    params: list[object] = []
    where = ["i.status = 'unread'"]

    if source_id is not None:
        where.append("i.source_id = ?")
        params.append(source_id)

    if q:
        where.append("i.title LIKE ?")
        params.append(f"%{q}%")

    keyword_filter = None
    if tab == "keyword":
        if keyword_id is not None:
            keyword_filter = ("SELECT keyword FROM keyword_rules WHERE id = ?", [keyword_id])
        elif keyword:
            keyword_filter = ("SELECT ? as keyword", [keyword])
        else:
            raise HTTPException(status_code=400, detail="keyword_id or keyword is required for keyword tab")

    if tab == "other":
        where.append(
            "NOT EXISTS (SELECT 1 FROM keyword_rules kr "
            "WHERE kr.rule_type = 'tab' AND i.title LIKE '%' || kr.keyword || '%')"
        )

    if keyword_filter:
        keyword_query, keyword_params = keyword_filter
        where.append(
            f"EXISTS (SELECT 1 FROM ({keyword_query}) kw "
            "WHERE i.title LIKE '%' || kw.keyword || '%')"
        )
        params.extend(keyword_params)

    order_by = "COALESCE(i.published_at, i.published_date) DESC"
    if sort == "published_asc":
        order_by = "COALESCE(i.published_at, i.published_date) ASC"
    elif sort == "fetched_desc":
        order_by = "i.fetched_at DESC"
    elif sort == "fetched_asc":
        order_by = "i.fetched_at ASC"

    where_clause = " AND ".join(where)
    query = (
        "SELECT i.id, i.source_id, s.site_name, i.title, i.link, i.creator_name, "
        "i.published_at, i.published_date, i.status, i.metrics_status, "
        "i.metrics_fetched_at, i.has_purechase_cta, i.total_character_count, "
        "i.h2_count, i.h3_count, i.img_count, i.link_count, i.p_count, "
        "i.br_in_p_count, i.period_count "
        "FROM items i JOIN sources s ON s.id = i.source_id "
        f"WHERE {where_clause} "
        f"ORDER BY {order_by}"
    )
    count_params = list(params)
    query += " LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with get_connection() as conn:
        logger.info("DBクエリ開始: list_unread_items")
        ignored_params: list[object] = []
        ignored_where = ["items.status = 'unread'"]
        if source_id is not None:
            ignored_where.append("items.source_id = ?")
            ignored_params.append(source_id)
        conn.execute(
            "UPDATE items SET status = 'ignored' "
            f"WHERE {' AND '.join(ignored_where)} "
            "AND EXISTS ("
            "SELECT 1 FROM author_rules ar "
            "WHERE ar.rule_type = 'block' "
            "AND ar.source_id = items.source_id "
            "AND ar.creator_name = items.creator_name"
            ")",
            ignored_params,
        )
        conn.commit()
        count_query = f"SELECT COUNT(*) FROM items i WHERE {where_clause}"
        total = conn.execute(count_query, count_params).fetchone()[0]
        rows = conn.execute(query, params).fetchall()
        logger.info("DBクエリ終了: list_unread_items")

    logger.info("JSON化開始: list_unread_items")
    items = rows_to_dicts(rows)
    logger.info("JSON化終了: list_unread_items")
    return {"items": items, "total": total}


@app.get("/items/unread/tabs", response_model=dict)
def unread_tabs() -> dict:
    with get_connection() as conn:
        logger.info("DBクエリ開始: unread_tabs")
        total = conn.execute("SELECT COUNT(*) FROM items WHERE status = 'unread'").fetchone()[0]
        keyword_tabs = conn.execute(
            "SELECT kr.id, kr.keyword, "
            "(SELECT COUNT(*) FROM items i "
            "WHERE i.status = 'unread' "
            "AND i.title LIKE '%' || kr.keyword || '%') AS count "
            "FROM keyword_rules kr WHERE kr.rule_type = 'tab'"
        ).fetchall()
        other_count = conn.execute(
            "SELECT COUNT(*) FROM items i "
            "WHERE i.status = 'unread' "
            "AND NOT EXISTS (SELECT 1 FROM keyword_rules kr "
            "WHERE kr.rule_type = 'tab' AND i.title LIKE '%' || kr.keyword || '%')"
        ).fetchone()[0]
        logger.info("DBクエリ終了: unread_tabs")

    logger.info("JSON化開始: unread_tabs")
    response = {
        "all_count": total,
        "other_count": other_count,
        "keyword_tabs": [
            {"keyword_id": row[0], "keyword": row[1], "count": row[2]} for row in keyword_tabs
        ],
    }
    logger.info("JSON化終了: unread_tabs")
    return response


@app.post("/items/{item_id}/save", response_model=ItemOut)
def save_item(item_id: int, payload: TagsIn) -> ItemOut:
    with get_connection() as conn:
        conn.execute("UPDATE items SET status = 'saved' WHERE id = ?", (item_id,))
        update_item_tags(conn, item_id, payload.tags)
        row = conn.execute(
            "SELECT i.id, i.source_id, s.site_name, i.title, i.link, i.creator_name, "
            "i.published_at, i.published_date, i.status, i.metrics_status, "
            "i.metrics_fetched_at, i.has_purechase_cta, i.total_character_count, "
            "i.h2_count, i.h3_count, i.img_count, i.link_count, i.p_count, "
            "i.br_in_p_count, i.period_count "
            "FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="item not found")
        conn.commit()
        return ItemOut(**dict(row))


@app.post("/items/{item_id}/ignore")
def ignore_item(item_id: int) -> dict:
    with get_connection() as conn:
        cur = conn.execute("UPDATE items SET status = 'ignored' WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="item not found")
        conn.commit()
    return {"status": "ignored"}


@app.post("/items/{item_id}/unsave")
def unsave_item(item_id: int) -> dict:
    with get_connection() as conn:
        cur = conn.execute("UPDATE items SET status = 'saved' WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="item not found")
        conn.commit()
    return {"status": "saved"}


@app.get("/items/saved", response_model=dict)
def list_saved_items(
    source_id: Optional[int] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "published_desc",
) -> dict:
    params: list[object] = []
    where = ["i.status IN ('saved','ignored')"]

    if source_id is not None:
        where.append("i.source_id = ?")
        params.append(source_id)

    if status:
        where.append("i.status = ?")
        params.append(status)

    if q:
        where.append("i.title LIKE ?")
        params.append(f"%{q}%")

    if date_from:
        where.append("date(COALESCE(i.published_at, i.published_date)) >= date(?)")
        params.append(date_from)

    if date_to:
        where.append("date(COALESCE(i.published_at, i.published_date)) <= date(?)")
        params.append(date_to)

    join_tags = ""
    if tag:
        join_tags = "JOIN item_tags it ON it.item_id = i.id JOIN tags t ON t.id = it.tag_id"
        where.append("t.name = ?")
        params.append(tag)

    order_by = "COALESCE(i.published_at, i.published_date) DESC"
    if sort == "published_asc":
        order_by = "COALESCE(i.published_at, i.published_date) ASC"
    elif sort == "fetched_desc":
        order_by = "i.fetched_at DESC"
    elif sort == "fetched_asc":
        order_by = "i.fetched_at ASC"

    where_clause = " AND ".join(where)
    query = (
        "SELECT i.id, i.source_id, s.site_name, i.title, i.link, i.creator_name, "
        "i.published_at, i.published_date, i.status, i.metrics_status, "
        "i.metrics_fetched_at, i.has_purechase_cta, i.total_character_count, "
        "i.h2_count, i.h3_count, i.img_count, i.link_count, i.p_count, "
        "i.br_in_p_count, i.period_count "
        "FROM items i JOIN sources s ON s.id = i.source_id "
        f"{join_tags} "
        f"WHERE {where_clause} "
        f"ORDER BY {order_by} LIMIT ? OFFSET ?"
    )
    count_query = f"SELECT COUNT(*) FROM items i {join_tags} WHERE {where_clause}"
    count_params = list(params)
    params.extend([limit, offset])

    with get_connection() as conn:
        logger.info("DBクエリ開始: list_saved_items")
        total = conn.execute(count_query, count_params).fetchone()[0]
        rows = conn.execute(query, params).fetchall()
        logger.info("DBクエリ終了: list_saved_items")

    logger.info("JSON化開始: list_saved_items")
    items = rows_to_dicts(rows)
    logger.info("JSON化終了: list_saved_items")
    return {"items": items, "total": total}


@app.get("/items/{item_id}")
def get_item(item_id: int) -> dict:
    with get_connection() as conn:
        logger.info("DBクエリ開始: get_item")
        row = conn.execute(
            "SELECT i.*, s.site_name FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="item not found")
        tags = conn.execute(
            "SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ?",
            (item_id,),
        ).fetchall()
        logger.info("DBクエリ終了: get_item")

    logger.info("JSON化開始: get_item")
    item = dict(row)
    item["tags"] = [tag[0] for tag in tags]
    logger.info("JSON化終了: get_item")
    return item


@app.post("/items/{item_id}/metrics")
def fetch_item_metrics(item_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, link FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="item not found")
        try:
            metrics = process_item_metrics(conn, row["id"], row["link"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            logger.exception("failed to fetch metrics item_id=%s", item_id)
            raise HTTPException(status_code=500, detail="failed to fetch metrics") from exc
        metrics_row = conn.execute(
            """
            SELECT source_id, creator_name, total_character_count, h2_count, h3_count,
                   p_count, br_in_p_count, period_count
            FROM items WHERE id = ?
            """,
            (item_id,),
        ).fetchone()
        if metrics_row and metrics_row["creator_name"] and should_auto_block_item(dict(metrics_row)):
            try:
                conn.execute(
                    """
                    INSERT INTO author_rules (source_id, creator_name, rule_type)
                    VALUES (?, ?, 'block')
                    """,
                    (metrics_row["source_id"], metrics_row["creator_name"]),
                )
            except Exception as exc:
                if "UNIQUE" not in str(exc):
                    raise
            conn.execute("UPDATE items SET status = 'ignored' WHERE id = ?", (item_id,))
            conn.commit()
    return {"status": "done", "metrics": metrics}


@app.put("/items/{item_id}/tags")
def update_tags(item_id: int, payload: TagsIn) -> dict:
    with get_connection() as conn:
        update_item_tags(conn, item_id, payload.tags)
        conn.commit()
    return {"tags": payload.tags}


@app.get("/tags")
def list_tags(q: Optional[str] = None) -> list[dict]:
    where = ""
    params: list[object] = []
    if q:
        where = "WHERE t.name LIKE ?"
        params.append(f"%{q}%")
    query = (
        "SELECT t.name, COUNT(it.item_id) as count "
        "FROM tags t LEFT JOIN item_tags it ON it.tag_id = t.id "
        f"{where} GROUP BY t.id ORDER BY count DESC"
    )
    with get_connection() as conn:
        logger.info("DBクエリ開始: list_tags")
        rows = conn.execute(query, params).fetchall()
        logger.info("DBクエリ終了: list_tags")
    logger.info("JSON化開始: list_tags")
    result = rows_to_dicts(rows)
    logger.info("JSON化終了: list_tags")
    return result


@app.get("/sources", response_model=list[SourceOut])
def list_sources(
    enabled: Optional[bool] = None,
    source_type: Optional[str] = None,
) -> list[SourceOut]:
    where = []
    params: list[object] = []
    if enabled is not None:
        where.append("is_enabled = ?")
        params.append(1 if enabled else 0)
    if source_type:
        where.append("source_type = ?")
        params.append(source_type)

    where_clause = ""
    if where:
        where_clause = f"WHERE {' AND '.join(where)}"

    query = (
        "SELECT id, site_name, feed_url, source_type, creator_tag, is_enabled, "
        "fetch_interval_min, last_fetched_at, created_at FROM sources "
        f"{where_clause} ORDER BY created_at DESC"
    )

    with get_connection() as conn:
        logger.info("DBクエリ開始: list_sources")
        rows = conn.execute(query, params).fetchall()
        logger.info("DBクエリ終了: list_sources")

    logger.info("JSON化開始: list_sources")
    sources = [SourceOut(**row) for row in rows]
    logger.info("JSON化終了: list_sources")
    return sources


@app.post("/sources", response_model=SourceOut)
def create_source(payload: SourceIn) -> SourceOut:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO sources (site_name, feed_url, source_type, creator_tag, is_enabled, fetch_interval_min) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                payload.site_name,
                str(payload.feed_url),
                payload.source_type,
                payload.creator_tag,
                1 if payload.is_enabled else 0,
                payload.fetch_interval_min,
            ),
        )
        source_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, site_name, feed_url, source_type, creator_tag, is_enabled, "
            "fetch_interval_min, last_fetched_at, created_at FROM sources WHERE id = ?",
            (source_id,),
        ).fetchone()
        conn.commit()
    return SourceOut(**row)


@app.put("/sources/{source_id}", response_model=SourceOut)
def update_source(source_id: int, payload: SourceIn) -> SourceOut:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE sources SET site_name = ?, feed_url = ?, source_type = ?, creator_tag = ?, "
            "is_enabled = ?, fetch_interval_min = ? WHERE id = ?",
            (
                payload.site_name,
                str(payload.feed_url),
                payload.source_type,
                payload.creator_tag,
                1 if payload.is_enabled else 0,
                payload.fetch_interval_min,
                source_id,
            ),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="source not found")
        row = conn.execute(
            "SELECT id, site_name, feed_url, source_type, creator_tag, is_enabled, "
            "fetch_interval_min, last_fetched_at, created_at FROM sources WHERE id = ?",
            (source_id,),
        ).fetchone()
        conn.commit()
    return SourceOut(**row)


@app.delete("/sources/{source_id}")
def delete_source(source_id: int) -> dict:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="source not found")
        conn.commit()
    return {"deleted": True}


@app.get("/author-rules")
def list_author_rules(
    source_id: Optional[int] = None,
    rule_type: Optional[str] = None,
    q: Optional[str] = None,
) -> list[dict]:
    where = []
    params: list[object] = []
    if source_id is not None:
        where.append("ar.source_id = ?")
        params.append(source_id)
    if rule_type:
        where.append("ar.rule_type = ?")
        params.append(rule_type)
    if q:
        where.append("ar.creator_name LIKE ?")
        params.append(f"%{q}%")

    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    query = (
        "SELECT ar.id, ar.source_id, s.site_name, ar.creator_name, ar.rule_type, ar.memo, "
        "ar.created_at FROM author_rules ar JOIN sources s ON s.id = ar.source_id "
        f"{where_clause} ORDER BY ar.created_at DESC"
    )

    with get_connection() as conn:
        logger.info("DBクエリ開始: list_author_rules")
        rows = conn.execute(query, params).fetchall()
        logger.info("DBクエリ終了: list_author_rules")

    logger.info("JSON化開始: list_author_rules")
    result = rows_to_dicts(rows)
    logger.info("JSON化終了: list_author_rules")
    return result


@app.post("/author-rules")
def create_author_rule(payload: AuthorRuleIn) -> dict:
    with get_connection() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO author_rules (source_id, creator_name, rule_type, memo) VALUES (?, ?, ?, ?)",
                (payload.source_id, payload.creator_name, payload.rule_type, payload.memo),
            )
        except Exception as exc:
            if "UNIQUE" in str(exc):
                raise HTTPException(status_code=409, detail="author rule already exists")
            raise
        rule_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, source_id, creator_name, rule_type, memo, created_at "
            "FROM author_rules WHERE id = ?",
            (rule_id,),
        ).fetchone()
        conn.commit()
    return dict(row)


@app.put("/author-rules/{rule_id}")
def update_author_rule(rule_id: int, payload: AuthorRuleIn) -> dict:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE author_rules SET source_id = ?, creator_name = ?, rule_type = ?, memo = ? WHERE id = ?",
            (payload.source_id, payload.creator_name, payload.rule_type, payload.memo, rule_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="author rule not found")
        row = conn.execute(
            "SELECT id, source_id, creator_name, rule_type, memo, created_at "
            "FROM author_rules WHERE id = ?",
            (rule_id,),
        ).fetchone()
        conn.commit()
    return dict(row)


@app.delete("/author-rules/{rule_id}")
def delete_author_rule(rule_id: int) -> dict:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM author_rules WHERE id = ?", (rule_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="author rule not found")
        conn.commit()
    return {"deleted": True}


@app.get("/keyword-rules")
def list_keyword_rules(rule_type: Optional[str] = None) -> list[dict]:
    where = []
    params: list[object] = []
    if rule_type:
        where.append("rule_type = ?")
        params.append(rule_type)
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    query = (
        "SELECT id, keyword, rule_type, created_at FROM keyword_rules "
        f"{where_clause} ORDER BY created_at DESC"
    )

    with get_connection() as conn:
        logger.info("DBクエリ開始: list_keyword_rules")
        rows = conn.execute(query, params).fetchall()
        logger.info("DBクエリ終了: list_keyword_rules")

    logger.info("JSON化開始: list_keyword_rules")
    result = rows_to_dicts(rows)
    logger.info("JSON化終了: list_keyword_rules")
    return result


@app.post("/keyword-rules")
def create_keyword_rule(payload: KeywordRuleIn) -> dict:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO keyword_rules (keyword, rule_type) VALUES (?, ?)",
            (payload.keyword, payload.rule_type),
        )
        rule_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, keyword, rule_type, created_at FROM keyword_rules WHERE id = ?",
            (rule_id,),
        ).fetchone()
        conn.commit()
    return dict(row)


@app.put("/keyword-rules/{rule_id}")
def update_keyword_rule(rule_id: int, payload: KeywordRuleIn) -> dict:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE keyword_rules SET keyword = ?, rule_type = ? WHERE id = ?",
            (payload.keyword, payload.rule_type, rule_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="keyword rule not found")
        row = conn.execute(
            "SELECT id, keyword, rule_type, created_at FROM keyword_rules WHERE id = ?",
            (rule_id,),
        ).fetchone()
        conn.commit()
    return dict(row)


@app.delete("/keyword-rules/{rule_id}")
def delete_keyword_rule(rule_id: int) -> dict:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM keyword_rules WHERE id = ?", (rule_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="keyword rule not found")
        conn.commit()
    return {"deleted": True}


@app.post("/jobs/fetch-now")
def fetch_now(payload: FetchJobRequest) -> dict:
    sources = payload.source_ids or []
    job_status.last_run_at = datetime.utcnow().isoformat() + "Z"
    job_status.last_run_sources = sources
    job_status.last_error = None
    return {"started": True, "source_ids": sources}


@app.get("/jobs/status", response_model=FetchJobStatus)
def fetch_status() -> FetchJobStatus:
    return job_status


def update_item_tags(conn, item_id: int, tags: list[str]) -> None:
    clean_tags = [tag.strip() for tag in tags if tag.strip()]
    conn.execute("DELETE FROM item_tags WHERE item_id = ?", (item_id,))
    if not clean_tags:
        return
    for tag in clean_tags:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (tag,)).fetchone()[0]
        conn.execute("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)", (item_id, tag_id))