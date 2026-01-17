from __future__ import annotations

from datetime import datetime, timezone
from html import unescape
from typing import Iterable
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup, NavigableString, Tag

NOTE_DOMAIN_PREFIX = "https://note.com/"
REQUEST_TIMEOUT = 30
USER_AGENT = "rss-reader-metrics/1.0"

PAYWALL_SELECTOR = (
    "#__layout > div > div:nth-child(1) > div:nth-child(3) > main > "
    "div.p-article__articleWrapper > article > div.p-article__paywall"
)
BODY_SELECTOR = (
    "#__layout > div > div:nth-child(1) > div:nth-child(3) > main > "
    "div.p-article__articleWrapper > article > div.p-article__content.pb-4 > "
    "div > div > div.note-common-styles__textnote-body"
)


def is_note_link(link: str) -> bool:
    return link.startswith(NOTE_DOMAIN_PREFIX)


def fetch_html(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def count_allowed_text(element: Tag, allowed_tags: set[str]) -> int:
    total = 0
    for descendant in element.descendants:
        if isinstance(descendant, NavigableString):
            parent = descendant.parent
            if parent and parent.name in allowed_tags:
                total += len(unescape(str(descendant)))
    return total


def has_ancestor(tag: Tag, names: set[str]) -> bool:
    return any(parent.name in names for parent in tag.parents if isinstance(parent, Tag))


def select_unique(elements: Iterable[Tag]) -> list[Tag]:
    seen: set[int] = set()
    unique = []
    for element in elements:
        identity = id(element)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(element)
    return unique


def extract_note_metrics(html: str) -> dict[str, int]:
    soup = BeautifulSoup(html, "html.parser")
    paywall_element = soup.select_one(PAYWALL_SELECTOR)
    body = soup.select_one(BODY_SELECTOR)
    if body is None:
        raise ValueError("note.com article body not found")

    has_purechase_cta = 1 if paywall_element is not None else 0

    h2_count = len(body.select("h2"))
    h3_count = len(body.select("h3"))
    img_count = len(body.select("figure > a > img"))
    iframe_count = len(body.select("figure > div > div > iframe"))

    p_elements = [p for p in body.select("p") if not has_ancestor(p, {"ul", "ol", "blockquote"})]
    blockquote_p = body.select("figure > blockquote > p")
    ul_items = body.select("ul > li")
    ol_items = body.select("ol > li")

    total_character_count = sum(count_allowed_text(p, {"p", "s", "a"}) for p in p_elements)
    total_character_count += sum(count_allowed_text(li, {"li", "s", "a"}) for li in ul_items)
    total_character_count += sum(count_allowed_text(li, {"li", "s", "a"}) for li in ol_items)
    total_character_count += sum(count_allowed_text(p, {"p", "s", "a"}) for p in blockquote_p)

    p_in_ul = body.select("ul > li p")
    p_in_ol = body.select("ol > li p")
    p_targets = select_unique([*p_elements, *p_in_ul, *p_in_ol, *blockquote_p])
    p_count = len(p_targets)

    br_in_p_count = sum(len(p.select("br")) for p in p_targets)
    period_count = sum(p.get_text().count("。") for p in p_targets)

    link_count = iframe_count
    link_count += sum(len(p.select("a")) for p in p_elements)
    link_count += len(body.select("ul > li a"))
    link_count += len(body.select("ol > li a"))
    link_count += sum(len(p.select("a")) for p in blockquote_p)

    return {
        "has_purechase_cta": has_purechase_cta,
        "total_character_count": total_character_count,
        "h2_count": h2_count,
        "h3_count": h3_count,
        "img_count": img_count,
        "link_count": link_count,
        "p_count": p_count,
        "br_in_p_count": br_in_p_count,
        "period_count": period_count,
    }


def process_item_metrics(conn, item_id: int, link: str) -> dict[str, int]:
    fetched_at = datetime.now(timezone.utc).isoformat()
    if not is_note_link(link):
        conn.execute(
            "UPDATE items SET metrics_status = 'failed', metrics_fetched_at = ? WHERE id = ?",
            (fetched_at, item_id),
        )
        conn.commit()
        raise ValueError("link is not note.com")

    try:
        html = fetch_html(link)
        metrics = extract_note_metrics(html)
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc) == "note.com article body not found":
            conn.execute(
                """
                UPDATE items
                SET metrics_status = 'done',
                    metrics_fetched_at = ?,
                    has_purechase_cta = 1
                WHERE id = ?
                """,
                (fetched_at, item_id),
            )
            conn.commit()
            return {"has_purechase_cta": 1}
        conn.execute(
            "UPDATE items SET metrics_status = 'failed', metrics_fetched_at = ? WHERE id = ?",
            (fetched_at, item_id),
        )
        conn.commit()
        raise

    conn.execute(
        """
        UPDATE items
        SET metrics_status = 'done',
            metrics_fetched_at = ?,
            has_purechase_cta = ?,
            total_character_count = ?,
            h2_count = ?,
            h3_count = ?,
            img_count = ?,
            link_count = ?,
            p_count = ?,
            br_in_p_count = ?,
            period_count = ?
        WHERE id = ?
        """,
        (
            fetched_at,
            metrics["has_purechase_cta"],
            metrics["total_character_count"],
            metrics["h2_count"],
            metrics["h3_count"],
            metrics["img_count"],
            metrics["link_count"],
            metrics["p_count"],
            metrics["br_in_p_count"],
            metrics["period_count"],
            item_id,
        ),
    )
    conn.commit()
    return metrics