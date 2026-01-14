-- =========================================
-- RSS Collector / Curator (SQLite DDL)
-- =========================================
PRAGMA foreign_keys = ON;

-- -----------------------------------------
-- sources: 購読RSS一覧（CRUD）
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  site_name          TEXT    NOT NULL,                     -- 表示用サイト名
  feed_url           TEXT    NOT NULL UNIQUE,              -- RSS URL
  source_type        TEXT    NOT NULL,                     -- search/tag/user/magazine
  creator_tag        TEXT    NOT NULL DEFAULT 'note:creatorName', -- 著者名を示すタグ（feedごとに差異）
  is_enabled         INTEGER NOT NULL DEFAULT 1,            -- 0/1
  fetch_interval_min INTEGER NOT NULL DEFAULT 120,          -- 同期間隔（分）
  last_fetched_at    TEXT,                                 -- 最終取得時刻（ISO8601想定、表示はRのみ）
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (source_type IN ('search','tag','user','magazine')),
  CHECK (is_enabled IN (0,1)),
  CHECK (fetch_interval_min >= 1)
);

CREATE INDEX IF NOT EXISTS idx_sources_enabled
  ON sources(is_enabled);

-- -----------------------------------------
-- items: 記事（未評価/保存/無視をstatusで管理）
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id         INTEGER NOT NULL,

  -- RSS由来の識別子（あれば）
  guid             TEXT,

  -- 正規化したURL（重複排除の柱）
  link             TEXT    NOT NULL,

  title            TEXT    NOT NULL,

  -- 著者（RSSの creator_tag で抽出した結果を入れる）
  creator_name     TEXT,

  -- 公開時刻（UTCで保持推奨）
  published_at     TEXT,                                  -- ISO8601想定（例: 2026-01-14T02:03:04Z）
  published_date   TEXT,                                  -- 変換できない場合に日付のみ保持（yyyy-MM-dd等）

  -- 取得時刻
  fetched_at       TEXT    NOT NULL DEFAULT (datetime('now')),

  -- ステータス：未評価 / 保存 / 無視
  status           TEXT    NOT NULL DEFAULT 'unread',

  -- 解析デバッグ用（必要なら）
  raw_xml          TEXT,                                  -- なくてもOK。必要なら残す

  -- 重複排除用の指紋（linkから生成したhashを入れる想定）
  fingerprint      TEXT    NOT NULL UNIQUE,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
  CHECK (status IN ('unread','saved','ignored'))
);

CREATE INDEX IF NOT EXISTS idx_items_source_status
  ON items(source_id, status);

CREATE INDEX IF NOT EXISTS idx_items_published_at
  ON items(published_at);

CREATE INDEX IF NOT EXISTS idx_items_title
  ON items(title);

CREATE INDEX IF NOT EXISTS idx_items_creator
  ON items(creator_name);

-- タイトル部分検索を速くしたいなら（任意）
-- LIKE '%word%' は効きにくいが、将来トークナイズしたいならFTSも検討可。
-- 今回は「タイトルのみ部分検索」なので通常INDEXで十分。

-- -----------------------------------------
-- tags / item_tags: 保存時タグ（カンマ区切り入力を正規化）
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id    INTEGER NOT NULL,
  tag_id     INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, tag_id),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_tags_tag
  ON item_tags(tag_id);

-- -----------------------------------------
-- author_rules: 著者ルール（CRUD）
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS author_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL,      -- サイト（source）単位でルールを分けたい設計に合わせる
  creator_name  TEXT    NOT NULL,
  rule_type     TEXT    NOT NULL,      -- block/allow/boost（boostは残す方針）
  memo          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
  CHECK (rule_type IN ('block','allow','boost')),
  UNIQUE (source_id, creator_name)
);

CREATE INDEX IF NOT EXISTS idx_author_rules_lookup
  ON author_rules(source_id, creator_name);

-- -----------------------------------------
-- keyword_rules: ピックアップ・NGワード（CRUD）
-- タイトルに対する検索にのみ適用
-- rule_type: mute/boost/tab（boostは温存）
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS keyword_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword     TEXT    NOT NULL,
  rule_type   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (rule_type IN ('mute','boost','tab')),
  UNIQUE (keyword, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_keyword_rules_type
  ON keyword_rules(rule_type);

-- -----------------------------------------
-- 便利VIEW（任意）：保存一覧のフィルタ表示用
-- -----------------------------------------
CREATE VIEW IF NOT EXISTS v_items_with_source AS
SELECT
  i.id,
  s.site_name,
  s.feed_url,
  s.source_type,
  i.title,
  i.link,
  i.creator_name,
  i.published_at,
  i.published_date,
  i.status,
  i.fetched_at
FROM items i
JOIN sources s ON s.id = i.source_id;

-- -----------------------------------------
-- updated_at自動更新（任意：アプリ側で更新してもOK）
-- SQLiteは標準でON UPDATEトリガがないのでトリガで補う。
-- -----------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_sources_updated_at
AFTER UPDATE ON sources
FOR EACH ROW
BEGIN
  UPDATE sources SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_items_updated_at
AFTER UPDATE ON items
FOR EACH ROW
BEGIN
  UPDATE items SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_author_rules_updated_at
AFTER UPDATE ON author_rules
FOR EACH ROW
BEGIN
  UPDATE author_rules SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_keyword_rules_updated_at
AFTER UPDATE ON keyword_rules
FOR EACH ROW
BEGIN
  UPDATE keyword_rules SET updated_at = datetime('now') WHERE id = OLD.id;
END;