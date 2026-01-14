import { useEffect, useState } from "react";
import { api } from "../api.js";

const emptySource = {
  site_name: "",
  feed_url: "",
  source_type: "search",
  creator_tag: "note:creatorName",
  is_enabled: true,
  fetch_interval_min: 120
};

const emptyAuthorRule = {
  source_id: "",
  creator_name: "",
  rule_type: "block",
  memo: ""
};

const emptyKeywordRule = {
  keyword: "",
  rule_type: "tab"
};

export default function SettingsPage() {
  const [sources, setSources] = useState([]);
  const [authorRules, setAuthorRules] = useState([]);
  const [keywordRules, setKeywordRules] = useState([]);
  const [sourceDraft, setSourceDraft] = useState(emptySource);
  const [authorDraft, setAuthorDraft] = useState(emptyAuthorRule);
  const [keywordDraft, setKeywordDraft] = useState(emptyKeywordRule);

  const loadData = async () => {
    const [sourceData, authorData, keywordData] = await Promise.all([
      api.listSources(),
      api.listAuthorRules(),
      api.listKeywordRules()
    ]);
    setSources(sourceData);
    setAuthorRules(authorData);
    setKeywordRules(keywordData);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSource = async () => {
    await api.createSource({
      ...sourceDraft,
      fetch_interval_min: Number(sourceDraft.fetch_interval_min)
    });
    setSourceDraft(emptySource);
    loadData();
  };

  const handleUpdateSource = async (source) => {
    await api.updateSource(source.id, {
      site_name: source.site_name,
      feed_url: source.feed_url,
      source_type: source.source_type,
      creator_tag: source.creator_tag,
      is_enabled: source.is_enabled,
      fetch_interval_min: Number(source.fetch_interval_min)
    });
    loadData();
  };

  const handleDeleteSource = async (id) => {
    await api.deleteSource(id);
    loadData();
  };

  const handleCreateAuthor = async () => {
    await api.createAuthorRule({
      ...authorDraft,
      source_id: Number(authorDraft.source_id)
    });
    setAuthorDraft(emptyAuthorRule);
    loadData();
  };

  const handleUpdateAuthor = async (rule) => {
    await api.updateAuthorRule(rule.id, {
      source_id: Number(rule.source_id),
      creator_name: rule.creator_name,
      rule_type: rule.rule_type,
      memo: rule.memo
    });
    loadData();
  };

  const handleDeleteAuthor = async (id) => {
    await api.deleteAuthorRule(id);
    loadData();
  };

  const handleCreateKeyword = async () => {
    await api.createKeywordRule(keywordDraft);
    setKeywordDraft(emptyKeywordRule);
    loadData();
  };

  const handleUpdateKeyword = async (rule) => {
    await api.updateKeywordRule(rule.id, {
      keyword: rule.keyword,
      rule_type: rule.rule_type
    });
    loadData();
  };

  const handleDeleteKeyword = async (id) => {
    await api.deleteKeywordRule(id);
    loadData();
  };

  return (
    <section className="page">
      <h2>設定</h2>

      <section className="panel">
        <h3>購読RSS一覧</h3>
        <div className="grid-form">
          <input
            type="text"
            placeholder="サイト名"
            value={sourceDraft.site_name}
            onChange={(event) => setSourceDraft({ ...sourceDraft, site_name: event.target.value })}
          />
          <input
            type="url"
            placeholder="RSS URL"
            value={sourceDraft.feed_url}
            onChange={(event) => setSourceDraft({ ...sourceDraft, feed_url: event.target.value })}
          />
          <select
            value={sourceDraft.source_type}
            onChange={(event) => setSourceDraft({ ...sourceDraft, source_type: event.target.value })}
          >
            <option value="search">search</option>
            <option value="tag">tag</option>
            <option value="user">user</option>
            <option value="magazine">magazine</option>
          </select>
          <input
            type="text"
            placeholder="著者タグ"
            value={sourceDraft.creator_tag}
            onChange={(event) => setSourceDraft({ ...sourceDraft, creator_tag: event.target.value })}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={sourceDraft.is_enabled}
              onChange={(event) => setSourceDraft({ ...sourceDraft, is_enabled: event.target.checked })}
            />
            有効
          </label>
          <input
            type="number"
            placeholder="同期間隔(分)"
            value={sourceDraft.fetch_interval_min}
            onChange={(event) =>
              setSourceDraft({ ...sourceDraft, fetch_interval_min: event.target.value })
            }
          />
          <button className="primary" type="button" onClick={handleCreateSource}>
            追加
          </button>
        </div>

        <div className="table">
          {sources.map((source) => (
            <div key={source.id} className="table-row">
              <input
                type="text"
                value={source.site_name}
                onChange={(event) =>
                  setSources((prev) =>
                    prev.map((item) =>
                      item.id === source.id ? { ...item, site_name: event.target.value } : item
                    )
                  )
                }
              />
              <input
                type="url"
                value={source.feed_url}
                onChange={(event) =>
                  setSources((prev) =>
                    prev.map((item) =>
                      item.id === source.id ? { ...item, feed_url: event.target.value } : item
                    )
                  )
                }
              />
              <select
                value={source.source_type}
                onChange={(event) =>
                  setSources((prev) =>
                    prev.map((item) =>
                      item.id === source.id ? { ...item, source_type: event.target.value } : item
                    )
                  )
                }
              >
                <option value="search">search</option>
                <option value="tag">tag</option>
                <option value="user">user</option>
                <option value="magazine">magazine</option>
              </select>
              <input
                type="text"
                value={source.creator_tag}
                onChange={(event) =>
                  setSources((prev) =>
                    prev.map((item) =>
                      item.id === source.id ? { ...item, creator_tag: event.target.value } : item
                    )
                  )
                }
              />
              <label className="inline">
                <input
                  type="checkbox"
                  checked={Boolean(source.is_enabled)}
                  onChange={(event) =>
                    setSources((prev) =>
                      prev.map((item) =>
                        item.id === source.id ? { ...item, is_enabled: event.target.checked } : item
                      )
                    )
                  }
                />
                有効
              </label>
              <input
                type="number"
                value={source.fetch_interval_min}
                onChange={(event) =>
                  setSources((prev) =>
                    prev.map((item) =>
                      item.id === source.id
                        ? { ...item, fetch_interval_min: event.target.value }
                        : item
                    )
                  )
                }
              />
              <div className="table-actions">
                <button type="button" onClick={() => handleUpdateSource(source)}>
                  保存
                </button>
                <button type="button" onClick={() => handleDeleteSource(source.id)}>
                  削除
                </button>
              </div>
            </div>
          ))}
          {sources.length === 0 && <p className="empty">登録されたRSSはありません。</p>}
        </div>
      </section>

      <section className="panel">
        <h3>著者ルール一覧</h3>
        <div className="grid-form">
          <select
            value={authorDraft.source_id}
            onChange={(event) => setAuthorDraft({ ...authorDraft, source_id: event.target.value })}
          >
            <option value="">サイトを選択</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.site_name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="著者名"
            value={authorDraft.creator_name}
            onChange={(event) =>
              setAuthorDraft({ ...authorDraft, creator_name: event.target.value })
            }
          />
          <select
            value={authorDraft.rule_type}
            onChange={(event) => setAuthorDraft({ ...authorDraft, rule_type: event.target.value })}
          >
            <option value="block">block</option>
            <option value="allow">allow</option>
            <option value="boost">boost</option>
          </select>
          <input
            type="text"
            placeholder="メモ"
            value={authorDraft.memo}
            onChange={(event) => setAuthorDraft({ ...authorDraft, memo: event.target.value })}
          />
          <button className="primary" type="button" onClick={handleCreateAuthor}>
            追加
          </button>
        </div>

        <div className="table">
          {authorRules.map((rule) => (
            <div key={rule.id} className="table-row">
              <select
                value={rule.source_id}
                onChange={(event) =>
                  setAuthorRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id ? { ...item, source_id: event.target.value } : item
                    )
                  )
                }
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.site_name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={rule.creator_name}
                onChange={(event) =>
                  setAuthorRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id ? { ...item, creator_name: event.target.value } : item
                    )
                  )
                }
              />
              <select
                value={rule.rule_type}
                onChange={(event) =>
                  setAuthorRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id ? { ...item, rule_type: event.target.value } : item
                    )
                  )
                }
              >
                <option value="block">block</option>
                <option value="allow">allow</option>
                <option value="boost">boost</option>
              </select>
              <input
                type="text"
                value={rule.memo || ""}
                onChange={(event) =>
                  setAuthorRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id ? { ...item, memo: event.target.value } : item
                    )
                  )
                }
              />
              <div className="table-actions">
                <button type="button" onClick={() => handleUpdateAuthor(rule)}>
                  保存
                </button>
                <button type="button" onClick={() => handleDeleteAuthor(rule.id)}>
                  削除
                </button>
              </div>
            </div>
          ))}
          {authorRules.length === 0 && <p className="empty">著者ルールはありません。</p>}
        </div>
      </section>

      <section className="panel">
        <h3>ピックアップ・NGワード一覧</h3>
        <div className="grid-form">
          <input
            type="text"
            placeholder="キーワード"
            value={keywordDraft.keyword}
            onChange={(event) => setKeywordDraft({ ...keywordDraft, keyword: event.target.value })}
          />
          <select
            value={keywordDraft.rule_type}
            onChange={(event) => setKeywordDraft({ ...keywordDraft, rule_type: event.target.value })}
          >
            <option value="tab">tab</option>
            <option value="mute">mute</option>
            <option value="boost">boost</option>
          </select>
          <button className="primary" type="button" onClick={handleCreateKeyword}>
            追加
          </button>
        </div>

        <div className="table">
          {keywordRules.map((rule) => (
            <div key={rule.id} className="table-row">
              <input
                type="text"
                value={rule.keyword}
                onChange={(event) =>
                  setKeywordRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id ? { ...item, keyword: event.target.value } : item
                    )
                  )
                }
              />
              <select
                value={rule.rule_type}
                onChange={(event) =>
                  setKeywordRules((prev) =>
                    prev.map((item) =>
                      item.id === rule.id ? { ...item, rule_type: event.target.value } : item
                    )
                  )
                }
              >
                <option value="tab">tab</option>
                <option value="mute">mute</option>
                <option value="boost">boost</option>
              </select>
              <div className="table-actions">
                <button type="button" onClick={() => handleUpdateKeyword(rule)}>
                  保存
                </button>
                <button type="button" onClick={() => handleDeleteKeyword(rule.id)}>
                  削除
                </button>
              </div>
            </div>
          ))}
          {keywordRules.length === 0 && <p className="empty">キーワードルールはありません。</p>}
        </div>
      </section>
    </section>
  );
}