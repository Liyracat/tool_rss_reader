import { useEffect, useMemo, useState } from "react";
import { api, buildQuery } from "../api.js";
import TagModal from "../components/TagModal.jsx";

const PAGE_SIZE = 50;
const NOTE_DOMAIN_PREFIX = "https://note.com/";

function formatDate(value, fallback) {
  if (!value && !fallback) return "-";
  const raw = value || fallback;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return fallback || value;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function formatCta(value) {
  if (value === 1) return "○";
  if (value === 0) return "×";
  return "-";
}

function formatCount(value) {
  if (value === null || value === undefined) return "-";
  return value;
}

function formatRatio(item) {
  const total = Number(item.total_character_count);
  const pCount = Number(item.p_count) || 0;
  const brCount = Number(item.br_in_p_count) || 0;
  const denominator = pCount + brCount;
  if (!Number.isFinite(total) || denominator <= 0) return "-";
  return (total / denominator).toFixed(2);
}

export default function SavedPage() {
  const [filters, setFilters] = useState({
    sourceId: "",
    status: "saved",
    dateFrom: "",
    dateTo: "",
    tag: "",
    q: "",
    sort: "published_desc"
  });
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [sources, setSources] = useState([]);
  const [tags, setTags] = useState([]);
  const [editItem, setEditItem] = useState(null);
  const [page, setPage] = useState(1);
  const [metricsLoadingId, setMetricsLoadingId] = useState(null);

  const baseParams = useMemo(() => {
    return {
      source_id: filters.sourceId || undefined,
      status: filters.status || undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      tag: filters.tag || undefined,
      q: filters.q || undefined,
      sort: filters.sort
    };
  }, [filters]);

  const queryParams = useMemo(() => {
    return buildQuery({
      ...baseParams,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    });
  }, [baseParams, page]);

  const loadFilters = async () => {
    const [sourceData, tagData] = await Promise.all([api.listSources(), api.listTags()]);
    setSources(sourceData);
    setTags(tagData);
  };

  const loadItems = async () => {
    const response = await api.getSavedItems(queryParams);
    setItems(response.items);
    setTotalCount(response.total ?? 0);
  };

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    loadItems();
  }, [queryParams]);

  useEffect(() => {
    setPage(1);
  }, [baseParams]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleEdit = async (tagsValue) => {
    if (!editItem) return;
    await api.updateItemTags(editItem.id, tagsValue);
    setEditItem(null);
  };

  const handleToggleStatus = async (item) => {
    if (item.status === "saved") {
      await api.ignoreItem(item.id);
    } else {
      await api.unsaveItem(item.id);
    }
    loadItems();
  };

  const handleFetchMetrics = async (item) => {
    setMetricsLoadingId(item.id);
    try {
      await api.fetchItemMetrics(item.id);
      loadItems();
    } finally {
      setMetricsLoadingId(null);
    }
  };

  const renderMetrics = (item) => (
    <div className="card-metrics">
      <span className={item.has_purechase_cta === 1 ? "metric-alert" : undefined}>
        課: {formatCta(item.has_purechase_cta)}
      </span> |{" "}
      <span className={item.total_character_count < 200 && item.total_character_count != null ? "metric-alert" : undefined}>
        合計: {formatCount(item.total_character_count)}
      </span> |{" "}
      <span className={item.h2_count != 0 && item.total_character_count / item.h2_count < 200 && item.total_character_count > 500 ? "metric-alert" : undefined}>
        h2: {formatCount(item.h2_count)}
      </span> |{" "}
      <span className={item.h3_count != 0 && item.total_character_count / item.h3_count < 120 && item.total_character_count > 500 ? "metric-alert" : undefined}>
      h3: {formatCount(item.h3_count)}
      </span> |{" "}
      img: {formatCount(item.img_count)} |{" "}
      link: {formatCount(item.link_count)} |{" "}
      p: {formatCount(item.p_count)} |{" "}
      <span className={item.br_in_p_count < item.p_count * 0.7 ? "metric-alert" : undefined}>
        br: {formatCount(item.br_in_p_count)}
      </span> |{" "}
      <span className={formatRatio(item) > 50 || formatRatio(item) < 10 ? "metric-alert" : undefined}>
        文字数/改行: {formatRatio(item)}
      </span> |{" "}
      <span className={item.period_count > (item.p_count + item.br_in_p_count) ? "metric-alert" : undefined}>
        句点: {formatCount(item.period_count)}
      </span>
    </div>
  );

  return (
    <section className="page">
      <div className="page-header">
        <h2>保存記事一覧</h2>
      </div>

      <div className="filters">
        <label>
          サイト
          <select
            value={filters.sourceId}
            onChange={(event) => setFilters({ ...filters, sourceId: event.target.value })}
          >
            <option value="">全て</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.site_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          公開日（開始）
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
          />
        </label>
        <label>
          公開日（終了）
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
          />
        </label>
        <label>
          ステータス
          <select
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">すべて</option>
            <option value="saved">保存</option>
            <option value="ignored">削除</option>
          </select>
        </label>
        <label>
          タグ
          <select
            value={filters.tag}
            onChange={(event) => setFilters({ ...filters, tag: event.target.value })}
          >
            <option value="">未指定</option>
            {tags.map((tag) => (
              <option key={tag.name} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          キーワード
          <input
            type="text"
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </label>
        <label>
          表示順
          <select
            value={filters.sort}
            onChange={(event) => setFilters({ ...filters, sort: event.target.value })}
          >
            <option value="published_desc">公開時刻降順</option>
            <option value="published_asc">公開時刻昇順</option>
          </select>
        </label>
      </div>

      <div className="list">
        {items.map((item) => (
          <article key={item.id} className="card">
            <div className="card-meta">
              <span className="chip">{item.site_name}</span>
              <span>{formatDate(item.published_at, item.published_date)}</span>
              <span>{item.creator_name || "-"}</span>
            </div>
            <h3 className="card-title">{item.title}</h3>
            <a href={item.link} target="_blank" rel="noreferrer" className="card-link">
              {item.link}
            </a>
            {renderMetrics(item)}
            <div className="card-actions">
              <div className="card-actions-left">
                <button className="primary" type="button" onClick={() => setEditItem(item)}>
                  編集
                </button>
                <button type="button" onClick={() => handleToggleStatus(item)}>
                  {item.status === "saved" ? "削除" : "保存"}
                </button>
              </div>
              <div className="card-actions-right">
                {item.link.startsWith(NOTE_DOMAIN_PREFIX) && (
                  <button
                    type="button"
                    onClick={() => handleFetchMetrics(item)}
                    disabled={metricsLoadingId === item.id}
                  >
                    {metricsLoadingId === item.id ? "取得中..." : "情報取得"}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="empty">保存記事がありません。</p>}
      </div>

      <div className="pager">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page === 1}
        >
          前へ
        </button>
        <span>
          {page} / {totalPages} (全{totalCount}件)
        </span>
        <button
          type="button"
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={page === totalPages}
        >
          次へ
        </button>
      </div>

      {editItem && (
        <TagModal
          title="タグ編集"
          actionLabel="編集"
          onClose={() => setEditItem(null)}
          onSubmit={handleEdit}
        />
      )}
    </section>
  );
}