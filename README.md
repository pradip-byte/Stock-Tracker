# Stock Tracker

Internal analysis tool for NSE-listed stocks: prices, charts, technical signals and scores.
Single user. **Informational only, not investment advice.**

Stack: Next.js (App Router, TypeScript), Tailwind, Motion, lightweight-charts, Supabase (Postgres + Auth), Yahoo Finance for market data.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Design system, dashboard and stock pages | Done |
| 1 | Schema, provider, backfill, jobs, technical signals and score | Done |
| 2 | Result dates, quarterly results, fundamentals, event score | Not started |
| 3 | Verdicts, reward/risk, backtest | Not started |
| 4 | External signals via Claude | Not started |

Panels that depend on a later phase say so on screen instead of showing invented numbers.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env.local     # then fill in the values below
npm run db:push                # apply supabase/migrations to your database
npm run seed                   # Nifty 200 + Nifty 50 / India VIX rows + your allowed email
npm run auth:set-password      # create your sign-in account (hidden prompt)
npm run backfill               # 10 years of daily candles per stock, ~1 stock/second
npm run dev                    # http://localhost:3000
```

### Environment variables

| Name | Where it is used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | server, cron routes, scripts | Never exposed to the browser |
| `DATABASE_URL` | `npm run db:push` only | Postgres connection string with the real database password. URL-encode special characters in the password |
| `CRON_SECRET` | cron routes | Long random string. Sent by pg_cron in the `x-cron-secret` header |
| `ALLOWED_EMAIL` | sign-in, route guard, seed | The only email that can sign in |
| `ANTHROPIC_API_KEY` | Phase 4 | Not used yet |

`.env.local` is git-ignored. Never commit secrets.

### Scripts

| Command | What it does |
|---|---|
| `npm run db:push` | Runs `supabase db push --db-url` against `DATABASE_URL`. No `supabase login` or `link` needed |
| `npm run seed` | Upserts the Nifty 200 list from `data/nifty200.csv` (existing rows are left alone) and registers `ALLOWED_EMAIL` |
| `npm run auth:set-password` | Creates the account for `ALLOWED_EMAIL` or resets its password |
| `npm run backfill` | Backfills every stock that is not done yet. Resumable: stop it and run again. `-- --symbol TCS`, `-- --force`, `-- --years 5` |

To refresh the Nifty 200 list, replace `data/nifty200.csv` with the current file from
`https://nsearchives.nseindia.com/content/indices/ind_nifty200list.csv` and run `npm run seed`.

## How it works

- **Access.** `src/proxy.ts` sends every request without a valid session for `ALLOWED_EMAIL` to `/login`.
  Every table has RLS on with a read-only policy that checks the signed-in email against `allowed_users`.
  All writes use the service role on the server.
- **Provider.** `src/lib/providers/types.ts` defines `MarketDataProvider` (`getQuotes`, `getDailyHistory`,
  `getFundamentals`, `getEarnings`). `YahooProvider` is the only implementation (NSE symbols with `.NS`).
  To move to Upstox or Angel One, add a class and return it from `src/lib/providers/index.ts`.
- **Indicators and signals** (`src/lib/signals.ts`, pure functions, no look-ahead):
  RSI(14), MACD(12,26,9), 20/50/200 DMA, ATR(14), volume vs 20-day average, distance from 52-week high/low,
  support/resistance from clustered swing pivots.
  - *Bounce-back:* RSI < 35, within 3% of support or the 200 DMA, with a reversal candle or 1.5x volume.
  - *Trend:* price > 50 DMA > 200 DMA.
  - *Breakdown warning:* support lost on volume, a fresh close under the 200 DMA, or a 20-day closing low in a downtrend.
  - *Technical score:* 0-100, starting at 50, with the plain-English reasons stored alongside it.
- **Jobs** (`src/lib/jobs/core.ts`), each run logged to `job_runs` and shown on `/admin`:
  - `GET /api/cron/quotes`: refreshes `quotes_latest`. Does nothing outside 09:15-15:30 IST, Mon-Fri.
  - `GET /api/cron/eod`: after 15:45 IST, appends candles and recomputes indicators and scores.
    Works in 45-second batches and resumes on the next call.
  - Both require the `x-cron-secret` header. Provider calls retry three times with backoff; a symbol that
    still fails is recorded and the job carries on.
- **Freshness.** Every panel carries a stamp. Quotes older than 20 minutes in market hours, or data from
  before the latest expected session, are flagged "Stale" in amber. Exchange holidays are not known to the
  app, so data is flagged stale on a holiday rather than presented as current.

## Scheduling (Supabase pg_cron + pg_net)

Vercel Hobby cron runs once a day at most, so Supabase calls the routes instead.

1. Deploy the app (below) so you have a public URL.
2. Open `supabase/cron.sql.example`, replace `https://YOUR-APP.vercel.app` and `YOUR_CRON_SECRET`.
3. Paste it into the Supabase SQL editor and run it. Do not commit the filled-in copy.

The file schedules quotes every 15 minutes in market hours, the EOD batches after the close, and a daily
clean-up of old `job_runs` rows. It also lists the queries to inspect scheduled jobs and recent HTTP responses.

## Deploying on Vercel (GitHub auto-deploy)

1. Push to `main` on GitHub. Do not deploy from the Vercel CLI.
2. In Vercel, import the repository (framework preset: Next.js).
3. Add these environment variables for Production: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ALLOWED_EMAIL`
   (and `ANTHROPIC_API_KEY` from Phase 4). `DATABASE_URL` is only needed locally.
4. Deploy, sign in, then set up scheduling as above.
5. Run `npm run backfill` locally; it writes to the same database the deployed app reads.

The cron routes set `maxDuration = 60`. If your Vercel plan caps functions lower than that, the EOD job
still completes; it just needs more of its 5-minute calls.

## Disclaimer

This is a personal research tool. Nothing in it is investment advice or a recommendation to buy or sell
any security. Data comes from Yahoo Finance and may be delayed or wrong.
