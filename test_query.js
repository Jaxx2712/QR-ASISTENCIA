const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function testQuery() {
    try {
        const result = await db.execute({
            sql: `SELECT COUNT(*) as count FROM (
                    SELECT worker_dni, tipo, 
                            ROW_NUMBER() OVER(PARTITION BY worker_dni ORDER BY timestamp DESC) as rn 
                    FROM attendance 
                    WHERE fecha = '2026-10-09'
                    ) WHERE rn = 1 AND tipo = 'Entrada'`
        });
        console.log(result.rows[0]);
    } catch (err) {
        console.error('Error:', err);
    }
}

testQuery();