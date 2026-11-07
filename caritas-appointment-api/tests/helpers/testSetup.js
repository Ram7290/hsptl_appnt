require('dotenv').config();

const app = require('../../server');
const { getPool, closePool, sql } = require('../../config/db');

/*
 * Shared test context: mounts the app on an ephemeral port (no fixed
 * port, so parallel test runs never collide) and exposes DB helpers.
 *
 * If SQL Server cannot be reached, getPool() throws and the failing
 * beforeAll fails the suite with a clear, truthful reason - tests are
 * never reported as passing when they did not run.
 */

const TEST_SLOT_ID = 101;

let contextPromise = null;

function getTestContext() {
    if (!contextPromise) {
        contextPromise = (async () => {
            const pool = await getPool();
            const server = app.listen(0);
            await new Promise((resolve) => server.once('listening', resolve));
            const baseUrl = `http://127.0.0.1:${server.address().port}`;

            return {
                baseUrl,
                pool,
                sql,
                TEST_SLOT_ID,

                /* Reset the test slot so each test starts from an empty
                 * booking state. TEST-ONLY: destructive to appointments. */
                async resetSlot(slotId = TEST_SLOT_ID) {
                    await new sql.Request(pool)
                        .input('slotId', sql.Int, slotId)
                        .query('DELETE FROM dbo.Appointments WHERE SlotId = @slotId;');
                },

                async getBookingCount(slotId = TEST_SLOT_ID) {
                    const result = await new sql.Request(pool)
                        .input('slotId', sql.Int, slotId)
                        .query(
                            'SELECT COUNT(*) AS BookingCount FROM dbo.Appointments WHERE SlotId = @slotId;'
                        );
                    return result.recordset[0].BookingCount;
                }
            };
        })();
    }
    return contextPromise;
}

async function teardownTestContext() {
    await closePool().catch((err) => {
        console.error('Failed to close SQL Server pool during test teardown:', err.message);
    });
    contextPromise = null;
}

module.exports = { getTestContext, teardownTestContext };
