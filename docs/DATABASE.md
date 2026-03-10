# Database Schema

Auto-created on first startup via `src/db/index.js → initializeDatabase()`.

---

## Entity Relationship Diagram

```
┌──────────────┐        ┌──────────────┐
│   domains    │        │  backlinks   │
│──────────────│        │──────────────│
│ id PK        │◄──────┐│ id PK        │
│ domain       │       ││ from_domain  │──── links from this domain
│ normalized   │       └│ to_domain    │──── links to this domain
│ tranco_rank  │        │ from_url     │
│ whois_age    │        │ to_url       │
│ page_rank    │        │ anchor_text  │
│ quality_score│        │ source       │
│ is_competitor│        │ discovered_at│
│ category     │        └──────────────┘
│ first_seen   │
│ last_updated │        ┌──────────────────┐
└──────┬───────┘        │  opportunities   │
       │                │──────────────────│
       │                │ id PK            │
       ├───────────────▶│ domain           │
       │                │ page_url         │
       │                │ opportunity_type │
       │                │ score            │
       │                │ contact_email    │
       │                │ status           │
       │                │ notes            │
       │                │ created_at       │
       │                └──────────────────┘
       │
       │                ┌──────────────┐
       │                │  contacts    │
       │                │──────────────│
       │                │ id PK        │
       ├───────────────▶│ domain       │
       │                │ email        │
       │                │ name         │
       │                │ role         │
       │                │ source       │
       │                │ verified     │
       │                │ discovered_at│
       │                └──────────────┘
       │
       │                ┌──────────────────┐
       │                │  broken_links    │
       │                │──────────────────│
       │                │ id PK            │
       └───────────────▶│ source_domain    │
                        │ source_page      │
                        │ broken_url       │
                        │ anchor_text      │
                        │ http_status      │
                        │ discovered_at    │
                        └──────────────────┘

┌──────────────────┐    ┌──────────────────┐
│  crawl_history   │    │ system_metrics   │
│──────────────────│    │──────────────────│
│ id PK            │    │ id PK            │
│ url              │    │ metric_name      │
│ domain           │    │ metric_value     │
│ http_status      │    │ labels (JSONB)   │
│ content_type     │    │ recorded_at      │
│ response_time    │    └──────────────────┘
│ crawled_at       │
│ error            │
└──────────────────┘
```

---

## Tables

### domains

| Column         | Type         | Constraints      | Default | Notes                 |
| -------------- | ------------ | ---------------- | ------- | --------------------- |
| id             | SERIAL       | PRIMARY KEY      | auto    |                       |
| domain         | VARCHAR(255) | NOT NULL, UNIQUE |         | Raw string            |
| normalized     | VARCHAR(255) | NOT NULL, UNIQUE |         | Lowercase, no www     |
| tranco_rank    | INTEGER      |                  | NULL    | 1 = best, 1M = lowest |
| whois_age_days | INTEGER      |                  | NULL    | Age in days           |
| page_rank      | REAL         |                  | NULL    | OpenPageRank (0-10)   |
| quality_score  | REAL         |                  | 0       | Composite (0-100)     |
| is_competitor  | BOOLEAN      |                  | FALSE   | Discovered via SERP   |
| category       | VARCHAR(100) |                  | NULL    | Niche/topic category  |
| first_seen     | TIMESTAMP    |                  | NOW()   |                       |
| last_updated   | TIMESTAMP    |                  | NOW()   |                       |

### backlinks

| Column        | Type         | Constraints | Default       | Notes                      |
| ------------- | ------------ | ----------- | ------------- | -------------------------- |
| id            | SERIAL       | PRIMARY KEY | auto          |                            |
| from_domain   | VARCHAR(255) | NOT NULL    |               | The linking domain         |
| to_domain     | VARCHAR(255) | NOT NULL    |               | The linked-to domain       |
| from_url      | TEXT         |             | NULL          | Full source URL            |
| to_url        | TEXT         |             | NULL          | Full target URL            |
| anchor_text   | TEXT         |             | NULL          | Link text                  |
| source        | VARCHAR(50)  |             | 'commoncrawl' | `commoncrawl` or `crawled` |
| discovered_at | TIMESTAMP    |             | NOW()         |                            |

**Unique:** `(from_domain, to_domain, from_url)`

### opportunities

| Column           | Type         | Constraints | Default | Notes                                                       |
| ---------------- | ------------ | ----------- | ------- | ----------------------------------------------------------- |
| id               | SERIAL       | PRIMARY KEY | auto    |                                                             |
| domain           | VARCHAR(255) | NOT NULL    |         | Target domain                                               |
| page_url         | TEXT         |             | NULL    | Specific page                                               |
| opportunity_type | VARCHAR(50)  |             | NULL    | guest_post / resource_page / directory / forum / niche_edit |
| score            | REAL         |             | 0       | Combined score (0-100)                                      |
| contact_email    | VARCHAR(255) |             | NULL    | Best email found                                            |
| contact_source   | VARCHAR(50)  |             | NULL    | Where email came from                                       |
| status           | VARCHAR(30)  |             | 'new'   | Pipeline stage                                              |
| notes            | TEXT         |             | NULL    | Free-form notes                                             |
| created_at       | TIMESTAMP    |             | NOW()   |                                                             |
| updated_at       | TIMESTAMP    |             | NOW()   |                                                             |

**Status values:** `new`, `contacted`, `replied`, `converted`, `rejected`

### contacts

| Column        | Type         | Constraints | Default | Notes                                     |
| ------------- | ------------ | ----------- | ------- | ----------------------------------------- |
| id            | SERIAL       | PRIMARY KEY | auto    |                                           |
| domain        | VARCHAR(255) | NOT NULL    |         |                                           |
| email         | VARCHAR(255) |             | NULL    |                                           |
| name          | VARCHAR(255) |             | NULL    | Contact name                              |
| role          | VARCHAR(100) |             | NULL    | e.g., "editor", "marketing"               |
| source        | VARCHAR(50)  |             | NULL    | `scraped` / `hunter` / `snov` / `pattern` |
| verified      | BOOLEAN      |             | FALSE   | SMTP-verified                             |
| discovered_at | TIMESTAMP    |             | NOW()   |                                           |

**Unique:** `(domain, email)`

### broken_links

| Column        | Type         | Constraints | Default | Notes                       |
| ------------- | ------------ | ----------- | ------- | --------------------------- |
| id            | SERIAL       | PRIMARY KEY | auto    |                             |
| source_page   | TEXT         | NOT NULL    |         | Page with the broken link   |
| source_domain | VARCHAR(255) | NOT NULL    |         | Domain of source page       |
| broken_url    | TEXT         | NOT NULL    |         | The broken URL              |
| anchor_text   | TEXT         |             | NULL    | Link text                   |
| http_status   | INTEGER      |             | NULL    | 404, 410, 521, 0=conn error |
| discovered_at | TIMESTAMP    |             | NOW()   |                             |

**Unique:** `(source_page, broken_url)`

### crawl_history

| Column        | Type         | Constraints | Default | Notes         |
| ------------- | ------------ | ----------- | ------- | ------------- |
| id            | SERIAL       | PRIMARY KEY | auto    |               |
| url           | TEXT         | NOT NULL    |         | Crawled URL   |
| domain        | VARCHAR(255) |             | NULL    | Domain        |
| http_status   | INTEGER      |             | NULL    | Response code |
| content_type  | VARCHAR(100) |             | NULL    | MIME type     |
| response_time | INTEGER      |             | NULL    | Ms            |
| crawled_at    | TIMESTAMP    |             | NOW()   |               |
| error         | TEXT         |             | NULL    | Error message |

### system_metrics

| Column       | Type         | Constraints | Default | Notes             |
| ------------ | ------------ | ----------- | ------- | ----------------- |
| id           | SERIAL       | PRIMARY KEY | auto    |                   |
| metric_name  | VARCHAR(100) | NOT NULL    |         | Metric identifier |
| metric_value | REAL         | NOT NULL    |         | Numeric value     |
| labels       | JSONB        |             | '{}'    | Extra context     |
| recorded_at  | TIMESTAMP    |             | NOW()   |                   |

---

## Indexes

| Name                      | Table          | Column(s)                  | Type      |
| ------------------------- | -------------- | -------------------------- | --------- |
| idx_backlinks_to_domain   | backlinks      | to_domain                  | B-tree    |
| idx_backlinks_from_domain | backlinks      | from_domain                | B-tree    |
| idx_domains_score         | domains        | quality_score DESC         | B-tree    |
| idx_domains_competitor    | domains        | is_competitor (WHERE TRUE) | Partial   |
| idx_opportunities_status  | opportunities  | status                     | B-tree    |
| idx_opportunities_score   | opportunities  | score DESC                 | B-tree    |
| idx_contacts_domain       | contacts       | domain                     | B-tree    |
| idx_broken_links_domain   | broken_links   | source_domain              | B-tree    |
| idx_crawl_history_domain  | crawl_history  | domain                     | B-tree    |
| idx_system_metrics_name   | system_metrics | (metric_name, recorded_at) | Composite |

---

## Scoring Formula

### Domain Quality Score (0–100)

```
Score = (PageRank_norm × 30%)
      + (Tranco_norm × 25%)
      + (RefDomains_norm × 25%)
      + (DomainAge_norm × 20%)
```

| Signal            | Normalization                 | Source           |
| ----------------- | ----------------------------- | ---------------- |
| PageRank          | (raw / 10) × 100              | OpenPageRank API |
| Tranco            | 100 – (log10(rank) / 6) × 100 | tranco-list.eu   |
| Referring Domains | min(100, log10(count+1) × 33) | Own DB           |
| Domain Age        | min(100, (days / 3650) × 100) | Wayback Machine  |

If some signals are unavailable, remaining signals are re-weighted proportionally.

### Opportunity Score

```
Final = (ClassificationScore × 40%) + (DomainQualityScore × 60%)
```

Classification scores: guest_post=90, resource_page=80, directory=40, forum=20, niche_edit=30.

---

## Useful Queries

```sql
-- Top 20 opportunities (ready for outreach)
SELECT o.domain, o.page_url, o.opportunity_type, o.score,
       c.email, c.name, d.quality_score
FROM opportunities o
LEFT JOIN contacts c ON c.domain = o.domain
LEFT JOIN domains d ON d.normalized = o.domain
WHERE o.status = 'new' AND o.score >= 50
ORDER BY o.score DESC
LIMIT 20;

-- Competitors with most backlinks
SELECT d.domain, d.quality_score,
       COUNT(DISTINCT b.from_domain) as linking_domains
FROM domains d
JOIN backlinks b ON b.to_domain = d.normalized
WHERE d.is_competitor = TRUE
GROUP BY d.domain, d.quality_score
ORDER BY linking_domains DESC;

-- Broken link opportunities (for outreach)
SELECT bl.source_domain, bl.source_page, bl.broken_url,
       bl.anchor_text, bl.http_status
FROM broken_links bl
ORDER BY bl.discovered_at DESC
LIMIT 50;

-- Daily discovery stats
SELECT DATE(recorded_at) as day,
       metric_name,
       SUM(metric_value) as total
FROM system_metrics
WHERE recorded_at > NOW() - INTERVAL '7 days'
GROUP BY day, metric_name
ORDER BY day DESC, metric_name;
```
