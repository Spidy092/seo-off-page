# Complete Beginner's Guide — A to Z

This guide explains **everything** from scratch. No prior knowledge needed.

---

## Table of Contents

1. [What Problem Does This Solve?](#1-what-problem-does-this-solve)
2. [Key SEO Concepts (Plain English)](#2-key-seo-concepts-plain-english)
3. [What You Need to Give the System](#3-what-you-need-to-give-the-system)
4. [What the System Does (Step by Step)](#4-what-the-system-does-step-by-step)
5. [What You Get at the End](#5-what-you-get-at-the-end)
6. [How to Set Up & Run](#6-how-to-set-up--run)
7. [How to Use the API](#7-how-to-use-the-api)
8. [How to Read the Results](#8-how-to-read-the-results)
9. [Real-World Example Walkthrough](#9-real-world-example-walkthrough)
10. [FAQ](#10-faq)

---

## 1. What Problem Does This Solve?

When you build a website, Google ranks it based on many factors. One of the biggest factors is **backlinks** — other websites linking to yours.

**The Problem:** Finding websites willing to link to you is extremely time-consuming. You have to:
- Google your topic manually
- Visit each competitor website
- Check if the linking websites are good quality
- Find the email address of the website owner
- Reach out to them

**The Solution:** This automation engine does **all of that** automatically. You just give it your website name and a few keywords, and it finds hundreds of link-building opportunities for you while you sleep.

---

## 2. Key SEO Concepts (Plain English)

### What is a "Backlink"?

A backlink is simply a link on someone else's website that points to your website.

```
Example:
  A blog post on techblog.com says:
  "For great SEO tips, visit → yoursite.com"
  
  That arrow (→) is a backlink to yoursite.com.
```

**Why it matters:** Google sees backlinks as "votes of confidence." The more quality websites link to you, the higher Google ranks your site.

### What is a "Target Domain"?

**Your website.** The domain you want to get more backlinks for.

```
Examples of target domains:
  - mycompany.com
  - myblog.in
  - shop.example.org
```

You do NOT include `https://` or `www.` — just the plain domain name.

### What are "Keywords"?

Keywords are the **search terms** that your ideal customers type into Google when looking for your product, service, or content.

```
If you sell handmade candles, your keywords might be:
  - "handmade candles"
  - "scented candles online"
  - "buy artisan candles"

If you run a tech blog, your keywords might be:
  - "best programming tutorials"
  - "learn javascript"
  - "web development tips"
```

**Why keywords matter:** The system searches Google/DuckDuckGo using YOUR keywords to find websites that are ranking well for those topics. Those high-ranking websites are your **competitors**. If someone links to your competitor, they might also link to you.

### What is "Domain Quality"?

Not all websites are equal. A link from `harvard.edu` is worth far more than a link from a random spam blog. The system automatically scores each website from **0 to 100** based on:

| Signal                | What it means                                                     |
| --------------------- | ----------------------------------------------------------------- |
| **PageRank**          | How important the internet thinks this site is (via OpenPageRank) |
| **Tranco Rank**       | Global ranking among the top 1 million websites                   |
| **Domain Age**        | How old the website is (older = more trustworthy)                 |
| **Referring Domains** | How many OTHER sites link to it                                   |

### What is an "Opportunity Type"?

When the system finds a good website, it classifies what kind of link you could get:

| Type              | What it means                                  | Example                                          |
| ----------------- | ---------------------------------------------- | ------------------------------------------------ |
| **Guest Post**    | Website accepts articles from external writers | A blog with a "Write for Us" page                |
| **Resource Page** | A page that lists helpful links                | A "Useful Tools" or "Recommended Resources" page |
| **Directory**     | A listing/directory site                       | A business directory that lists companies        |
| **Forum**         | A discussion forum                             | A community where you can share knowledge        |
| **Niche Edit**    | Existing content where your link could fit     | A blog post that mentions your topic             |

---

## 3. What You Need to Give the System

Just **two things**:

### 1. Your Domain (targetDomain)

Your website's domain name.

```
"targetDomain": "myblog.com"
```

### 2. Your Keywords (keywords)

A list of search terms related to your website. **The more specific, the better.**

```
"keywords": ["handmade candles", "organic soy candles", "buy candles online"]
```

**Tips for choosing keywords:**
- Think about what your customers would search on Google
- Use 3-10 keywords for best results
- Mix broad terms ("candles") with specific ones ("organic soy candles India")
- Don't use single words — use phrases (2-4 words each)

---

## 4. What the System Does (Step by Step)

Once you trigger the pipeline, here is exactly what happens automatically:

```
YOU give: targetDomain + keywords
         │
         ▼
┌─────────────────────────────────────┐
│  STEP 1: Find Competitors           │
│                                     │
│  The system searches Google and     │
│  DuckDuckGo using your keywords.   │
│                                     │
│  It collects the top 10-20 websites │
│  that rank for those keywords.      │
│  These are your competitors.        │
│                                     │
│  Example: You search "seo tools"    │
│  → finds ahrefs.com, moz.com,      │
│    semrush.com, backlinko.com       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  STEP 2: Extract Backlinks          │
│                                     │
│  The system visits each competitor  │
│  website and reads its HTML code.   │
│                                     │
│  It extracts every outbound link    │
│  on their homepage, /resources,     │
│  /links, /partners pages.           │
│                                     │
│  Logic: If competitor X links       │
│  to website Y, then website Y      │
│  might also link to YOU.            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  STEP 3: Score Domain Quality       │
│                                     │
│  For each website found, the system │
│  checks:                            │
│  - How old is the domain?           │
│  - What is its global rank?         │
│  - How authoritative is it?         │
│                                     │
│  It assigns a score from 0 to 100.  │
│  Score > 50 = worth pursuing.       │
│  Score > 80 = high-value target.    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  STEP 4: Classify Opportunity       │
│                                     │
│  The system reads the page content  │
│  and figures out what type of link  │
│  opportunity it is:                 │
│                                     │
│  "Write for us" → Guest Post        │
│  "Useful links"  → Resource Page    │
│  "Submit your site" → Directory     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  STEP 5: Find Contact Email         │
│                                     │
│  For high-scoring opportunities,    │
│  the system hunts for emails:       │
│                                     │
│  1. Scrapes /contact, /about pages  │
│  2. Uses Hunter.io API              │
│  3. Uses Snov.io API                │
│  4. Guesses common patterns like    │
│     info@domain.com, editor@...     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  DONE! Results stored in database.  │
│                                     │
│  You now have a list of:            │
│  - Website name                     │
│  - Quality score (0-100)            │
│  - Opportunity type                 │
│  - Contact email                    │
│  - Page URL to target               │
│                                     │
│  Ready for outreach!                │
└─────────────────────────────────────┘
```

---

## 5. What You Get at the End

After the pipeline completes, your database contains:

| Data                | Description                               |
| ------------------- | ----------------------------------------- |
| **Competitor list** | All websites ranking for your keywords    |
| **Backlink map**    | Who links to whom in your niche           |
| **Quality scores**  | Every domain scored 0-100                 |
| **Opportunities**   | Classified link opportunities with scores |
| **Contact emails**  | Email addresses for outreach              |
| **Broken links**    | 404 links you can offer to replace        |

You can view all of this through the API endpoints (see Section 7 below).

---

## 6. How to Set Up & Run

### Prerequisites

| Software        | Purpose              | Install                       |
| --------------- | -------------------- | ----------------------------- |
| **Node.js 18+** | Runs the application | `sudo apt install nodejs npm` |
| **PostgreSQL**  | Stores all data      | `sudo apt install postgresql` |
| **Docker**      | Runs Redis container | Already installed             |

### Step-by-Step Setup

```bash
# 1. Go to the project folder
cd /home/sr-user91/Videos/back-link-automation

# 2. Start Redis (runs as a Docker container)
docker compose up -d

# 3. Create the PostgreSQL database (one-time setup)
sudo -u postgres psql
# Inside PostgreSQL prompt, run:
#   CREATE USER seo_user WITH PASSWORD '1234';
#   CREATE DATABASE seo_automation OWNER seo_user;
#   GRANT ALL ON SCHEMA public TO seo_user;
#   \q

# 4. Install Node.js dependencies (one-time)
npm install

# 5. Start the engine
npm run dev
```

When you see this output, the engine is ready:

```
✅ Database initialized (7 tables, 10 indexes)
✅ Redis connected
✅ Rate limiter initialized
✅ Queues initialized
✅ Workers started (count: 6)
🚀 Server listening on http://0.0.0.0:3000
```

### Adding API Keys (Optional but Recommended)

Edit the `.env` file in the project root. Add your free API keys:

| Service      | Free Tier            | Sign Up                             |
| ------------ | -------------------- | ----------------------------------- |
| Serper.dev   | 2,500 searches/month | https://serper.dev                  |
| Hunter.io    | 25 lookups/month     | https://hunter.io                   |
| Snov.io      | 50 lookups/month     | https://snov.io                     |
| OpenPageRank | 10M lookups/month    | https://www.domcop.com/openpagerank |

**If you don't add API keys**, the system still works! It falls back to free scraping methods (DuckDuckGo HTML scraping, page scraping for emails, etc.).

---

## 7. How to Use the API

The engine runs as a web server on `http://localhost:3000`. You interact with it using `curl` commands in your terminal.

### Start a Pipeline (Main Command)

Open a **new terminal** (keep the engine terminal running) and run:

```bash
curl -X POST http://localhost:3000/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{
    "targetDomain": "myblog.com",
    "keywords": ["web development tips", "learn javascript", "coding tutorials"]
  }'
```

**Replace:**
- `myblog.com` → with YOUR website domain
- The keywords → with YOUR target keywords

**Response:**
```json
{
  "message": "Pipeline started",
  "targetDomain": "myblog.com",
  "keywords": ["web development tips", "learn javascript", "coding tutorials"],
  "jobId": "competitor:myblog.com:1709712000000"
}
```

### Monitor Progress

Open these URLs in your **web browser**:

| URL                                  | What it shows                                 |
| ------------------------------------ | --------------------------------------------- |
| http://localhost:3000/health         | Is the system running?                        |
| http://localhost:3000/stats/queues   | How many jobs are active/waiting/completed    |
| http://localhost:3000/stats/pipeline | Total domains, backlinks, opportunities found |

### View Results

| URL                                                     | What it shows                                      |
| ------------------------------------------------------- | -------------------------------------------------- |
| http://localhost:3000/api/opportunities                 | Best link-building opportunities found             |
| http://localhost:3000/api/opportunities?minScore=50     | Only high-quality opportunities (score ≥ 50)       |
| http://localhost:3000/api/opportunities?type=guest_post | Only guest post opportunities                      |
| http://localhost:3000/api/domains?minScore=60           | High-quality domains discovered                    |
| http://localhost:3000/api/contacts/example.com          | Contact emails for a specific domain               |
| http://localhost:3000/api/broken-links                  | Broken links found (404 replacement opportunities) |

---

## 8. How to Read the Results

### Opportunity Result Example

When you visit `http://localhost:3000/api/opportunities`, you get:

```json
{
  "domain": "techblog.com",
  "page_url": "https://techblog.com/write-for-us",
  "opportunity_type": "guest_post",
  "score": 82.3,
  "contact_email": "editor@techblog.com",
  "status": "new"
}
```

**How to read this:**

| Field              | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `domain`           | The website you should reach out to                             |
| `page_url`         | The specific page where your link could go                      |
| `opportunity_type` | What kind of link opportunity (guest_post, resource_page, etc.) |
| `score`            | Quality score (0-100). Higher = better. Aim for 50+             |
| `contact_email`    | Who to email for outreach                                       |
| `status`           | `new` = not yet contacted                                       |

### Score Guide

| Score Range | Quality   | Action                                |
| ----------- | --------- | ------------------------------------- |
| **80-100**  | Excellent | Contact immediately — high-value link |
| **60-79**   | Good      | Worth pursuing                        |
| **40-59**   | Average   | Contact if you have time              |
| **0-39**    | Low       | Skip — not worth the effort           |

---

## 9. Real-World Example Walkthrough

Let's say you run a cooking blog at `tastyfood.com` and want more traffic from Google.

### Step 1: Choose Your Keywords

Think: "What would my readers search on Google?"

```
Keywords:
  - "easy dinner recipes"
  - "healthy meal prep"
  - "cooking tips for beginners"
```

### Step 2: Start the Pipeline

```bash
curl -X POST http://localhost:3000/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{
    "targetDomain": "tastyfood.com",
    "keywords": ["easy dinner recipes", "healthy meal prep", "cooking tips for beginners"]
  }'
```

### Step 3: Wait (5-30 minutes)

The system is now automatically:
1. Searching Google for "easy dinner recipes" → finding competitors like allrecipes.com, budgetbytes.com
2. Visiting those competitor sites → extracting all their outbound links
3. Checking each linked domain's quality → scoring them 0-100
4. Reading page content → classifying as guest post / resource page
5. Hunting for contact emails → scraping /contact pages

### Step 4: Check Results

Visit: `http://localhost:3000/api/opportunities?minScore=50`

You might see results like:

```
domain: "foodbloggerpro.com"
page_url: "https://foodbloggerpro.com/write-for-us"
type: "guest_post"
score: 78
email: "submissions@foodbloggerpro.com"

domain: "cookingresources.org"
page_url: "https://cookingresources.org/recommended-blogs"
type: "resource_page"
score: 65
email: "info@cookingresources.org"
```

### Step 5: Outreach (Manual Step)

Now you email `submissions@foodbloggerpro.com` and say:

> "Hi, I run tastyfood.com and I'd love to write a guest post for your blog about healthy meal prep tips. Here are some topic ideas..."

If they accept, you get a valuable backlink from a high-quality food blog → Google ranks your site higher → more traffic!

---

## 10. FAQ

### Q: How long does the pipeline take to complete?
**A:** Typically 5-30 minutes depending on how many keywords you use and how many competitors are found. The system processes everything in the background — you don't need to wait.

### Q: Can I run the pipeline for multiple domains?
**A:** Yes! Just send separate `curl` commands for each domain. They will run in parallel.

### Q: What if I don't have any API keys?
**A:** The system works without API keys. It uses DuckDuckGo HTML scraping for search results and page scraping for emails. API keys just make it faster and more accurate.

### Q: How often should I run the pipeline?
**A:** Run it once a week or once a month for the same keywords. The system tracks what it has already discovered, so repeat runs will find NEW opportunities.

### Q: What does "targetDomain" actually do?
**A:** It's used to **exclude** your own website from the competitor list. When the system searches Google for your keywords, it filters out YOUR domain so it only collects your competitors.

### Q: Can I stop the pipeline mid-way?
**A:** Yes. Just stop the Node.js process (`Ctrl+C` in the terminal). All progress is saved in the database. When you restart, the queue will resume processing.

### Q: Where is all the data stored?
**A:** In your local PostgreSQL database called `seo_automation`. The data persists even if you restart the application.

### Q: What is the `/health` endpoint for?
**A:** It tells you if the system is running properly. Visit `http://localhost:3000/health` — if it says `"status": "ok"`, everything is connected.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────┐
│              SEO AUTOMATION CHEAT SHEET              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  START REDIS:    docker compose up -d               │
│  START ENGINE:   npm run dev                        │
│  START PIPELINE: curl -X POST                       │
│                  http://localhost:3000/api/          │
│                  pipeline/start                     │
│                  -H "Content-Type: application/json"│
│                  -d '{"targetDomain":"YOURDOMAIN",  │
│                       "keywords":["kw1","kw2"]}'    │
│                                                     │
│  CHECK HEALTH:   http://localhost:3000/health       │
│  CHECK QUEUES:   http://localhost:3000/stats/queues  │
│  SEE RESULTS:    http://localhost:3000/api/          │
│                  opportunities?minScore=50           │
│                                                     │
│  STOP ENGINE:    Ctrl+C in terminal                 │
│  STOP REDIS:     docker compose down                │
└─────────────────────────────────────────────────────┘
```
