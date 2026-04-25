-- =============================================================================
-- ListFlow — Hardening migration
--
-- Adds:
--   atomic_decrement_stock(...)  RPC for race-free stock updates (used by
--                                lib/marketplaces/sync.ts)
--   webhook_events               idempotency table for inbound webhooks
--   ai_daily_cost                materialized view for fast budget checks
--   index improvements
--   Row-Level-Security policies (commented blueprint)
-- =============================================================================


-- 1. Atomic stock decrement -------------------------------------------------
--
-- Returns the new stock_quantity, or NULL if the product has unlimited stock
-- or does not exist. NEVER drops below zero. Updates stock_status in the
-- same transaction.
CREATE OR REPLACE FUNCTION atomic_decrement_stock(
  p_product_id uuid,
  p_quantity   integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'p_quantity must be >= 0';
  END IF;

  UPDATE products
     SET stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) - p_quantity),
         stock_status   = CASE
                            WHEN GREATEST(0, COALESCE(stock_quantity, 0) - p_quantity) = 0
                              THEN 'out_of_stock'
                            ELSE 'in_stock'
                          END
   WHERE id = p_product_id
     AND stock_quantity IS NOT NULL
   RETURNING stock_quantity INTO v_new;

  RETURN v_new;
END;
$$;


-- 2. Webhook idempotency ----------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source      varchar(32)  NOT NULL,
  event_id    varchar(255) NOT NULL,
  payload     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chk_we_source CHECK (source IN ('ebay', 'etsy', 'telegram', 'qstash')),
  CONSTRAINT uq_we_source_event UNIQUE (source, event_id)
);

CREATE INDEX IF NOT EXISTS idx_we_received ON webhook_events (received_at DESC);

-- Drop old events (>30 days) helper. Schedule via pg_cron or external job.
CREATE OR REPLACE FUNCTION sweep_old_webhook_events(p_max_age_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM webhook_events
     WHERE received_at < (now() - (p_max_age_days || ' days')::interval)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;


-- 3. AI cost daily rollup ---------------------------------------------------
CREATE OR REPLACE VIEW ai_daily_cost AS
SELECT
  date_trunc('day', created_at)::date  AS day,
  COUNT(*)                             AS calls,
  COALESCE(SUM(input_tokens), 0)       AS input_tokens,
  COALESCE(SUM(output_tokens), 0)      AS output_tokens,
  COALESCE(SUM(cost_usd_cents), 0)     AS cost_cents,
  COALESCE(AVG(latency_ms), 0)::integer AS avg_latency_ms
FROM ai_generation_log
GROUP BY 1
ORDER BY 1 DESC;


-- 4. Marketplace_listings: a partial index for the stale-publish sweeper ----
CREATE INDEX IF NOT EXISTS idx_ml_stale_publish
  ON marketplace_listings (updated_at)
  WHERE status IN ('publishing', 'error');


-- 5. RLS blueprint (uncomment to enable; requires is_admin() helper) ---------
-- ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketplace_accounts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_generation_log    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE brand_voice_samples  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE telegram_drafts      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE webhook_events       ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY ml_admin_all ON marketplace_listings
--   FOR ALL TO authenticated
--   USING (is_admin()) WITH CHECK (is_admin());
--
-- CREATE POLICY we_admin_read ON webhook_events
--   FOR SELECT TO authenticated USING (is_admin());
