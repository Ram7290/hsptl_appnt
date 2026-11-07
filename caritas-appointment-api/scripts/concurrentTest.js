require('dotenv').config();

const { sql, getPool, closePool } = require('../config/db');

/*
 * Standalone concurrency test for Caritas Hospital.
 *
 * Sends N HTTP booking requests for the same slot with different
 * existing patient IDs, all fired simultaneously (Promise.all, no
 * sequential await), then verifies the HTTP distribution and the
 * database state.
 *
 * Usage:
 *     node scripts/concurrentTest.js [slotId] [requestCount]
 *     node scripts/concurrentTest.js          -> slot 101, 2 requests
 *     node scripts/concurrentTest.js 101 5    -> 5 requests
 *     node scripts/concurrentTest.js 101 10   -> 10 requests
 *
 * npm run convenience scripts:
 *     npm run concurrency:2 / concurrency:5 / concurrency:10
 *
 * Requires the server to be running (npm start) and SQL Server up.
 *
 * TEST-ONLY: this script DELETES existing appointments for the target
 * slot first, so the run always starts from an available slot. Never
 * run it against production data.
 */

const SLOT_ON_SERVER_START = 101;
const PATIENT_IDS = [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010];

async function main() {
    const slotId = parsePositiveInt(process.argv[2], SLOT_ON_SERVER_START);
    const requestCount = Math.min(
        Math.max(parsePositiveInt(process.argv[3], 2), 2),
        PATIENT_IDS.length // only ten seeded patients exist
    );
    const baseUrl = (process.env.API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
    const patientIds = PATIENT_IDS.slice(0, requestCount);

    console.log(`Concurrency test: ${requestCount} simultaneous requests for slot ${slotId} -> ${baseUrl}/api/appointments/book`);

    let pool;
    try {
        pool = await getPool();
    } catch (err) {
        console.error('FAIL: could not connect to SQL Server: ' + err.message);
        process.exitCode = 1;
        return;
    }

    // Verify the server is reachable before resetting anything.
    try {
        const health = await fetch(`${baseUrl}/`);
        if (!health.ok) {
            throw new Error(`health endpoint returned HTTP ${health.status}`);
        }
    } catch (err) {
        console.error(`FAIL: server not reachable at ${baseUrl} (${err.message}). Start it first: npm start`);
        process.exitCode = 1;
        return;
    }

    // TEST-ONLY destructive reset with a visible warning.
    console.log(`WARN: test-only reset - deleting existing appointments for slot ${slotId}.`);
    await new sql.Request(pool)
        .input('slotId', sql.Int, slotId)
        .query('DELETE FROM dbo.Appointments WHERE SlotId = @slotId;');

    // Fire all requests genuinely simultaneously: the map starts every
    // fetch immediately, Promise.all waits for all of them together.
    const results = await Promise.all(
        patientIds.map((patientId) =>
            fetch(`${baseUrl}/api/appointments/book`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slotId, patientId })
            })
                .then(async (res) => ({ patientId, status: res.status, body: await res.json().catch(() => ({})) }))
                .catch((err) => ({ patientId, status: 0, body: { message: err.message } }))
        )
    );

    // Readable summary
    console.log('\nPer-request results:');
    for (const r of results) {
        const message = r.body && r.body.message ? `"${r.body.message}"` : '(no body)';
        console.log(`  patient ${r.patientId}: HTTP ${r.status}  ${message}`);
    }

    const successCount = results.filter((r) => r.status === 201).length;
    const conflictCount = results.filter((r) => r.status === 409).length;
    const otherCount = results.length - successCount - conflictCount;

    console.log('\nHTTP summary:');
    console.log(`  201 Created: ${successCount}`);
    console.log(`  409 Conflict: ${conflictCount}`);
    console.log(`  other/unexpected: ${otherCount}`);

    // Database verification
    let dbOk = false;
    let slotCountText = 'not checked';
    try {
        const slotCount = await new sql.Request(pool)
            .input('slotId', sql.Int, slotId)
            .query(
                'SELECT COUNT(*) AS BookingCount FROM dbo.Appointments WHERE SlotId = @slotId;'
            );
        const bookingCount = slotCount.recordset[0].BookingCount;
        slotCountText = `${bookingCount}`;

        const duplicates = await pool
            .request()
            .query(
                'SELECT SlotId, COUNT(*) AS BookingCount FROM dbo.Appointments GROUP BY SlotId HAVING COUNT(*) > 1;'
            );

        dbOk = bookingCount === 1 && duplicates.recordset.length === 0;
        console.log('\nDatabase verification:');
        console.log(`  Appointment rows for slot ${slotId}: ${bookingCount} (expected 1)`);
        console.log(`  Slots with more than one appointment anywhere: ${duplicates.recordset.length} (expected 0)`);
    } catch (err) {
        console.error('\nDatabase verification failed:', err.message);
    }

    closePool().catch(() => {});

    // Verdict with non-zero exit code on failure
    const httpOk = successCount === 1 && conflictCount === results.length - 1 && otherCount === 0;
    if (httpOk && dbOk) {
        console.log(`\nPASSED: exactly 1 x 201, ${results.length - 1} x 409, and exactly one appointment row in the database.`);
        process.exitCode = 0;
    } else {
        console.log('\nFAILED: check HTTP summary and database state above.');
        process.exitCode = 1;
    }
}

function parsePositiveInt(raw, fallback) {
    const parsed = parseInt(raw, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main();
