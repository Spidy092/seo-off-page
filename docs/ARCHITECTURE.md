# System Architecture

## Overview

The Off-Page SEO Automation Engine follows a **worker-queue architecture** pattern where:
- A **Fastify API layer** accepts commands and serves data
- **BullMQ queues** manage job distribution and retries
- **6 independent workers** process jobs concurrently
- **PostgreSQL** persists all data
- **Redis** powers queues and rate limit tracking

---

## Request Flow

```
Client (curl/frontend)
    │
    ▼
┌──────────────────────┐
│    Fastify Server     │
│   (routes/health.js)  │
│   (routes/automation) │
└──────────┬───────────┘
           │ Adds jobs to queues
           ▼
┌──────────────────────┐
│    Redis (BullMQ)     │
│  7 Named Queues       │
│  ┌─────────────────┐  │
│  │ competitor-disc  │  │
│  │ backlink-extract │  │
│  │ domain-analysis  │  │
│  │ email-finder     │  │
│  │ broken-link      │  │
│  │ opportunity-cls  │  │
│  │ common-crawl     │  │
│  └─────────────────┘  │
└──────────┬───────────┘
           │ Workers poll for jobs
           ▼
┌──────────────────────┐     ┌─────────────────┐
│    Worker Processes   │────▶│   External APIs  │
│  (6 BullMQ workers)  │     │  (Serper, DDG,   │
│                      │     │   Hunter, OPR,   │
│  Shared dependencies:│     │   Tranco, etc.)  │
│  ├── RateLimiter     │     └─────────────────┘
│  ├── DedupEngine     │
│  └── URLNormalizer   │
└──────────┬───────────┘
           │ Stores results
           ▼
┌──────────────────────┐
│    PostgreSQL         │
│  7 Tables, 10 Indexes │
└──────────────────────┘
```

---

## Worker Chain

Workers auto-enqueue follow-up jobs, creating an event-driven pipeline:

```
competitor-discovery
    │ enqueues
    ▼
backlink-extraction (per competitor)
    │ enqueues
    ▼
domain-analysis (per linking domain)
    │
    ▼
opportunity-classifier (per domain)
    │ enqueues (if score ≥ 50)
    ▼
email-finder (per high-value domain)
```

`broken-link` worker runs independently — triggered via manual API call on resource pages.

---

## Data Flow Diagram

```
SERP APIs ──▶ competitor domains ──▶ domains table
                   │
                   ▼
Page Crawling ──▶ outbound links ──▶ backlinks table
                   │
                   ▼
Quality APIs ──▶ scoring signals ──▶ domains.quality_score
                   │
                   ▼
Content Analysis ──▶ page classification ──▶ opportunities table
                   │
                   ▼
Email Sources ──▶ contact info ──▶ contacts table
                   │
                   ▼
Link Checking ──▶ 404 detection ──▶ broken_links table
```

---

## Fallback Chains

### SERP Discovery
```
Serper.dev (API key configured?)
  ├── YES → use Serper (2500/mo)
  │           └── quota exhausted? → fall through
  └── NO ──▶ DuckDuckGo HTML scraping
               └── rate limited? → fall through
             ──▶ Google Custom Search API (100/day)
                   └── quota exhausted?
                 ──▶ return empty (logged as error)
```

### Email Discovery
```
Step 1: Page scraping (always runs)
  └── Found ≥ 2 emails? → DONE (skip API calls)
Step 2: Hunter.io (if key + quota)
Step 3: Snov.io (if key + quota)
Step 4: Pattern guessing (always runs as last resort)
```

### Domain Authority
```
OpenPageRank API (if key + quota)
  └── unavailable? → score from remaining signals only
Tranco List API (no key needed)
Wayback Machine API (no key needed)
Referring domain count (local DB)
```

---

## Rate Limiting Architecture

```
                  ┌──────────────────────┐
                  │   Rate Limiter       │
                  │                      │
Outgoing request ─┤  1. Per-host delay   │
                  │     └── adaptive     │
                  │     └── backoff      │
                  │                      │
                  │  2. Per-service quota │
                  │     └── Redis counter│
                  │     └── daily reset  │
                  │                      │
                  │  3. Global semaphore │
                  │     └── max 5 active │
                  │                      │
                  │  4. UA rotation      │
                  │     └── 20 agents    │
                  └──────────────────────┘
```

---

## Deduplication Strategy

```
Layer 1 (fastest): Bloom Filter (in-memory)
  └── 1M URLs / 1.2MB RAM / 1% false positive
  └── Check before adding to queue

Layer 2 (queue-level): BullMQ Job ID
  └── Job ID = hash of normalized URL
  └── BullMQ rejects duplicate job IDs

Layer 3 (guaranteed): PostgreSQL UNIQUE
  └── UNIQUE constraints on key columns
  └── ON CONFLICT DO NOTHING / DO UPDATE
```

---

## Configuration Hierarchy

```
.env file
    │
    ▼
src/config/index.js (reads env, sets defaults)
    │
    ├──▶ db config (pool size, timeouts)
    ├──▶ redis config (host, port)
    ├──▶ API keys + daily limits
    ├──▶ server config (port, host)
    └──▶ rate limit config (delays, concurrency)
```

---

## Graceful Shutdown

On `SIGTERM` or `SIGINT`:

```
1. Close all 6 workers (stop processing)
2. Close all 7 queues (disconnect from Redis)
3. Close Fastify server (stop HTTP)
4. Close Redis connection
5. Close PostgreSQL pool
6. Exit process
```

This ensures no data loss — active jobs return to the queue for another worker to pick up.
