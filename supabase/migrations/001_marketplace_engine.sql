-- =============================================================================
-- ListFlow — Multichannel Listing Engine
--
-- Tables:
--   marketplace_listings    — one row per (product, channel)
--   marketplace_accounts    — per-channel settings
--   ai_generation_log       — AI call audit history
--   brand_voice_samples     — curated few-shot examples for AI
--   telegram_drafts         — in-flight Telegram bot draft state
--
-- Prerequisites:
--   - A `products` table with columns: id (uuid PK), slug, name, description,
--     price, images, stock_quantity, is_active, etc.
--   - A `categories` table with columns: id (uuid PK), slug
--   - A function `update_updated_at_column()` that sets updated_at = now()
--   - Optionally, an `is_admin()` function for RLS policies
-- =============================================================================


-- marketplace_listings
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid         NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  marketplace       varchar(32)  NOT NULL,
  external_id       varchar(255),
  external_url      text,
  status            varchar(32)  NOT NULL DEFAULT 'draft',
  error_message     text,
  last_synced_at    timestamptz,
  payload_snapshot  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chk_marketplace_listings_channel
    CHECK (marketplace IN ('self','ebay_de','etsy_de','amazon_de')),
  CONSTRAINT chk_marketplace_listings_status
    CHECK (status IN ('draft','publishing','active','paused','error','sold_out','removed')),
  CONSTRAINT uq_marketplace_listings_product_channel
    UNIQUE (product_id, marketplace)
);

CREATE INDEX IF NOT EXISTS idx_ml_product ON marketplace_listings (product_id);
CREATE INDEX IF NOT EXISTS idx_ml_status ON marketplace_listings (status) WHERE status IN ('error','publishing');


-- marketplace_accounts
CREATE TABLE IF NOT EXISTS marketplace_accounts (
  marketplace       varchar(32)  PRIMARY KEY,
  display_name      varchar(255),
  is_active         boolean      NOT NULL DEFAULT false,
  encrypted_tokens  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  token_expires_at  timestamptz,
  meta              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chk_marketplace_accounts_channel
    CHECK (marketplace IN ('self','ebay_de','etsy_de','amazon_de'))
);


-- ai_generation_log
CREATE TABLE IF NOT EXISTS ai_generation_log (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid         REFERENCES products(id) ON DELETE SET NULL,
  kind            varchar(32)  NOT NULL,
  model           varchar(64)  NOT NULL,
  input           jsonb        NOT NULL,
  output          jsonb        NOT NULL,
  input_tokens    integer,
  output_tokens   integer,
  cost_usd_cents  integer,
  latency_ms      integer,
  created_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chk_ai_gen_kind CHECK (kind IN ('title','description','tags','all','rewrite','vision'))
);

CREATE INDEX IF NOT EXISTS idx_ai_log_product ON ai_generation_log (product_id, created_at DESC);


-- brand_voice_samples
CREATE TABLE IF NOT EXISTS brand_voice_samples (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  category    varchar(64)  NOT NULL,
  locale      varchar(5)   NOT NULL,
  title       text         NOT NULL,
  description text         NOT NULL,
  tags        text[]       NOT NULL DEFAULT '{}',
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chk_bvs_locale CHECK (locale IN ('de','en'))
);

CREATE INDEX IF NOT EXISTS idx_bvs_lookup ON brand_voice_samples (category, locale) WHERE is_active;


-- telegram_drafts
CREATE TABLE IF NOT EXISTS telegram_drafts (
  chat_id      bigint       PRIMARY KEY,
  stage        varchar(32)  NOT NULL DEFAULT 'idle',
  images       text[]       NOT NULL DEFAULT '{}',
  user_text    text         NOT NULL DEFAULT '',
  category     varchar(64)  NOT NULL DEFAULT 'general',
  price_eur    numeric(10,2),
  generated    jsonb,
  updated_at   timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chk_td_stage CHECK (stage IN ('idle','collecting','ready','publishing'))
);


-- updated_at triggers (requires update_updated_at_column() function)
-- CREATE OR REPLACE FUNCTION update_updated_at_column()
-- RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ml_updated ON marketplace_listings;
CREATE TRIGGER trg_ml_updated BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ma_updated ON marketplace_accounts;
CREATE TRIGGER trg_ma_updated BEFORE UPDATE ON marketplace_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_td_updated ON telegram_drafts;
CREATE TRIGGER trg_td_updated BEFORE UPDATE ON telegram_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- RLS (uncomment and adapt if you have an is_admin() function)
-- ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketplace_accounts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_generation_log ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE brand_voice_samples ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE telegram_drafts ENABLE ROW LEVEL SECURITY;


-- Seed channels
INSERT INTO marketplace_accounts (marketplace, display_name, is_active)
VALUES
  ('self',       'Your Store (internal)', true),
  ('ebay_de',    'eBay.de',              false),
  ('etsy_de',    'Etsy.de',              false),
  ('amazon_de',  'Amazon.de (CSV)',      false)
ON CONFLICT (marketplace) DO NOTHING;
