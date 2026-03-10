# 🔗 Off-Page SEO Automation Engine

A fully automated off-page SEO system that discovers backlink opportunities, analyzes domain quality, finds contact emails, and identifies broken link opportunities — all using **free APIs** and **open-source tools**.

> **Zero hosting cost.** Runs on your own Linux server with free API tiers.

---

## Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Workers](#-workers)
- [Database Schema](#-database-schema)
- [Free API Budget](#-free-api-budget)
- [Project Structure](#-project-structure)
- [How It Works](#-how-it-works)
- [Monitoring](#-monitoring)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Features

| Feature                        | Description                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Full Pipeline Automation**   | One API call triggers the entire flow — competitor discovery → backlink extraction → domain scoring → email finding → opportunity classification |
| **Multi-Source SERP**          | Serper.dev → DuckDuckGo → Google Custom Search — automatic fallback chain                                                                        |
| **Common Crawl Integration**   | Stream billions of web graph edges to extract backlinks — free and unlimited                                                                     |
| **Smart Domain Scoring**       | Composite scoring using OpenPageRank + Tranco List + Wayback Machine age + referring domain count                                                |
| **4-Step Email Discovery**     | Page scraping → Hunter.io → Snov.io → pattern-based guessing                                                                                     |
| **Broken Link Detection**      | Automatically finds 404 links on resource pages — highest-conversion outreach strategy                                                           |
| **Opportunity Classification** | Auto-detects guest post pages, resource pages, directories, and forums                                                                           |
| **Adaptive Rate Limiting**     | Per-host exponential backoff, 20 user-agent rotation, Redis quota tracking                                                                       |
| **3-Layer Deduplication**      | Bloom filter → BullMQ job ID → PostgreSQL UNIQUE constraints                                                                                     |
| **Structured Logging**         | Pino JSON logging with worker-scoped child loggers                                                                                               |
| **Graceful Shutdown**          | Clean worker → queue → server → Redis → DB shutdown on SIGTERM/SIGINT                                                                            |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Fastify API Server                       │
│                    (REST endpoints)                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  POST /api/pipeline/start                                    │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐     │
│  │ Competitor   │───▶│  Backlink   │───▶│   Domain     │     │
│  │ Discovery    │    │ Extraction  │    │  Analyzer    │     │
│  │ Worker       │    │ Worker      │    │  Worker      │     │
│  └─────────────┘    └─────────────┘    └──────┬───────┘     │
│                                                │             │
│                                                ▼             │
│                           ┌──────────────┐  ┌──────────┐    │
│                           │ Opportunity  │──│  Email   │    │
│                           │ Classifier   │  │  Finder  │    │
│                           └──────────────┘  └──────────┘    │
│                                                              │
│  ┌──────────────┐                                            │
│  │ Broken Link  │  (independent — runs on resource pages)    │
│  │ Worker       │                                            │
│  └──────────────┘                                            │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│     BullMQ Queues (Redis)    │    PostgreSQL Database        │
└──────────────────────────────────────────────────────────────┘

External Data Sources:
  ├── Serper.dev API (SERP)
  ├── DuckDuckGo HTML (SERP fallback)
  ├── Google Custom Search API (SERP fallback)
  ├── Common Crawl Web Graphs (backlinks)
  ├── OpenPageRank API (domain authority)
  ├── Tranco List API (domain ranking)
  ├── Wayback Machine API (domain age)
  ├── Hunter.io API (email)
  └── Snov.io API (email)
```

---

## 🛠 Tech Stack

| Component          | Technology                                                   | Purpose                                |
| ------------------ | ------------------------------------------------------------ | -------------------------------------- |
| **API Server**     | [Fastify](https://fastify.dev/)                              | High-performance HTTP server           |
| **Queue System**   | [BullMQ](https://bullmq.io/) + [Redis](https://redis.io/)    | Job queuing, retries, rate limiting    |
| **Database**       | [PostgreSQL](https://www.postgresql.org/)                    | Persistent storage for all data        |
| **HTTP Client**    | [Axios](https://axios-http.com/)                             | Web requests and API calls             |
| **HTML Parser**    | [Cheerio](https://cheerio.js.org/)                           | Server-side HTML parsing (jQuery-like) |
| **Link Validator** | [Linkinator](https://github.com/JustinBeckwith/linkinator)   | Production-grade broken link detection |
| **Logger**         | [Pino](https://getpino.io/)                                  | High-performance structured logging    |
| **Deduplication**  | [bloom-filters](https://www.npmjs.com/package/bloom-filters) | Memory-efficient probabilistic dedup   |
| **Runtime**        | [Node.js](https://nodejs.org/)                               | Server-side JavaScript                 |

All dependencies are **open-source** and **free**.

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Install                           |
| ----------- | ------- | --------------------------------- |
| Node.js     | ≥ 18.x  | [nodejs.org](https://nodejs.org/) |
| PostgreSQL  | ≥ 14.x  | `sudo apt install postgresql`     |
| Redis       | ≥ 7.x   | `sudo apt install redis-server`   |

### 1. Clone & Install

```bash
cd /path/to/back-link-automation
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your database credentials and API keys
```

### 3. Create Database

```bash
# Create the PostgreSQL database
sudo -u postgres createdb seo_automation

# Create a user (optional — adjust .env to match)
sudo -u postgres psql -c "CREATE USER seo_user WITH PASSWORD 'seo_pass';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE seo_automation TO seo_user;"
```

### 4. Start Redis

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running:
sudo systemctl start redis
```

### 5. Start the Engine

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

You should see:

```
✅ Database initialized
✅ Redis connected
✅ Rate limiter initialized
✅ Queues initialized
✅ Workers started
✅ Server listening on http://0.0.0.0:3000

═══════════════════════════════════════════
 Off-Page SEO Automation Engine is READY
═══════════════════════════════════════════
```

### 6. Start a Pipeline

```bash
curl -X POST http://localhost:3000/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{
    "targetDomain": "yoursite.com",
    "keywords": ["seo tools", "backlink checker", "link building guide"]
  }'
```

Response:

```json
{
  "message": "Pipeline started",
  "targetDomain": "yoursite.com",
  "keywords": ["seo tools", "backlink checker", "link building guide"],
  "jobId": "competitor:yoursite.com:1709712000000"
}
```

---

## ⚙ Configuration

All configuration is via the `.env` file:

### Database

```env
DATABASE_URL=postgresql://seo_user:seo_pass@localhost:5432/seo_automation
DB_HOST=localhost
DB_PORT=5432
DB_NAME=seo_automation
DB_USER=seo_user
DB_PASSWORD=seo_pass
```

### Redis

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # leave empty if no auth
```

### API Keys (All Optional — System Works Without Them)

```env
# Serper.dev — 2,500 searches/month free
# Sign up at: https://serper.dev
SERPER_API_KEY=

# Google Custom Search — 100 queries/day free
# Setup at: https://programmablesearchengine.google.com
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_CX=

# Hunter.io — 25 lookups/month free
# Sign up at: https://hunter.io
HUNTER_API_KEY=

# Snov.io — 50 credits/month free
# Sign up at: https://snov.io
SNOV_API_KEY=

# Skrapp.io — 100 emails/month free
# Sign up at: https://skrapp.io
SKRAPP_API_KEY=

# OpenPageRank — 10M lookups/month free
# Sign up at: https://www.domcop.com/openpagerank/
OPENPAGERANK_API_KEY=
```

### Server

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development     # or "production"
LOG_LEVEL=info           # trace | debug | info | warn | error
```

### Alerts (Optional)

```env
# Webhook URL for critical alerts (Slack, Discord, etc.)
ALERT_WEBHOOK_URL=
```

> **Note:** When API keys are not configured, the system automatically falls back to web scraping methods. You can start with zero API keys and add them later for increased throughput.

---

## 📡 API Reference

Base URL: `http://localhost:3000`

### Pipeline

#### Start Full Pipeline

Triggers the entire automation flow for a target domain.

```
POST /api/pipeline/start
```

**Request Body:**

```json
{
  "targetDomain": "yoursite.com",
  "keywords": ["seo tools", "backlink checker", "link building"]
}
```

| Field          | Type     | Required | Description                                    |
| -------------- | -------- | -------- | ---------------------------------------------- |
| `targetDomain` | string   | ✅        | Your domain to find backlink opportunities for |
| `keywords`     | string[] | ✅        | Keywords your domain targets (min 1)           |

**Response** `202 Accepted`:

```json
{
  "message": "Pipeline started",
  "targetDomain": "yoursite.com",
  "keywords": ["seo tools", "backlink checker", "link building"],
  "jobId": "competitor:yoursite.com:1709712000000"
}
```

**What happens next (automatically):**

1. **Competitor Discovery** — Searches your keywords across SERP sources, finds domains ranking for them
2. **Backlink Extraction** — Crawls each competitor website to find their outbound links
3. **Domain Analysis** — Scores each newly discovered domain on quality (PageRank, Tranco, age, refs)
4. **Opportunity Classification** — Classifies pages as guest-post, resource, directory, etc.
5. **Email Discovery** — Finds contact emails for high-scoring opportunities

---

### Manual Job Triggers

Run individual steps independently.

#### Extract Backlinks

```
POST /api/jobs/backlink-extract
```

```json
{ "domain": "competitor.com" }
```

#### Analyze Domain

```
POST /api/jobs/analyze-domain
```

```json
{ "domain": "example.com" }
```

#### Find Emails

```
POST /api/jobs/find-email
```

```json
{ "domain": "example.com" }
```

#### Check Broken Links

```
POST /api/jobs/check-broken-links
```

```json
{ "pageUrl": "https://example.com/resources" }
```

#### Classify Opportunity

```
POST /api/jobs/classify
```

```json
{ "domain": "example.com", "pageUrl": "https://example.com/write-for-us" }
```

All manual job endpoints return `202 Accepted` with:

```json
{ "jobId": "job-id-here", "domain": "example.com" }
```

---

### Data Queries

#### List Opportunities

```
GET /api/opportunities?minScore=50&type=guest_post&status=new&limit=50
```

| Param      | Default | Description                                                               |
| ---------- | ------- | ------------------------------------------------------------------------- |
| `minScore` | `0`     | Minimum opportunity score (0-100)                                         |
| `type`     | all     | Filter: `guest_post`, `resource_page`, `directory`, `forum`, `niche_edit` |
| `status`   | `new`   | Filter: `new`, `contacted`, `replied`, `converted`, `rejected`            |
| `limit`    | `50`    | Max results (up to 500)                                                   |

**Response:**

```json
[
  {
    "id": 1,
    "domain": "techblog.com",
    "page_url": "https://techblog.com/write-for-us",
    "opportunity_type": "guest_post",
    "score": 82,
    "contact_email": "editor@techblog.com",
    "contact_name": "John Smith",
    "domain_score": 75.3,
    "status": "new",
    "created_at": "2026-03-06T06:00:00.000Z"
  }
]
```

#### List Domains

```
GET /api/domains?minScore=30&limit=50
```

#### Get Backlinks for Domain

```
GET /api/backlinks/yoursite.com?limit=100
```

#### Get Contacts for Domain

```
GET /api/contacts/techblog.com
```

#### List Broken Links

```
GET /api/broken-links?limit=50
```

---

### Health & Monitoring

#### System Health

```
GET /health
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-03-06T06:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

#### Queue Statistics

```
GET /stats/queues
```

```json
{
  "COMPETITOR_DISCOVERY": { "active": 1, "waiting": 3, "completed": 42, "failed": 0, "delayed": 0 },
  "BACKLINK_EXTRACTION": { "active": 2, "waiting": 15, "completed": 120, "failed": 2, "delayed": 0 },
  ...
}
```

#### API Quota Usage

```
GET /stats/quotas
```

```json
{
  "serper.dev": { "usedToday": 45 },
  "google-cse": { "usedToday": 0 },
  "api.hunter.io": { "usedToday": 1 },
  "api.snov.io": { "usedToday": 0 },
  "openpagerank.com": { "usedToday": 230 }
}
```

#### Pipeline Overview

```
GET /stats/pipeline
```

```json
{
  "totalDomains": 1523,
  "totalBacklinks": 45782,
  "opportunities": { "new": 342, "contacted": 28, "converted": 5 },
  "totalContacts": 891,
  "totalBrokenLinks": 156
}
```

#### System Metrics

```
GET /stats/metrics?limit=50
```

---

## ⚙ Workers

### 1. Competitor Discovery Worker

**Queue:** `competitor-discovery`  
**Concurrency:** 1
**Input:** `{ targetDomain, keywords[] }`

Searches each keyword through the SERP fallback chain (Serper → DDG → Google CSE). Extracts domains from results, filters out the target domain, and stores competitors in the database. Automatically enqueues backlink extraction for each new competitor.

### 2. Backlink Extraction Worker

**Queue:** `backlink-extraction`  
**Concurrency:** 2  
**Input:** `{ domain, targetDomain }`

Crawls competitor websites (homepage + `/resources`, `/links`, `/partners`, `/blogroll`). Extracts all outbound links using Cheerio. Filters out social media, CDNs, and low-value domains. Stores unique backlinks and enqueues domain analysis for each new linking domain.

### 3. Domain Analyzer Worker

**Queue:** `domain-analysis`  
**Concurrency:** 3  
**Input:** `{ domain }`

Calculates a composite quality score (0-100) from:

| Signal            | Weight | Source              | Free Tier |
| ----------------- | ------ | ------------------- | --------- |
| Page Rank         | 30%    | OpenPageRank API    | 10M/month |
| Tranco Rank       | 25%    | tranco-list.eu API  | Unlimited |
| Referring Domains | 25%    | Own database        | N/A       |
| Domain Age        | 20%    | Wayback Machine API | Unlimited |

### 4. Email Finder Worker

**Queue:** `email-finder`  
**Concurrency:** 2  
**Input:** `{ domain }`

4-step pipeline:

| Step                | Method                                                                                                    | Cost             |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| 1. Page Scraping    | Crawl `/contact`, `/about`, `/team`, `/write-for-us` pages for `mailto:` links and regex email extraction | Free (unlimited) |
| 2. Hunter.io        | Domain search API                                                                                         | 25/month free    |
| 3. Snov.io          | Domain email search                                                                                       | 50/month free    |
| 4. Pattern Guessing | Generate `info@`, `contact@`, `editor@`, etc.                                                             | Free (unlimited) |

**Optimization:** If scraping (Step 1) finds ≥2 emails, API steps are skipped to save quota.

### 5. Broken Link Worker (Hybrid — Linkinator + Cheerio)

**Queue:** `broken-link`  
**Concurrency:** 2  
**Input:** `{ pageUrl, sourceDomain }`

Uses a hybrid approach for maximum accuracy and reliability:

1. **Cheerio Pre-pass** — Fetches the page and builds an anchor-text map (`url → anchor text`) for outreach context.
2. **Linkinator Scan** — Validates all links on the page using [Linkinator](https://github.com/JustinBeckwith/linkinator), which provides production-grade HTTP checking with automatic `Retry-After` (429) handling, 5xx retry with jitter, redirect-loop detection, and 25-way concurrency.
3. **External Filter** — Filters results to keep only external broken links. Merges anchor text from step 1.

Links with state `BROKEN` (404, 410, 521, connection errors) are stored as broken link opportunities.

**Why Linkinator?** Reduces false positives from bot-blocking servers, handles rate limits automatically, and eliminates edge cases that manual `axios.head()` calls miss.

### 6. Opportunity Classifier Worker

**Queue:** `opportunity-classifier`  
**Concurrency:** 3  
**Input:** `{ domain, pageUrl }`

Downloads the page and matches content against keyword patterns:

| Type            | Example Keywords                                      | Base Score |
| --------------- | ----------------------------------------------------- | ---------- |
| `guest_post`    | "write for us", "guest post guidelines", "contribute" | 90         |
| `resource_page` | "resources", "useful links", "tools we use"           | 80         |
| `directory`     | "submit your site", "web directory"                   | 40         |
| `forum`         | "forum", "discussion", "community"                    | 20         |
| `niche_edit`    | Default (none of the above)                           | 30         |

Final score = (classification score × 40%) + (domain quality score × 60%).  
Auto-enqueues email finder for opportunities scoring ≥50.

---

## 🗄 Database Schema

### Tables

#### `domains`

Stores all discovered domains and their quality metrics.

| Column           | Type                | Description                                 |
| ---------------- | ------------------- | ------------------------------------------- |
| `id`             | SERIAL PK           | Auto-increment ID                           |
| `domain`         | VARCHAR(255) UNIQUE | Raw domain string                           |
| `normalized`     | VARCHAR(255) UNIQUE | Normalized domain                           |
| `tranco_rank`    | INTEGER             | Position in Tranco top-1M list              |
| `whois_age_days` | INTEGER             | Domain age in days                          |
| `page_rank`      | REAL                | OpenPageRank score                          |
| `quality_score`  | REAL                | Composite quality score (0–100)             |
| `is_competitor`  | BOOLEAN             | Whether this was identified as a competitor |
| `category`       | VARCHAR(100)        | Domain category                             |
| `first_seen`     | TIMESTAMP           | When first discovered                       |
| `last_updated`   | TIMESTAMP           | Last analysis time                          |

#### `backlinks`

Stores link relationships between domains.

| Column          | Type         | Description                                |
| --------------- | ------------ | ------------------------------------------ |
| `id`            | SERIAL PK    | Auto-increment ID                          |
| `from_domain`   | VARCHAR(255) | Source domain (the linker)                 |
| `to_domain`     | VARCHAR(255) | Target domain (being linked to)            |
| `from_url`      | TEXT         | Full source page URL                       |
| `to_url`        | TEXT         | Full target URL                            |
| `anchor_text`   | TEXT         | Anchor text of the link                    |
| `source`        | VARCHAR(50)  | How discovered: `commoncrawl` or `crawled` |
| `discovered_at` | TIMESTAMP    | When discovered                            |

**Unique constraint:** `(from_domain, to_domain, from_url)`

#### `opportunities`

Scored and classified outreach targets.

| Column             | Type         | Description                                                       |
| ------------------ | ------------ | ----------------------------------------------------------------- |
| `id`               | SERIAL PK    | Auto-increment ID                                                 |
| `domain`           | VARCHAR(255) | Target domain                                                     |
| `page_url`         | TEXT         | Specific page URL                                                 |
| `opportunity_type` | VARCHAR(50)  | `guest_post`, `resource_page`, `directory`, `forum`, `niche_edit` |
| `score`            | REAL         | Combined opportunity score (0–100)                                |
| `contact_email`    | VARCHAR(255) | Best contact email                                                |
| `contact_source`   | VARCHAR(50)  | Where email was found                                             |
| `status`           | VARCHAR(30)  | `new`, `contacted`, `replied`, `converted`, `rejected`            |
| `notes`            | TEXT         | Free-form notes                                                   |
| `created_at`       | TIMESTAMP    | When created                                                      |
| `updated_at`       | TIMESTAMP    | Last update                                                       |

#### `contacts`

Contact emails discovered for domains.

| Column          | Type         | Description                            |
| --------------- | ------------ | -------------------------------------- |
| `id`            | SERIAL PK    | Auto-increment ID                      |
| `domain`        | VARCHAR(255) | Domain the contact belongs to          |
| `email`         | VARCHAR(255) | Email address                          |
| `name`          | VARCHAR(255) | Contact name (if found)                |
| `role`          | VARCHAR(100) | Position/role (if found)               |
| `source`        | VARCHAR(50)  | `scraped`, `hunter`, `snov`, `pattern` |
| `verified`      | BOOLEAN      | Whether SMTP-verified                  |
| `discovered_at` | TIMESTAMP    | When discovered                        |

**Unique constraint:** `(domain, email)`

#### `broken_links`

Broken outbound links found on resource pages.

| Column          | Type         | Description                                    |
| --------------- | ------------ | ---------------------------------------------- |
| `id`            | SERIAL PK    | Auto-increment ID                              |
| `source_page`   | TEXT         | Page containing the broken link                |
| `source_domain` | VARCHAR(255) | Domain of the page                             |
| `broken_url`    | TEXT         | The broken URL                                 |
| `anchor_text`   | TEXT         | Anchor text of the broken link                 |
| `http_status`   | INTEGER      | HTTP status (404, 410, 0 for connection error) |
| `discovered_at` | TIMESTAMP    | When discovered                                |

**Unique constraint:** `(source_page, broken_url)`

#### `crawl_history`

Log of all HTTP requests made by the system.

| Column          | Type         | Description            |
| --------------- | ------------ | ---------------------- |
| `id`            | SERIAL PK    | Auto-increment ID      |
| `url`           | TEXT         | Crawled URL            |
| `domain`        | VARCHAR(255) | Domain                 |
| `http_status`   | INTEGER      | Response status code   |
| `content_type`  | VARCHAR(100) | Response content type  |
| `response_time` | INTEGER      | Response time in ms    |
| `crawled_at`    | TIMESTAMP    | When crawled           |
| `error`         | TEXT         | Error message (if any) |

#### `system_metrics`

Internal metrics for monitoring and alerting.

| Column         | Type         | Description                               |
| -------------- | ------------ | ----------------------------------------- |
| `id`           | SERIAL PK    | Auto-increment ID                         |
| `metric_name`  | VARCHAR(100) | Metric identifier                         |
| `metric_value` | REAL         | Numeric value                             |
| `labels`       | JSONB        | Additional context (domain, worker, etc.) |
| `recorded_at`  | TIMESTAMP    | When recorded                             |

### Indexes

| Index                       | Table          | Columns                      | Purpose                          |
| --------------------------- | -------------- | ---------------------------- | -------------------------------- |
| `idx_backlinks_to_domain`   | backlinks      | `to_domain`                  | Find who links to a domain       |
| `idx_backlinks_from_domain` | backlinks      | `from_domain`                | Find where a domain links out to |
| `idx_domains_score`         | domains        | `quality_score DESC`         | Sort domains by quality          |
| `idx_domains_competitor`    | domains        | `is_competitor` (partial)    | Fast competitor lookup           |
| `idx_opportunities_status`  | opportunities  | `status`                     | Filter by pipeline stage         |
| `idx_opportunities_score`   | opportunities  | `score DESC`                 | Sort by opportunity value        |
| `idx_contacts_domain`       | contacts       | `domain`                     | Find contacts for a domain       |
| `idx_broken_links_domain`   | broken_links   | `source_domain`              | Group by source                  |
| `idx_crawl_history_domain`  | crawl_history  | `domain`                     | Crawl history per domain         |
| `idx_system_metrics_name`   | system_metrics | `(metric_name, recorded_at)` | Time-series queries              |

---

## 💰 Free API Budget

Monthly capacity with free tiers:

| Service              | Free Tier       | Daily Budget | Used For                |
| -------------------- | --------------- | ------------ | ----------------------- |
| Common Crawl         | **Unlimited**   | Unlimited    | Backlink data           |
| OpenPageRank         | 10M/month       | ~333K/day    | Domain authority scores |
| Serper.dev           | 2,500/month     | ~83/day      | Primary SERP            |
| Google Custom Search | 100/day         | 100/day      | Fallback SERP           |
| Tranco List          | **Unlimited**   | Unlimited    | Domain rankings         |
| Wayback Machine      | **Unlimited**   | Unlimited    | Domain age              |
| DuckDuckGo (scrape)  | ~500/day (safe) | ~500/day     | Fallback SERP           |
| Hunter.io            | 25/month        | ~1/day       | Email discovery         |
| Snov.io              | 50/month        | ~2/day       | Email discovery         |
| Page scraping        | **Unlimited**   | Unlimited    | Emails, content         |

**Total**: ~15,000+ SERP queries/month, 10M authority lookups, unlimited backlink data, ~75 email API lookups + unlimited scraping.

---

## 📁 Project Structure

```
back-link-automation/
│
├── index.js                          # App entry point — boots everything
├── package.json
├── .env                              # Environment config (gitignored)
├── .env.example                      # Config template
├── .gitignore
├── logs/                             # Log files (production)
│
├── docs/
│   ├── API.md                        # API reference
│   └── DATABASE.md                   # Schema documentation
│
└── src/
    ├── config/
    │   └── index.js                  # Centralized config from .env
    │
    ├── db/
    │   └── index.js                  # PostgreSQL pool, schema init, helpers
    │
    ├── queue/
    │   └── index.js                  # BullMQ queue & worker factory
    │
    ├── utils/
    │   ├── logger.js                 # Pino structured logger
    │   ├── normalizer.js             # URL & domain normalization (8 rules)
    │   ├── dedup.js                  # Bloom filter dedup engine
    │   └── rateLimiter.js            # Adaptive rate control + UA rotation
    │
    ├── services/
    │   ├── commonCrawl.js            # Common Crawl web graph streaming
    │   └── serp.js                   # Multi-source SERP (Serper→DDG→Google)
    │
    ├── workers/
    │   ├── competitorWorker.js       # SERP-based competitor discovery
    │   ├── backlinkWorker.js         # Page crawling + link extraction
    │   ├── domainAnalyzerWorker.js   # Multi-signal quality scoring
    │   ├── emailFinderWorker.js      # 4-step email pipeline
    │   ├── brokenLinkWorker.js       # 404 detection on outbound links
    │   └── opportunityClassifierWorker.js  # Page type classification
    │
    └── routes/
        ├── health.js                 # /health, /stats/*
        └── automation.js             # /api/pipeline/*, /api/jobs/*, /api/*
```

---

## 🔄 How It Works

### The Automation Pipeline

```
You call:
  POST /api/pipeline/start
  { targetDomain: "yoursite.com", keywords: ["seo tools", "link building"] }

System does:

1. COMPETITOR DISCOVERY
   ├── Searches "seo tools" on Serper.dev → gets 10 results
   ├── Searches "link building" on Serper.dev → gets 10 results
   ├── Extracts unique domains: competitor1.com, competitor2.com, ...
   ├── Stores competitors in DB
   └── Enqueues: backlink-extraction for each competitor

2. BACKLINK EXTRACTION (per competitor)
   ├── Crawls https://competitor1.com/
   ├── Crawls https://competitor1.com/resources
   ├── Extracts all outbound <a href="..."> links
   ├── Filters: removes social media, CDNs, low-value links
   ├── Dedup: Bloom filter → BullMQ jobId → DB UNIQUE
   ├── Stores backlinks in DB
   └── Enqueues: domain-analysis for each new linking domain

3. DOMAIN ANALYSIS (per linking domain)
   ├── Fetches OpenPageRank score → 7.2/10
   ├── Fetches Tranco rank → #45,230
   ├── Checks Wayback Machine → domain age: 2,340 days
   ├── Counts referring domains from DB → 87
   ├── Calculates composite score → 72.4/100
   └── Stores domain analysis in DB

4. OPPORTUNITY CLASSIFICATION (per domain)
   ├── Downloads page content
   ├── Matches against keyword patterns
   ├── Classification: "guest_post" (score: 90)
   ├── Combined: (90 × 40%) + (72.4 × 60%) = 79.4
   ├── Stores opportunity in DB
   └── Score ≥ 50? → Enqueues: email-finder

5. EMAIL DISCOVERY (per high-score opportunity)
   ├── Step 1: Scrapes /contact, /about, /team pages
   │   └── Found: editor@competitor1.com (mailto: link)
   ├── Step 2: Hunter.io → skipped (already found 1 email)
   ├── Step 3: Snov.io → skipped (already found 1 email)
   └── Stores contact in DB

Result in your database:
  ┌──────────────────────────────────────────────────────────────┐
  │ Domain: competitor1.com                                      │
  │ Score: 79.4                                                  │
  │ Type: guest_post                                             │
  │ Page: https://competitor1.com/write-for-us                   │
  │ Contact: editor@competitor1.com                              │
  │ Status: new                                                  │
  └──────────────────────────────────────────────────────────────┘
```

### URL Normalization (8 Rules)

Every URL is normalized before storage to prevent duplicates:

| Rule                      | Before                       | After                      |
| ------------------------- | ---------------------------- | -------------------------- |
| 1. Lowercase              | `HTTPS://Example.COM/Page`   | `https://example.com/page` |
| 2. Force HTTPS            | `http://example.com`         | `https://example.com`      |
| 3. Strip www              | `https://www.example.com`    | `https://example.com`      |
| 4. Remove trailing slash  | `https://example.com/page/`  | `https://example.com/page` |
| 5. Remove default ports   | `https://example.com:443`    | `https://example.com`      |
| 6. Sort query params      | `?b=2&a=1`                   | `?a=1&b=2`                 |
| 7. Remove tracking params | `?utm_source=twitter&page=1` | `?page=1`                  |
| 8. Remove fragments       | `#section-2`                 | (removed)                  |

### Rate Limiting

The adaptive rate limiter prevents IP bans:

| Behavior                 | Action                                        |
| ------------------------ | --------------------------------------------- |
| Successful request (200) | Gradually reduce delay to minimum (2 seconds) |
| Rate limited (429/503)   | Double the delay (max 15 seconds)             |
| 5 consecutive errors     | Pause the host for 10 minutes                 |
| API quota at 80%         | Log a warning                                 |
| API quota exhausted      | Skip to next source in fallback chain         |

Each request also rotates through 20 different User-Agent strings.

---

## 📊 Monitoring

### Health Endpoint

```bash
curl http://localhost:3000/health
```

Checks PostgreSQL connectivity, Redis connectivity, and process uptime.

### Logged Metrics

The system records metrics to the `system_metrics` table:

| Metric                     | When Recorded                    |
| -------------------------- | -------------------------------- |
| `competitors_discovered`   | After competitor discovery job   |
| `backlinks_extracted`      | After backlink extraction job    |
| `domains_analyzed`         | After domain analysis job        |
| `emails_found`             | After email discovery job        |
| `broken_links_found`       | After broken link check          |
| `opportunities_classified` | After opportunity classification |
| `commoncrawl_processed`    | After Common Crawl ingestion     |
| `commoncrawl_matched`      | After Common Crawl ingestion     |

### Log Format

Logs use Pino structured JSON format:

```json
{"level":30,"time":1709712000000,"module":"worker:backlink","domain":"techblog.com","count":142,"msg":"backlinks extracted"}
{"level":40,"time":1709712001000,"module":"rate-limiter","service":"hunter","quotaUsed":24,"quotaMax":25,"msg":"API quota nearly exhausted"}
```

In development, `pino-pretty` formats these as human-readable output.

---

## 🔧 Troubleshooting

### Database connection failed

```
❌ Database initialization failed
💡 Make sure PostgreSQL is running and the database exists.
   Run: createdb seo_automation
```

**Fix:**

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Create the database
sudo -u postgres createdb seo_automation

# Verify .env credentials match
psql -U seo_user -d seo_automation -h localhost
```

### Redis connection failed

```
❌ Redis connection failed
💡 Make sure Redis is running: redis-server
```

**Fix:**

```bash
# Start Redis
sudo systemctl start redis

# Verify
redis-cli ping   # Should return PONG
```

### No results from SERP

- Check if `SERPER_API_KEY` is set in `.env`
- Without any API key, the system uses DuckDuckGo HTML scraping (rate limited)
- Add at least one SERP API key for reliable results

### Workers not processing

```bash
# Check queue status
curl http://localhost:3000/stats/queues

# Check for failed jobs
curl "http://localhost:3000/stats/metrics?limit=20"
```

### Rate limited / blocked

```bash
# Check current quotas
curl http://localhost:3000/stats/quotas
```

The system handles this automatically with backoff, but if persistent:
- Increase `minDelayMs` in `src/config/index.js`
- Reduce worker concurrency
- Add more SERP API keys for higher throughput

---

## 📜 License

ISC
