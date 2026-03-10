require('dotenv').config();
const { createQueue } = require('./src/queue');
const { startDirectoryFinderWorker } = require('./src/workers/directoryFinderWorker');

async function test() {
    console.log('=== Testing Directory Finder Worker ===');
    console.log('Mode:', process.env.DIRECTORY_DISCOVERY_MODE || 'hybrid');

    const queue = createQueue('directory-finder');
    const worker = startDirectoryFinderWorker({ rateLimiter: null, queues: {} });

    // Listen for completion
    worker.on('completed', async (job, result) => {
        console.log('\n✅ Job completed!');
        console.log('Result:', JSON.stringify(result, null, 2));

        // Check what was inserted
        const db = require('./src/db');
        const { rows } = await db.query(
            `SELECT opportunity_type, COUNT(*) as count 
             FROM opportunities 
             WHERE campaign_id = $1 AND opportunity_type IN ('directory', 'social_bookmarking')
             GROUP BY opportunity_type`,
            [1]
        );
        console.log('\nOpportunities by type:', rows);

        const { rows: samples } = await db.query(
            `SELECT domain, page_url, opportunity_type, score, notes 
             FROM opportunities 
             WHERE campaign_id = $1 AND opportunity_type IN ('directory', 'social_bookmarking')
             ORDER BY score DESC LIMIT 5`,
            [1]
        );
        console.log('\nTop 5 samples:', JSON.stringify(samples, null, 2));

        await worker.close();
        await queue.close();
        process.exit(0);
    });

    worker.on('failed', async (job, err) => {
        console.error('❌ Job failed:', err.message);
        await worker.close();
        await queue.close();
        process.exit(1);
    });

    // Add test job
    console.log('Adding job...');
    await queue.add(
        'discover-directories',
        { campaignId: 1, keywords: ['seo tools'] },
        { jobId: `test-dirfind-${Date.now()}` }
    );
    console.log('Job added, waiting for completion...\n');
}

test().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
