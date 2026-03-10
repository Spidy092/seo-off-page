/**
 * Validates all URLs in curated seed lists and removes dead ones.
 * Run: node scripts/validate_seed_lists.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const TIMEOUT = 8000;
const CONCURRENCY = 10;

async function checkUrl(url) {
    try {
        const resp = await axios.head(url, {
            timeout: TIMEOUT,
            maxRedirects: 3,
            validateStatus: (s) => s < 500,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
        });
        return { alive: resp.status < 400, status: resp.status };
    } catch (err) {
        // HEAD might be blocked, try GET
        try {
            const resp = await axios.get(url, {
                timeout: TIMEOUT,
                maxRedirects: 3,
                validateStatus: (s) => s < 500,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
                responseType: 'text',
                maxContentLength: 50000,
            });
            return { alive: resp.status < 400, status: resp.status };
        } catch (err2) {
            return { alive: false, status: err2.code || err2.message };
        }
    }
}

async function processInBatches(items, fn, concurrency) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
        if (i + concurrency < items.length) {
            process.stdout.write(`  Progress: ${Math.min(i + concurrency, items.length)}/${items.length}\r`);
        }
    }
    return results;
}

async function validateAndClean(filename) {
    const filePath = path.join(DATA_DIR, filename);
    const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    console.log(`\n🔍 Validating ${filename} (${entries.length} entries)...`);

    const results = await processInBatches(entries, async (entry) => {
        const result = await checkUrl(entry.url);
        if (!result.alive) {
            console.log(`  ❌ DEAD: ${entry.name} (${entry.url}) → ${result.status}`);
        }
        return { entry, ...result };
    }, CONCURRENCY);

    const alive = results.filter(r => r.alive).map(r => r.entry);
    const dead = results.filter(r => !r.alive);

    console.log(`\n  ✅ Alive: ${alive.length}/${entries.length}`);
    console.log(`  ❌ Dead:  ${dead.length}/${entries.length}`);

    // Write cleaned file
    fs.writeFileSync(filePath, JSON.stringify(alive, null, 2) + '\n');
    console.log(`  💾 Saved cleaned ${filename} (${alive.length} entries)`);

    return { filename, total: entries.length, alive: alive.length, dead: dead.length };
}

async function main() {
    console.log('=== Seed List URL Validator ===\n');

    const r1 = await validateAndClean('directories.json');
    const r2 = await validateAndClean('bookmarking.json');

    console.log('\n=== Summary ===');
    console.log(`directories.json: ${r1.alive}/${r1.total} alive (removed ${r1.dead} dead)`);
    console.log(`bookmarking.json: ${r2.alive}/${r2.total} alive (removed ${r2.dead} dead)`);
}

main().catch(err => { console.error(err); process.exit(1); });
