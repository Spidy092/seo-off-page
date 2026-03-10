# API Reference

Base URL: `http://localhost:3000`

All `POST` endpoints accept JSON body. All `GET` endpoints return JSON.

---

## Pipeline Control

### POST `/api/pipeline/start`

Start the full automation pipeline.

**Request:**

```json
{
  "targetDomain": "yoursite.com",
  "keywords": ["seo tools", "backlink checker", "link building guide"]
}
```

| Field          | Type     | Required | Description                               |
| -------------- | -------- | -------- | ----------------------------------------- |
| `targetDomain` | string   | ✅        | Your website domain                       |
| `keywords`     | string[] | ✅        | Target keywords (min 1, recommended 3-10) |

**Response:** `202 Accepted`

```json
{
  "message": "Pipeline started",
  "targetDomain": "yoursite.com",
  "keywords": ["seo tools", "backlink checker", "link building guide"],
  "jobId": "competitor:yoursite.com:1709712000000"
}
```

**Pipeline chain:** Competitor Discovery → Backlink Extraction → Domain Analysis → Opportunity Classification → Email Discovery

---

## Manual Job Triggers

All return `202 Accepted` with `{ jobId, domain }`.

| Endpoint                            | Body                                                                         | Description                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `POST /api/jobs/backlink-extract`   | `{ "domain": "competitor.com" }`                                             | Extract outbound links from a domain's pages |
| `POST /api/jobs/analyze-domain`     | `{ "domain": "example.com" }`                                                | Score a domain's quality                     |
| `POST /api/jobs/find-email`         | `{ "domain": "example.com" }`                                                | Find contact emails for a domain             |
| `POST /api/jobs/check-broken-links` | `{ "pageUrl": "https://example.com/resources" }`                             | Check all outbound links on a page for 404s  |
| `POST /api/jobs/classify`           | `{ "domain": "example.com", "pageUrl": "https://example.com/write-for-us" }` | Classify opportunity type                    |

---

## Data Queries

### GET `/api/opportunities`

**Query params:**

| Param      | Default | Values                                                            | Description               |
| ---------- | ------- | ----------------------------------------------------------------- | ------------------------- |
| `minScore` | `0`     | 0-100                                                             | Minimum opportunity score |
| `type`     | all     | `guest_post`, `resource_page`, `directory`, `forum`, `niche_edit` | Filter by type            |
| `status`   | `new`   | `new`, `contacted`, `replied`, `converted`, `rejected`            | Filter by status          |
| `limit`    | `50`    | 1-500                                                             | Max results               |

**Response example:**

```json
[
  {
    "id": 1,
    "domain": "techblog.com",
    "page_url": "https://techblog.com/write-for-us",
    "opportunity_type": "guest_post",
    "score": 82.3,
    "contact_email": "editor@techblog.com",
    "contact_name": "John Smith",
    "domain_score": 75.3,
    "status": "new",
    "created_at": "2026-03-06T06:00:00.000Z",
    "updated_at": "2026-03-06T06:00:00.000Z"
  }
]
```

### GET `/api/domains`

| Param      | Default | Description             |
| ---------- | ------- | ----------------------- |
| `minScore` | `0`     | Minimum quality score   |
| `limit`    | `50`    | Max results (up to 500) |

### GET `/api/backlinks/:domain`

Returns backlinks pointing to the specified domain.

| Param   | Default | Description              |
| ------- | ------- | ------------------------ |
| `limit` | `100`   | Max results (up to 1000) |

### GET `/api/contacts/:domain`

Returns all discovered contacts for a domain.

### GET `/api/broken-links`

| Param   | Default | Description             |
| ------- | ------- | ----------------------- |
| `limit` | `50`    | Max results (up to 500) |

---

## Health & Monitoring

### GET `/health`

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

`status` is `"ok"` when both services are connected, `"degraded"` otherwise.

### GET `/stats/queues`

Job counts per queue: `active`, `waiting`, `completed`, `failed`, `delayed`.

### GET `/stats/quotas`

Today's API usage per service.

### GET `/stats/pipeline`

Aggregate counts: total domains, backlinks, opportunities (by status), contacts, broken links.

### GET `/stats/metrics`

| Param   | Default | Description                        |
| ------- | ------- | ---------------------------------- |
| `limit` | `50`    | Number of recent metrics (max 200) |

Returns rows from `system_metrics` table ordered by `recorded_at DESC`.
