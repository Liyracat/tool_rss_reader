import { useEffect, useMemo, useState } from "react";
import { api, buildQuery } from "../api.js";
import TagModal from "../components/TagModal.jsx";

const tabsInitial = { all_count: 0, other_count: 0, keyword_tabs: [] };

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

export default function UnreadPage() {
  const [tabs, setTabs] = useState(tabsInitial);
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState({ type: "all" });
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [modalItem, setModalItem] = useState(null);

  const queryParams = useMemo(() => {
    const params = {
      tab: activeTab.type,
      q: search || undefined
    };
    if (activeTab.type === "keyword") {
      params.keyword_id = activeTab.keywordId;
    }
    return buildQuery(params);
  }, [activeTab, search]);

  const loadItems = async () => {
    const response = await api.getUnreadItems(queryParams);
    setItems(response.items);
  };

  const loadTabs = async () => {
    const response = await api.getUnreadTabs();
    setTabs(response);
  };

  useEffect(() => {
    loadTabs();
  }, []);

  useEffect(() => {
    loadItems();
  }, [queryParams]);

  const sortedItems = useMemo(() => {
    const getTimestamp = (item) => {
      const raw = item.published_at || item.published_date;
      const timestamp = Date.parse(raw);
      return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    return [...items].sort((a, b) => {
      const diff = getTimestamp(a) - getTimestamp(b);
      if (diff === 0) return 0;
      return sortOrder === "asc" ? diff : -diff;
    });
  }, [items, sortOrder]);

  const handleSave = async (tags) => {
    if (!modalItem) return;
    await api.saveItem(modalItem.id, tags);
    setModalItem(null);
    loadTabs();
    loadItems();
  };

  const handleIgnore = async (id) => {
    await api.ignoreItem(id);
    loadTabs();
    loadItems();
  };

  const handleBlock = async (item) => {
    if (!item.creator_name) return;
    try {
      await api.createAuthorRule({
        source_id: item.source_id,
        creator_name: item.creator_name,
        rule_type: "block"
      });
    } catch (error) {
      console.warn("failed to create author rule", error);
    }
    await handleIgnore(item.id);
  };

  return (
    <section className="page">
      <div className="page-header">
        <h2>未評価記事一覧</h2>
        <div className="page-header-actions">
          <input
            className="search-input"
            type="search"
            placeholder="タイトルを検索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
          >
            公開日: {sortOrder === "asc" ? "昇順" : "降順"}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab.type === "all" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab({ type: "all" })}
        >
          全て ({tabs.all_count})
        </button>
        {tabs.keyword_tabs.map((tab) => (
          <button
            key={tab.keyword_id}
            className={`tab ${activeTab.keywordId === tab.keyword_id ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab({ type: "keyword", keywordId: tab.keyword_id })}
          >
            {tab.keyword} ({tab.count})
          </button>
        ))}
        <button
          className={`tab ${activeTab.type === "other" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab({ type: "other" })}
        >
          その他 ({tabs.other_count})
        </button>
      </div>

      <div className="list">
        {sortedItems.map((item) => (
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
              <div className="card-actions-left">
                <button className="primary" type="button" onClick={() => setModalItem(item)}>
                  保存
                </button>
                <button type="button" onClick={() => handleIgnore(item.id)}>
                  削除
                </button>
              </div>
              {item.creator_name && (
                <button
                  className="card-actions-right"
                  type="button"
                  onClick={() => handleBlock(item)}
                >
                  block
                </button>
              )}
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="empty">未評価の記事がありません。</p>}
      </div>

      {modalItem && (
        <TagModal
          title="保存確認"
          actionLabel="保存"
          onClose={() => setModalItem(null)}
          onSubmit={handleSave}
        />
      )}
    </section>
  );
}