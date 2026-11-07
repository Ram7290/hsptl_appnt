const { getTestContext, teardownTestContext } = require('./helpers/testSetup');

/*
 * Functional tests for POST /api/appointments/book (spec cases F01-F10).
 *
 * Requires a reachable SQL Server configured through .env (copy
 * .env.example). If the connection fails, the beforeAll fails loudly and
 * the suite is reported as FAILED, not as skipped-passing.
 *
 * These tests run against the real database and reset slot 101 between
 * cases. Run only against a local TEST database.
 *
 * Run with:  npm test
 */

afterAll(() => teardownTestContext());

describe('POST /api/appointments/book', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await getTestContext();
    });

    beforeEach(async () => {
        await ctx.resetSlot();
    });

    function book(body) {
        return fetch(`${ctx.baseUrl}/api/appointments/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    test('F01: books an available slot for an existing patient (201)', async () => {
        const res = await book({ slotId: ctx.TEST_SLOT_ID, patientId: 5001 });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.message).toBe('Appointment booked successfully');
        expect(body.data.SlotId).toBe(ctx.TEST_SLOT_ID);
        expect(body.data.PatientId).toBe(5001);
        expect(body.data.AppointmentId).toBeGreaterThan(0);
        // BookedAt comes from SQL Server (DATETIME2 default), not from us
        expect(new Date(body.data.BookedAt).toString()).not.toBe('Invalid Date');
    });

    test('F02: booking the same slot again with another patient returns 409', async () => {
        const first = await book({ slotId: ctx.TEST_SLOT_ID, patientId: 5001 });
        expect(first.status).toBe(201);

        const second = await book({ slotId: ctx.TEST_SLOT_ID, patientId: 5002 });
        expect(second.status).toBe(409);
        const body = await second.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('This appointment slot is already booked');
    });

    test('F03: booking a nonexistent slot returns 404', async () => {
        const res = await book({ slotId: 999999, patientId: 5001 });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Appointment slot not found');
    });

    test('F04: nonexistent patient with an existing slot returns 404', async () => {
        const res = await book({ slotId: ctx.TEST_SLOT_ID, patientId: 999999 });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Patient not found');
    });

    test('F05: omitted slotId returns 400', async () => {
        const res = await book({ patientId: 5001 });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Valid positive integer slotId and patientId are required');
    });

    test('F06: omitted patientId returns 400', async () => {
        const res = await book({ slotId: ctx.TEST_SLOT_ID });

        expect(res.status).toBe(400);
    });

    test('F07: string slotId returns 400 (no coercion)', async () => {
        const res = await book({ slotId: '101', patientId: 5001 });

        expect(res.status).toBe(400);
    });

    test('F08: zero and negative IDs return 400', async () => {
        const zeroSlot = await book({ slotId: 0, patientId: 5001 });
        expect(zeroSlot.status).toBe(400);

        const negativeSlot = await book({ slotId: -101, patientId: 5001 });
        expect(negativeSlot.status).toBe(400);

        const negativePatient = await book({ slotId: ctx.TEST_SLOT_ID, patientId: -5001 });
        expect(negativePatient.status).toBe(400);
    });

    test('F09: malformed JSON returns 400', async () => {
        const res = await fetch(`${ctx.baseUrl}/api/appointments/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{ slotId: 101, broken'
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Invalid JSON request body');
    });

    test('F10: a successful booking is persisted as exactly one row', async () => {
        const res = await book({ slotId: ctx.TEST_SLOT_ID, patientId: 5001 });
        expect(res.status).toBe(201);

        const count = await ctx.getBookingCount(ctx.TEST_SLOT_ID);
        expect(count).toBe(1);

        // Booking failed rollback paths must not leak partial rows either
        await ctx.resetSlot();
    });
});
