const db = require('./src/db');
async function run() {
  const { rows } = await db.query("SELECT domain, opportunity_type, score, competitor_intersect_count, ai_relevance_score, link_intent FROM opportunities WHERE campaign_id = 14;");
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
run();
