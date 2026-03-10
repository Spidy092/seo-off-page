require('dotenv').config();
const db = require('./src/db');

async function test() {
    try {
        const res = await db.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1;', ['opportunities']);
        console.log("Columns in opportunities table:");
        console.log(res.rows.map(r => r.column_name).join(', '));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit(0);
    }
}

test();
