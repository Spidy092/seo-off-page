require('dotenv').config();
const { Queue } = require('bullmq');
const config = require('./src/config');
const { startOpportunityClassifierWorker } = require('./src/workers/opportunityClassifierWorker');

async function test() {
    const queue = new Queue('opportunity-classifier', { connection: config.redis });

    // Start the worker locally in this process
    const worker = startOpportunityClassifierWorker({
        queues: { EMAIL_FINDER: { add: async () => console.log('Email finder pinged') } }
    });

    worker.on('failed', (job, err) => {
        console.error(`Job failed with error:`, err);
        process.exit(1);
    });

    worker.on('completed', (job, result) => {
        console.log(`Job completed with result:`, result);
        process.exit(0);
    });

    console.log("Adding job...");
    await queue.add('classify-test', {
        domain: 'example.com',
        pageUrl: 'https://example.com/useful-links',
        campaignId: 1,
        intersectCount: 2
    });
}

test();
