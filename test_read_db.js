require('dotenv').config();
const db = require('./src/db');

async function check() {
    try {
        const res = await db.query('SELECT * FROM opportunities ORDER BY id DESC LIMIT 5');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
check();
