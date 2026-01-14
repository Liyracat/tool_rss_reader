import { useEffect, useMemo, useState } from "react";
import { api, buildQuery } from "../api.js";
import TagModal from "../components/TagModal.jsx";

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

export default function SavedPage() {
  const [filters, setFilters] = useState({
    sourceId: "",
    status: "",
    dateFrom: "",
    dateTo: "",
    tag: "",
    q: "",
    sort: "published_desc"
  });
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [tags, setTags] = useState([]);
  const [editItem, setEditItem] = useState(null);

  const queryParams = useMemo(() => {
    return buildQuery({
      source_id: filters.sourceId || undefined,
      status: filters.status || undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      tag: filters.tag || undefined,
      q: filters.q || undefined,
      sort: filters.sort
    });
  }, [filters]);

  const loadFilters = async () => {
    const [sourceData, tagData] = await Promise.all([api.listSources(), api.listTags()]);
    setSources(sourceData);
    setTags(tagData);
  };

  const loadItems = async () => {
    const response = await api.getSavedItems(queryParams);
    setItems(response.items);
  };

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    loadItems();
  }, [queryParams]);

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
            </div>
            <h3 className="card-title">{item.title}</h3>
            <a href={item.link} target="_blank" rel="noreferrer" className="card-link">
              {item.link}
            </a>
            <div className="card-actions">
              <button className="primary" type="button" onClick={() => setEditItem(item)}>
                編集
              </button>
              <button type="button" onClick={() => handleToggleStatus(item)}>
                {item.status === "saved" ? "削除" : "保存"}
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="empty">保存記事がありません。</p>}
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