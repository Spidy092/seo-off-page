# A-Z Pipeline Testing Architecture

## Objective
Run and verify the complete SEO Back-link Automation pipeline from A to Z to guarantee all inter-dependent services, agents, and API integrations are communicating correctly in a production-like sequence.

## Approach: 3-Agent Orchestration 

1. **`test-engineer` (Test Environment Setup & Seeding)**
   - Clear existing Redis queues temporarily or create a dedicated testing namespace to prevent overlap.
   - Seed a new "Test Campaign" with a target domain (e.g., `test.com`) and target keywords.
   - Monitor the BullMQ queues to ensure the initial `competitor-discovery` job is successfully dispatched.

2. **`backend-specialist` (Worker Execution & Tracing)**
   - Trace the execution flow sequentially across all 6 core workers:
     1. **Competitor Worker:** Ensure competitors are discovered via Serper.
     2. **Backlink Worker:** Verify the system crawls discovered competitors for backlinks.
     3. **Domain Analyzer Worker:** Check readability and content scraping on backlink sources.
     4. **Opportunity Classifier Worker:** Ensure the AI provider accurately classifies intent.
     5. **Broken Link Worker:** Verify HTTP status checking logic for dead links.
     6. **Email Finder Worker:** Validate contact parsing via Hunter/Snov APIs fallback.
   - Check API rate limiters to ensure quota handling works correctly across the whole pipeline.

3. **`database-architect` (Data Integrity & Output Verification)**
   - Query the PostgreSQL database to verify that the final outputs are structured correctly.
   - Assert that:
     - `campaigns` table reflects the active test run.
     - `competitors` were saved.
     - `backlinks` were inserted.
     - `opportunities` are populated with AI analysis.

## Verification Checklist

- [ ] All 6 BullMQ worker queues drain successfully with 0 failed jobs.
- [ ] No HTTP 400/429 errors from Serper, DDG, or Google CSE.
- [ ] The Postgres DB contains correctly linked relational data from the start of the campaign down to the final emails.
- [ ] Scripts executed: `python .agent/skills/vulnerability-scanner/scripts/security_scan.py .`

## Sign-off
Upon user approval, the three agents will execute their phases in parallel to test and report back the system's viability.
