import { useEffect, useMemo, useState } from "react";
import { api, buildQuery } from "../api.js";
import TagModal from "../components/TagModal.jsx";

const tabsInitial = { all_count: 0, other_count: 0, keyword_tabs: [] };
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

export default function UnreadPage() {
  const [tabs, setTabs] = useState(tabsInitial);
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [activeTab, setActiveTab] = useState({ type: "all" });
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [modalItem, setModalItem] = useState(null);
  const [page, setPage] = useState(1);
  const [metricsLoadingId, setMetricsLoadingId] = useState(null);

  const baseParams = useMemo(() => {
    const params = {
      tab: activeTab.type,
      q: search || undefined,
      sort: sortOrder === "asc" ? "published_asc" : "published_desc"
    };
    if (activeTab.type === "keyword") {
      params.keyword_id = activeTab.keywordId;
    }
    return params;
  }, [activeTab, search, sortOrder]);

  const queryParams = useMemo(() => {
    return buildQuery({
      ...baseParams,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    });
  }, [baseParams, page]);

  const loadItems = async () => {
    const response = await api.getUnreadItems(queryParams);
    setItems(response.items);
    setTotalCount(response.total ?? 0);
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

  useEffect(() => {
    setPage(1);
  }, [baseParams]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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

  const handleFetchMetrics = async (item) => {
    setMetricsLoadingId(item.id);
    try {
      await api.fetchItemMetrics(item.id);
      loadItems();
    } finally {
      setMetricsLoadingId(null);
    }
  };

  const openItemLink = (link) => {
    window.open(link, "_blank", "noopener,noreferrer");
  };

  const handleCardKeyDown = (event, link) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openItemLink(link);
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
        {items.map((item) => (
          <article
            key={item.id}
            className="card card-clickable"
            role="link"
            tabIndex={0}
            onClick={() => openItemLink(item.link)}
            onKeyDown={(event) => handleCardKeyDown(event, item.link)}
          >
            <div className="card-meta">
              <span className="chip">{item.site_name}</span>
              <span>{formatDate(item.published_at, item.published_date)}</span>
              <span>{item.creator_name || "-"}</span>
            </div>
            <h3 className="card-title">{item.title}</h3>
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="card-link"
              onClick={(event) => event.stopPropagation()}
            >
              {item.link}
            </a>
            {renderMetrics(item)}
            <div className="card-actions">
              <div className="card-actions-left">
                <button
                  className="primary"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setModalItem(item);
                  }}
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleIgnore(item.id);
                  }}
                >
                  削除
                </button>
              </div>
              <div className="card-actions-right">
                {item.link.startsWith(NOTE_DOMAIN_PREFIX) && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleFetchMetrics(item);
                    }}
                    disabled={metricsLoadingId === item.id}
                  >
                    {metricsLoadingId === item.id ? "取得中..." : "情報取得"}
                  </button>
                )}
                {item.creator_name && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleBlock(item);
                    }}
                  >
                    block
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="empty">未評価の記事がありません。</p>}
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