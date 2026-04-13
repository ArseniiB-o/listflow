# ListFlow

Open-source multichannel marketplace listing engine. Publish products to **eBay**, **Etsy**, and **Amazon** from a single admin panel or a **Telegram bot** — with AI-generated titles, descriptions, and tags.

Built with **Next.js 15**, **Supabase**, and **TypeScript**.

## Features

- **Unified adapter interface** — one `MarketplaceAdapter` for every channel (eBay, Etsy, Amazon, your own store). Add new marketplaces by implementing a single interface.
- **AI content generation** — send a photo + short note, get marketplace-ready copy in DE + EN via [OpenRouter](https://openrouter.ai) (Gemini Flash, GPT-4o, Claude — swap models with one env var).
- **Telegram bot** — create and publish products from your phone: send photos → generate AI copy → review → publish to all channels.
- **Automatic retry** — exponential backoff with jitter for transient API failures. Cron job self-heals stuck listings.
- **Cross-channel stock sync** — when an item sells on one marketplace, stock decrements everywhere. Zero stock auto-ends all listings.
- **Brand voice** — store curated few-shot examples in the database; the AI matches your tone across every marketplace.
- **Daily budget guard** — set `AI_DAILY_BUDGET_CENTS` to cap AI spending.
- **SSRF protection** — blocks private/loopback/link-local IPs in image URLs.
- **Edge-compatible** — uses Web Crypto API (no Node.js `crypto` in middleware).

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Admin UI   │────▶│  API Routes  │────▶│  Publish Engine  │
│  (React)    │     │  /api/admin  │     │  (orchestrator)  │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
┌─────────────┐     ┌──────────────┐     ┌────────▼────────┐
│  Telegram   │────▶│  /api/tg     │────▶│    Adapters      │
│  Bot        │     │  webhook     │     │  eBay │ Etsy │ … │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
┌─────────────┐     ┌──────────────┐     ┌────────▼────────┐
│  Cron Job   │────▶│  /api/cron   │────▶│   Supabase DB    │
│  (QStash)   │     │  sync        │     │  (PostgreSQL)    │
└─────────────┘     └──────────────┘     └─────────────────┘
```

## Supported Channels

| Channel | API | Status |
|---------|-----|--------|
| **Your Store** | Internal (Supabase) | Full |
| **eBay.de** | Sell Inventory + Offer API | Full |
| **Etsy** | v3 Open API | Full |
| **Amazon.de** | Flat-file CSV (SP-API ready) | CSV export |

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/ArseniiB-o/listflow.git
cd listflow
npm install
```

### 2. Set Up Supabase

Create a [Supabase](https://supabase.com) project, then run the migration:

```bash
# Via Supabase CLI
supabase db push

# Or manually paste supabase/migrations/001_marketplace_engine.sql
# into the Supabase SQL Editor
```

**Prerequisites**: your database needs a `products` table and a `categories` table. See the migration file for the expected schema.

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Fill in at minimum:
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `BRAND_NAME`

All marketplace and AI credentials are optional — each feature disables itself when credentials are missing.

### 4. Run

```bash
npm run dev
```

### 5. Connect Marketplaces (optional)

**eBay**: Get OAuth token from [eBay Developer Portal](https://developer.ebay.com). Set `EBAY_OAUTH_TOKEN` and create business policies in Seller Hub.

**Etsy**: Get API key + OAuth token from [Etsy Developers](https://www.etsy.com/developers). Set `ETSY_API_KEY`, `ETSY_OAUTH_TOKEN`, `ETSY_SHOP_ID`.

**Amazon**: Set `AMAZON_SELLER_ID`. Currently generates CSV for manual upload at Seller Central.

**AI**: Get an API key from [OpenRouter](https://openrouter.ai/keys). Set `OPENROUTER_API_KEY`.

**Telegram Bot**: Create a bot via [@BotFather](https://t.me/BotFather). Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_CHAT_IDS`. Register webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/telegram/webhook&secret_token=<WEBHOOK_SECRET>"
```

## Project Structure

```
lib/
  marketplaces/
    types.ts          # Channel, ListingPayload, MarketplaceAdapter interface
    fetch.ts          # fetchWithTimeout, retryWithBackoff, HttpError
    ebay.ts           # eBay Inventory + Offer adapter
    etsy.ts           # Etsy v3 adapter
    amazon.ts         # Amazon flat-file CSV builder
    self.ts           # Internal storefront adapter
    registry.ts       # Adapter lookup
    publish.ts        # Fan-out orchestrator with idempotency guard
    project.ts        # Product → ListingPayload projection
    sync.ts           # Inbound order events → stock sync
  telegram/
    bot.ts            # Telegram Bot API wrapper
    router.ts         # Command handler (/new, /generate, /publish)
    session.ts        # Per-chat draft state (Supabase)
  ai/
    content-engine.ts # OpenRouter AI content generation + budget guard
  env.ts              # Zod-validated environment variables
  supabase/
    admin.ts          # Supabase admin client (service role)

app/api/
  admin/listings/     # CRUD + publish API
  admin/ai/generate/  # AI content generation endpoint
  cron/sync-listings/ # Self-healing cron job
  telegram/webhook/   # Telegram bot webhook
  webhooks/ebay/      # eBay notification handler
  webhooks/etsy/      # Etsy relay webhook

components/admin/
  listings-view.tsx   # Marketplace listings table UI

supabase/migrations/
  001_marketplace_engine.sql  # Database schema
```

## Adding a New Marketplace

1. Create `lib/marketplaces/yourmarket.ts` implementing `MarketplaceAdapter`
2. Add the channel name to the `Channel` type in `types.ts`
3. Register the adapter in `registry.ts`
4. Add the channel to the `CHECK` constraint in the migration
5. Done — the publish engine, cron, and Telegram bot will pick it up automatically

## Tests

```bash
npm test           # Unit tests
npm run test:ci    # With coverage
```

## Deployment

Optimized for **Vercel** (Edge-compatible middleware, Web Crypto API). Also works with any Node.js host.

For self-healing, set up a cron job hitting `/api/cron/sync-listings` every 15 minutes:
- **Vercel Cron**: add to `vercel.json`
- **Upstash QStash**: configure with signing keys for cryptographic verification
- **External cron**: `curl -H "Authorization: Bearer $NEXTAUTH_SECRET" https://yourdomain.com/api/cron/sync-listings`

## Security

- All inputs validated with Zod schemas
- Timing-safe string comparison for webhook signatures
- SSRF protection on AI image URLs (blocks RFC 1918, loopback, link-local, metadata IPs)
- QStash cryptographic signature verification on cron endpoints
- Generic error responses (no internal details leaked to clients)
- Environment validation at startup (blocks misconfigured deploys)

## License

[MIT](LICENSE)
