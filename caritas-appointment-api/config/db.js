require('dotenv').config();

const sql = require('mssql');

/*
 * Reusable SQL Server connection pool.
 *
 * One pool is created lazily and reused for every request. Never create
 * a new ConnectionPool per request - exhausting/opening servers
 * connections per request is slow and can be refused by SQL Server.
 */

const config = {
    server: process.env.DB_SERVER || 'localhost',
    port: parsePort(process.env.DB_PORT),
    database: process.env.DB_DATABASE || 'CaritasHospital',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        // Defaults suit a typical local dev instance. SQL Server Express,
        // LocalDB and Docker images often need different values here -
        // see .env.example and the README's SQL Server setup section.
        encrypt: (process.env.DB_ENCRYPT || 'false') === 'true',
        trustServerCertificate: (process.env.DB_TRUST_CERT || 'true') === 'true'
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

function parsePort(raw) {
    const parsed = parseInt(raw, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1433;
}

let poolPromise = null;

/**
 * Returns a promise that resolves to a shared, connected sql.ConnectionPool.
 * If the initial connection fails, the cached promise is cleared so the
 * next call can retry (e.g. after SQL Server finishes starting).
 */
function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
            poolPromise = null; // allow a later call to retry
            throw err; // let the caller (server startup / request) handle it
        });
    }
    return poolPromise;
}

/** Closes the shared pool (used on process shutdown and by test teardown). */
async function closePool() {
    if (poolPromise === null) {
        return;
    }
    const pool = await poolPromise;
    poolPromise = null;
    await pool.close();
}

module.exports = { sql, getPool, closePool };
