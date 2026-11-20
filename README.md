# Stock Tracker

Internal analysis tool for NSE-listed stocks: prices, charts, technical signals and scores.
Single user. **Informational only, not investment advice.**

Stack: Next.js (App Router, TypeScript), Tailwind, Motion, lightweight-charts, Supabase (Postgres + Auth), Yahoo Finance for market data.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Design system, dashboard and stock pages | Done |
| 1 | Schema, provider, backfill, jobs, technical signals and score | Done |
| 2 | Result dates, quarterly results, fundamentals, event score | Done (Yahoo only, see limits below) |
| 3 | Verdicts, reward/risk, 10-year signal backtest | Done |
| 4 | External signals via Claude, including confirmed result dates | Done |

Panels that depend on a later phase say so on screen instead of showing invented numbers.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env.local     # then fill in the values below
npm run db:push                # apply supabase/migrations to your database
npm run seed                   # Nifty 200 + Nifty 50 / India VIX rows + your allowed email
npm run auth:set-password      # create your sign-in account (hidden prompt)
npm run backfill               # 10 years of daily candles per stock, ~5 seconds each
npm run fundamentals           # result dates, quarterly results, ratios, event scores
npm run backtest               # 10-year signal backtest, then refreshes every verdict
npm run external -- --dry-run  # who the weekly AI read would cover, with no API calls
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
| `EXTERNAL_SIGNALS_MODEL` | AI read (Phase 4) | Claude model for the AI read. Optional; defaults to `claude-haiku-5-5` |
| `TRADE_COST_PCT` | Optional. Round-trip trading cost in percent used by the signal research and paper trades. Default 0.25. |
| `SHADOW_TRADE_INR` | Optional. Notional rupee size of each automatic shadow paper trade. Default 100000. |
| `ANTHROPIC_WORKSPACE_ID` | AI read (Phase 4) | Only needed when the API key is not tied to a single workspace; Anthropic then requires the workspace ID on every request |
| `ANTHROPIC_API_KEY` | AI read (Phase 4) | From console.anthropic.com. Without it the AI read is simply unavailable; everything else works |

`.env.local` is git-ignored. Never commit secrets.

### Scripts

| Command | What it does |
|---|---|
| `npm run db:push` | Runs `supabase db push --db-url` against `DATABASE_URL`. No `supabase login` or `link` needed |
| `npm run seed` | Upserts the Nifty 200 list from `data/nifty200.csv` (existing rows are left alone) and registers `ALLOWED_EMAIL` |
| `npm run auth:set-password` | Creates the account for `ALLOWED_EMAIL` or resets its password |
| `npm run backfill` | Backfills every stock that is not done yet. Resumable: stop it and run again. `-- --symbol TCS`, `-- --force`, `-- --years 5` |
| `npm run fundamentals` | Refreshes results and fundamentals for stocks not updated in the last 20 hours. `-- --force` for all |
| `npm run backtest` | Backtests every signal on each stock's full history, pools by sector and overall, refreshes verdicts. `-- --force` for all |
| `npm run research` | Tests every candidate signal against the random-day baseline, in-sample (to 2022) and out-of-sample (2023 on), after costs. Prints tables; changes nothing. |
| `npm run recompute` | Recomputes indicators, momentum ranks and verdicts for every stock from stored prices (two passes). |
| `npm run macro` | Daily macro numbers, breadth, regime label and event follow-up. `-- --backfill` rebuilds the regime history; `-- --note` writes the weekly AI macro note (spends money). |
| `npm run external` | Weekly AI read for everything that is due. `-- --dry-run` lists who would run and why (no API calls). `-- --symbol TCS` runs one stock |
| `npm run typecheck` | Type-checks from scratch (no incremental cache, which can hide errors) |

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
  - `GET /api/cron/fundamentals`: daily refresh of result dates, quarterly results, ratios and event scores,
    also in 45-second batches.
  - `GET /api/cron/backtest`: weekly signal backtest, in 45-second batches.
  - `GET /api/cron/external`: weekly AI read. This one spends money; see below.
  - All require the `x-cron-secret` header. Provider calls retry three times with backoff; a symbol that
    still fails is recorded and the job carries on.
- **Results and the event score** (`src/lib/events.ts`). For each stock: next result date, recent quarters
  (revenue, net profit, YoY and QoQ growth, net margin), P/E, ROE, debt/equity, and the price move on the
  first session and first five sessions after each past result. The event score (0-100, starts at 50) weighs
  YoY revenue and profit growth, the quarter-on-quarter revenue run, margin direction, past post-result
  reactions and EPS beats. With fewer than two usable quarters the score is left empty.
  **Limits of the current source (Yahoo):**
  - Only the latest 4-7 quarters are available, sometimes with gaps, so "last 8 quarters" fills in over time
    as new results are stored. YoY appears only where the year-ago quarter exists.
  - The next result date is whatever Yahoo publishes. A date already in the past is treated as unknown.
    Dates Yahoo marks as estimates are labelled "est.".
  - NSE/BSE announcement feeds are **not** wired in: their result endpoints are not open APIs.
    `MarketDataProvider.getEarnings` is the single place to add an exchange or licensed source.
  - Quarters whose revenue or profit is far out of line with the company's other quarters (for example an
    annual figure in a quarterly slot) are flagged **"check data"**, drawn with a dashed outline, and left
    out of growth figures and the event score.
  - Quarter labels follow each company's own financial year end (from Yahoo): "Q2 FY27" for April-March
    companies, "Q3 CY26" for calendar-year ones.
  - `fundamentals.confirmed_result_date` / `confirmed_result_url` are reserved for the Phase 4 AI job. A
    confirmed future date takes precedence over Yahoo's estimate everywhere (the `stock_latest` view does this).
- **Backtest** (`src/lib/backtest.ts`). For every stock, each signal is replayed over the full history using
  only data available on the day. An event is the first day a signal switches on. For each event the close
  5, 20 and 60 sessions later is compared with the close on the signal day. A hit is a higher price for
  bounce-back and trend, a lower price for a breakdown warning. Every result is stored next to a **baseline**
  (the same measure for any day in the same history) so a signal can be judged against doing nothing special.
  Returns are close-to-close with no costs, taxes or slippage. Results are stored per stock, per sector and
  for all stocks; a stock with fewer than 8 past cases falls back to its sector, then to all stocks.
- **Paper trading** (`src/lib/jobs/paper.ts`, table `paper_trades`). Pretend trades for learning; no order is
  placed anywhere.
  - *My trades:* the stocks list has "Paper ST" and "Paper LT" columns. A paper buy takes an amount in rupees
    and is stored as pending. It fills at the first quote stamped after the request, or at that session's
    open if the request came while the market was closed, so it can never fill at a past price. The verdicts,
    scores, entry rating, signal, momentum rank and market regime at the time are stored with it.
  - *Exits:* a short-term trade closes at its target, at its stop, or at the close of its 20th session. The
    end-of-day pass tests each completed bar, stop first, so a day that touched both counts as a loss. A
    long-term trade stays open until you close it; it is flagged when the long-term verdict turns Avoid.
  - *Costs:* `TRADE_COST_PCT` (default 0.25% round trip), half on entry and half on exit.
  - *Shadow portfolio:* after each end-of-day run, a notional trade (`SHADOW_TRADE_INR`, default 100000) is
    opened for every stock that newly became short-term Favourable, whatever its entry rating (the rating is
    stored with the trade), and for every stock that newly became long-term Favourable. These fill at the
    next open. A stock rated Wait for pullback also gets a second shadow trade: a limit order at the suggested
    price, valid for 5 sessions. It fills at the limit, or at the open if the day opens below it, and is
    marked expired if the price never gets there. Shadow long-term trades close when the long-term verdict
    turns Avoid.
  - *Scoreboard* (`/scoreboard`): my trades and the shadow portfolio separately, with win rate, average win
    and loss, expectancy, total return and the same money in Nifty 50 over the same dates, broken down by
    horizon, signal, entry rating (limit orders listed apart) and market regime. The shadow section also shows
    how many pullback limits were placed, filled and expired, and the fill rate. Fewer than 30 closed trades shows "too few trades to
    judge".
- **Macro view** (`src/lib/macro.ts`, `src/lib/jobs/macro.ts`).
  - *Daily numbers*, stored with history: Nifty 50 and India VIX (already tracked), plus Brent crude, USD/INR,
    S&P 500 and the US 10-year yield from Yahoo (`macro_series`). Breadth is computed from our own stocks: the
    share above their 50 and 200 DMA. Everything for a session is kept in `macro_daily`.
  - *Regime label* on the dashboard: Risk-on, Neutral or Risk-off, from four inputs (Nifty 50 against its
    200 DMA, breadth, VIX level, VIX against its 20-day average), each worth +1, 0 or -1. The inputs and
    their points are shown. The thresholds are conventional, not fitted, and the research found regime did
    not give a consistent answer across periods, so the label is context. The only rule acting on the market
    state is that a positive technical score earns no short-term credit while Nifty 50 is below its 200 DMA.
    Short-term verdicts are not capped at Neutral in Risk-off.
  - *Weekly AI macro note:* same model and source rules as the external job, at most 3 searches. Three to five
    events moving Indian markets, each with a dated source from the last 21 days, the sectors each helps or
    hurts (chosen from our own sector list) and why, and FII/DII flow figures when a source states them. If
    the allowlisted sites give no usable event it retries once with open search and is marked low-grade.
    The call is logged in the admin spend log as kind `macro`.
  - *Event log* (`macro_events`): for every event, the move in Nifty 50 and in each named sector (equal-weight
    average of our stocks in it) over the next 1, 5 and 20 sessions, measured from the last close before the
    event. The page shows what happened next to what the AI reasoned.
  - *Stock page:* events from the last 45 days that name the stock's sector.
  - `npm run macro` runs the daily step, `-- --backfill` rebuilds the regime history from stored prices,
    `-- --note` writes the AI note now.
- **Verdicts** (`src/lib/verdict.ts`). Short term (days to weeks) and long term (1 year+), each starting at 50:
  - *Short:* technical score (0.4 points per point from 50), reward-to-risk (target = nearest resistance,
    stop = nearest support less half an ATR), 12-1 month momentum rank (top fifth +4, bottom fifth -4), a
    result due within 7 days, bounce +3, breakdown -3. The trend signal earns nothing. When Nifty 50 is below
    its 200 DMA a positive technical score earns nothing either. A breakdown no longer forces Avoid; it
    raises the risk level instead.
  - *Long:* 12-1 month momentum rank among tracked stocks (top 10% +10, top 20% +7, top 30% +4, bottom 20%
    -7), six-month return 20+ points ahead of Nifty 50 (+3), price and 50 DMA against the 200 DMA (+6/-6),
    event score, ROE, debt/equity (ignored for financials), P/E, and the external score.
  - These weights come from the **signal research** (`npm run research`, `src/lib/research.ts`): every signal
    was tested against buying on any day, entering at the next open, after a 0.25% round-trip cost
    (`TRADE_COST_PCT`), with 2023 onward held out. Only 12-1 month momentum kept a clear edge out-of-sample;
    six-month relative strength held at longer horizons; the trend, 52-week-high and volume-breakout signals
    did not beat same-month peers; the bounce signal beat peers for about a week but not the market; the
    breakdown warning did not predict falls. Post-result drift could not be tested (the data provider has
    announcement times for about four quarters only). The universe is today's index members, so every
    return in the research is flattered by survivorship.
  - *Entry rating* (`src/lib/entry.ts`), shown next to the short-term verdict on the stocks list and the stock
    page with a suggested entry, stop, target and reward-to-risk. Checked in this order: **Extended, don't
    chase** (more than 3 ATR above the 20 DMA, or RSI above 75), **Good entry** (uptrend, reward-to-risk of 2
    or more, and within 1 ATR of a rising 20 DMA or a volume breakout in the last 3 sessions), **Wait for
    pullback** (short-term Favourable and more than 2 ATR above the 20 DMA, or more than 1 ATR above it in an
    uptrend; the limit is the 20 DMA or a recent breakout level, the stop 1.5 ATR below it), otherwise **No
    setup**, which always carries a one-line reason ("not in an uptrend", "reward-to-risk 0.9x, below 2",
    "breakdown active"). The labels are backtested by
    `npm run research`: a Good entry bought at the next open did no better than a random day; a pullback
    limit, when filled within 10 sessions (about half the time), beat buying at once by roughly 0.4% over
    five sessions in both periods, but not over 20 sessions out-of-sample; every entry setup did worse with Nifty 50 below its 200 DMA. The backtest
    uses the uptrend in place of a Favourable verdict, because past verdicts cannot be rebuilt.
  - 65+ Favourable, 45-64 Neutral, under 45 Avoid. The 3-5 largest factors are stored as the reasons.
  - *Overall score:* weighted mean of the scores that exist (technical 0.45, event 0.30, external 0.25).
  - *Risk:* from ATR as a share of price, raised one level when a result is within 7 days and set to High on
    a breakdown warning.
- **External signals** (`src/lib/jobs/external.ts`, `src/lib/ai/`). Claude (`claude-haiku-5-5` by default; set `EXTERNAL_SIGNALS_MODEL` to change it) with the web
  search tool reads company news, last-quarter guidance, expectations for the next result and the next result
  date, and returns strict JSON (the input of a strict tool, so it always matches the schema).
  - **Industry context is shared.** Outlook, export/import exposure, currency and commodity sensitivity and
    industry risks are researched once a week per industry (`sector_research`) and attached to every stock in
    it. The key is the data provider's industry ("Marine Shipping", "Credit Services"), not the exchange's
    broad sector, so a ports company does not get a note about IT services. A stock call searches only for
    company-specific items.
  - **Search caps**, enforced by the API (`max_uses`): 2 web searches per stock call, 3 per industry call.
    A stock whose result is within 30 days gets a third search, aimed at analyst expectations for that quarter.
  - **Source rules.** Searches are limited to an allowlist (`ALLOWED_DOMAINS` in `src/lib/ai/research.ts`):
    bseindia.com, nseindia.com, business-standard.com, economictimes.indiatimes.com, livemint.com,
    moneycontrol.com, reuters.com, thehindubusinessline.com, financialexpress.com, cnbctv18.com and
    ndtvprofit.com, plus the company's own website (from the data provider, stored in `fundamentals.website`).
    Results from any other site are ignored. Several of these sites do not allow Anthropic's search crawler,
    and the API rejects a request that names one; the job reads the rejected names from that error, drops
    them and sends the request again, so in practice the search runs on the sites that permit it (at the time
    of writing: the two exchanges, Business Standard and the company site). At most one news item is kept per
    source page, and an item known to be more than 90 days old is not counted as news.
  - **Open-search fallback.** If an allowlisted stock call returns no usable news, the call is repeated once
    with open search and a blocklist (`BLOCKED_DOMAINS`: marketsmojo.com, scanx.trade, multibagg.ai,
    ad-hoc-news.de, wikipedia.org, perplexity.ai). That read is stored with `low_grade_sources` and the stock
    page shows a "Low-grade sources" label. The retry is a second paid call. An industry note falls back the
    same way only when the allowlisted search returns no results at all.
  - **Risks need a dated source.** A company or industry risk is kept only when it links to a search result
    dated within the last 90 days. Anything else is dropped, so the list can be empty.
  - **Sources.** Every URL in the search results is stored with the run. A link in the answer is kept only
    if it appeared in those results, so an invented URL cannot be saved. News items without a verified link
    are dropped.
  - **Confirmed result dates.** A date is treated as confirmed only when it comes from a company notice or
    an NSE/BSE filing, has a verified link to a page the search engine dates within the last 90 days, and lies
    in the next 150 days. It then overrides Yahoo's estimate. The provider's own date is not shown to the model,
    because it tends to echo it back as "confirmed".
    Dates from media reports are shown as "reported, not confirmed".
  - **External score** (0-100, 50 neutral): news sentiment, guidance tone, expectations tone and the sector
    outlook, pulled towards 50 in proportion to the read's confidence. It carries 25% of the overall score
    and feeds the long-term verdict. A read older than 45 days stops counting.
  - `npm run external -- --relink` attaches existing reads to industry notes without repeating the stock call.
  - **Who gets a weekly read:** the watchlist plus the top 30 by technical score. A stock is **skipped** when
    it has no result within 30 days, its price moved less than 5% over the last five sessions, and its last
    read is under 3 weeks old. The "Refresh" button on a stock page ignores the skip rule.
  - **Cost log.** Every call is written to `ai_runs` with searches, tokens, duration and an estimated cost
    (the model's published token prices plus $10 per 1,000 searches). The admin page shows this month, last
    month and each call. It is an estimate; the Anthropic Console has the actual bill. On `claude-haiku-5-5`
    a stock call has measured about 25-30K tokens in, 3K out and 2 searches, roughly $0.024, and an industry
    note about $0.036; search fees ($10 per 1,000) are most of that.
  - Not used, on purpose: the Batch API and prompt caching.
  - A request the model declines is logged as "refused". Haiku 5.5 has no automatic fallback model; if
    `EXTERNAL_SIGNALS_MODEL` is set to Sonnet 5.5, the API retries a declined request once on its default
    fallback (`fallbacks: "default"`).
- **Freshness.** Every panel carries a stamp. Quotes older than 20 minutes in market hours, or data from
  before the latest expected session, are flagged "Stale" in amber. Exchange holidays are not known to the
  app, so data is flagged stale on a holiday rather than presented as current.

## Scheduling (Supabase pg_cron + pg_net)

Vercel Hobby cron runs once a day at most, so Supabase calls the routes instead.

1. Deploy the app (below) so you have a public URL.
2. Open `supabase/cron.sql.example`, replace `https://YOUR-APP.vercel.app` and `YOUR_CRON_SECRET`.
3. Paste it into the Supabase SQL editor and run it. Do not commit the filled-in copy.

The file schedules quotes every 15 minutes in market hours, the EOD batches after the close, the daily
results and fundamentals refresh, the weekly backtest, the weekly AI read (optional; it spends money), and a daily clean-up of old `job_runs` rows. It also lists the queries to inspect scheduled jobs and recent HTTP responses.

## Deploying on Vercel (GitHub auto-deploy)

1. Push to `main` on GitHub. Do not deploy from the Vercel CLI.
2. In Vercel, import the repository (framework preset: Next.js).
3. Add these environment variables for Production: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ALLOWED_EMAIL`
   and `ANTHROPIC_API_KEY` (plus `EXTERNAL_SIGNALS_MODEL` if you want a model other than the default). `DATABASE_URL` is only needed locally.
4. Deploy, sign in, then set up scheduling as above.
5. Run `npm run backfill` locally; it writes to the same database the deployed app reads.

`/api/cron/external` and the stock page (for the Refresh button) set `maxDuration = 300` because one AI call
can take over a minute. If your Vercel plan caps functions lower, run `npm run external` locally instead.
The other cron routes set `maxDuration = 60`. If your Vercel plan caps functions lower than that, the EOD job
still completes; it just needs more of its 5-minute calls.

## Disclaimer

This is a personal research tool. Nothing in it is investment advice or a recommendation to buy or sell
any security. Data comes from Yahoo Finance and may be delayed or wrong.
