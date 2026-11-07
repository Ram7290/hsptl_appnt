# Caritas Hospital — Concurrent Appointment Booking API

A Node.js + Express REST service backed by SQL Server that lets exactly
one patient book a hospital appointment slot, even when multiple
requests arrive at the same moment.

## 1. Purpose

Demonstrates correct concurrent booking of a single appointment slot
using SQL Server pessimistic locking (`UPDLOCK`, `HOLDLOCK`) inside an
explicit transaction, backed by a database-level unique constraint.

## 2. Assessment problem summary

One endpoint:

```http
POST /api/appointments/book
Content-Type: application/json

{ "slotId": 101, "patientId": 5001 }
```

If two requests for the same available slot arrive simultaneously
(patients 5001 and 5002), **exactly one** must return `201 Created`,
the other `409 Conflict`, and **exactly one** appointment row must exist
for that slot in the database — no duplicates, ever.

## 3. Technology stack

| Technology | Use |
|---|---|
| Node.js (>= 18 LTS, built for current LTS releases) | Backend runtime — tests rely on the global `fetch` |
| Express.js | REST API |
| Microsoft SQL Server | Database |
| `mssql` | SQL Server driver / connection pool / transactions |
| `dotenv` | Environment configuration |
| `nodemon` | Development auto-restart |
| Jest | Functional automated tests |
| Node built-in `fetch` | Concurrent HTTP test client |
| SSMS | Optional database administration / manual verification |

## 4. Prerequisites

- Node.js 18 or newer (global `fetch` required by the concurrency script)
- A reachable SQL Server instance — the default config assumes SQL
  Server authentication (user + password) on `localhost:1433`.
  SQL Server Express, LocalDB, a Docker SQL Server or a remote instance
  may need different server names, ports or protocols — SQL Server
  authentication with the TCP port must match *your* local setup.
  (Windows Authentication is supported by the `mssql` driver via
  `user`/`password` omitted plus the appropriate configuration, but this
  project uses explicit SQL credentials out of the box — see
  [.env.example](.env.example).)
- Permission to run the setup script, which creates the `CaritasHospital`
  database

## 5. Project folder structure

```
caritas-appointment-api/
├── config/
│   └── db.js                          # reusable SQL Server connection pool
├── controllers/
│   └── appointmentController.js       # booking logic + transaction
├── routes/
│   └── appointmentRoutes.js           # POST /book route definition
├── scripts/
│   ├── database.sql                   # DB + tables + sample data
│   ├── concurrentTest.js              # concurrent HTTP test client
│   └── rollbackTest.md                # rollback test instructions
├── tests/
│   ├── booking.test.js                # functional tests F01-F10
│   └── helpers/
│       └── testSetup.js               # ephemeral-port app + DB helpers
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js
```

## 6. Installation

```bash
cd caritas-appointment-api
npm install
cp .env.example .env   # then edit .env
```

## 7. SQL Server setup

Run `scripts/database.sql` in SSMS, or with `sqlcmd`:

```bash
sqlcmd -S localhost -U sa -P <password> -i scripts/database.sql
```

The script:

1. Creates the `CaritasHospital` database if it does not exist.
2. Creates the four tables (`Doctors`, `Patients`, `AppointmentSlots`,
   `Appointments`) with primary keys and foreign keys.
3. Adds `CONSTRAINT UQ_Appointments_SlotId UNIQUE (SlotId)` on
   `Appointments` — one appointment row per slot, enforced by the
   database itself.
4. Seeds 2 doctors (Dr. John `1`, Dr. David `2`), 10 patients
   (`5001`–`5010`) and 5 slots (`101`, `102`, `103`, `104`, `105`) with
   **fixed** sample dates (10 Nov 2026). The booking API performs no
   date comparison, so availability depends only on whether an
   appointment row exists for the slot.
5. Displays the inserted sample data.

**Resetting a test slot (local testing only):**

```sql
DELETE FROM dbo.Appointments WHERE SlotId = 101;
```

> Never run delete/reset statements against production data.

## 8. Environment configuration

Copy `.env.example` to `.env` and set your real values — do **not**
commit `.env`. The settings must match your SQL Server configuration:

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 5000) |
| `DB_USER`, `DB_PASSWORD` | SQL Server login (SQL authentication) |
| `DB_SERVER` | Host — `localhost`, `localhost\SQLEXPRESS`, a Docker name, etc. |
| `DB_DATABASE` | `CaritasHospital` |
| `DB_PORT` | TCP port, usually `1433` (TCP/IP must be enabled on the server) |
| `DB_ENCRYPT` | `true` encrypts the connection; local dev commonly `false` |
| `DB_TRUST_CERT` | `true` accepts self-signed certificates |

## 9. How to start the server

```bash
npm start          # production-style start
npm run dev        # nodemon auto-restart
```

The server connects to SQL Server **first** and only listens after the
connection succeeds. If the connection fails you get a startup error and
the process exits non-zero — no half-ready server.

## 10. API endpoint

`POST /api/appointments/book`

```json
{ "slotId": 101, "patientId": 5001 }
```

`GET /` is a simple health check.

## 11. Example responses

Success (`201`):

```json
{
  "success": true,
  "message": "Appointment booked successfully",
  "data": {
    "AppointmentId": 1,
    "SlotId": 101,
    "PatientId": 5001,
    "BookedAt": "2026-11-07T12:34:56.789Z"
  }
}
```

`BookedAt` is generated by SQL Server (`DATETIME2`, default
`SYSDATETIME()`), never by the application.

Conflict (`409`):

```json
{ "success": false, "message": "This appointment slot is already booked" }
```

| Scenario | Status | Message |
|---|---|---|
| Booking succeeds | 201 | Appointment booked successfully |
| Slot already booked | 409 | This appointment slot is already booked |
| Slot not found | 404 | Appointment slot not found |
| Patient not found | 404 | Patient not found |
| Missing/invalid IDs (string, zero, negative, non-integer) | 400 | Valid positive integer slotId and patientId are required |
| Malformed JSON | 400 | Invalid JSON request body |
| Unexpected server/database error | 500 | An unexpected server error occurred. Please try again later. |

## 12. Transaction handling

`bookAppointment` in [controllers/appointmentController.js](controllers/appointmentController.js):

1. Validates `slotId`/`patientId` **before** touching the database
   (`Number.isSafeInteger`, positive — rejects strings, floats, zero,
   negatives and unsafe integers).
2. Gets a connection from the shared pool.
3. `BEGIN TRANSACTION` (one `mssql` transaction for *all* booking work).
4. Locks the slot row (see §13–14). Not found → rollback + `404`.
5. Checks the patient exists → rollback + `404` if not.
6. Checks no appointment row exists for the slot → rollback + `409` if
   one does.
7. Inserts the appointment (parameterized, `OUTPUT` the new row).
8. `COMMIT`; only then returns `201`.
9. On any failure: rolls back (if still active), logs the real error
   server-side, and returns a client-safe message.

Duplicate-key SQL errors (`2601`, `2627`) are additionally mapped to
`409` — an independent safety net if the lock ever failed to serialize
two requests. The transaction lifecycle is careful about its own flags:
an explicit rollback-when-active check avoids double rollback, and a
failed rollback is logged, never swallowed.

## 13. UPDLOCK

The slot lookup:

```sql
SELECT SlotId
FROM dbo.AppointmentSlots WITH (UPDLOCK, HOLDLOCK)
WHERE SlotId = @slotId;
```

`UPDLOCK` takes an **update lock** while reading. It sits between a
shared read lock and an exclusive write lock, so two concurrent
transactions **cannot both acquire incompatible update locks on the same
slot row**: when request A holds it, request B blocks until A commits or
rolls back. This converts the read-modify-write of booking into a
serialized critical section *without* upgrading an entire transaction to
exclusive locks. `UPDLOCK` alone does not stop every conceivable
duplicate insert — that is why the unique constraint (§15) is mandatory.

## 14. HOLDLOCK

`HOLDLOCK` applies **serializable** semantics to that table reference for
the transaction's duration: the lock is held until commit/rollback, and
with the indexed `SlotId` predicate SQL Server can protect the matching
key or its key range, so a slot cannot appear or disappear under us
while we hold it.

The choice documented here is `READ_COMMITTED` (default) isolation with
explicit `UPDLOCK, HOLDLOCK` on the protected lookup. There is no
`NOLOCK` anywhere and the availability check is never done outside the
transaction.

## 15. The unique constraint

```sql
CONSTRAINT UQ_Appointments_SlotId UNIQUE (SlotId)
```

This is the **final guarantee**: even if application logic failed, SQL
Server would physically refuse a second appointment row for the same
slot. It also backs the `2601/2627 → 409` mapping. Note this schema
allows one appointment per slot for the slot's lifetime; cancellation
would need a different design (e.g. an active-booking status with a
filtered unique index) — see §21.

## 16. How concurrent requests are handled

Timeline for two simultaneous requests (slot 101, patients 5001, 5002):

1. Both validate and begin transactions.
2. A runs the locked slot `SELECT` first and holds the update lock.
3. B blocks on that same `SELECT`.
4. A's checks pass, the insert succeeds, A commits → `201`.
5. B's `SELECT` now unblocks on A's *committed* snapshot of the lock:
   B's `Appointments` check finds the row → rollback → `409`.

Exactly one winner, determined purely by which transaction acquires the
lock first — never by which patient. The unique constraint catches any
path the lock could miss. The blocking transaction does hold a small
open transaction for its duration; the pool (`max: 10`) comfortably
absorbs the burst of ten concurrent tests.

## 17. Running functional tests

```bash
npm test
```

Runs the F01–F10 cases in [tests/booking.test.js](tests/booking.test.js)
against the real database (a local **test** database — the suite resets
slot 101 between cases). Requires a valid `.env` with a reachable SQL
Server; if the database is unreachable the suite **fails** with the
connection error rather than pretending to pass.

## 18. Running the concurrency tests

Start the server first (`npm start`) in another terminal, then:

```bash
npm run concurrency:2     # 2 requests  -> expect 1 x 201, 1 x 409
npm run concurrency:5     # 5 requests  -> expect 1 x 201, 4 x 409
npm run concurrency:10    # 10 requests -> expect 1 x 201, 9 x 409
```

Or with custom slot/count: `node scripts/concurrentTest.js 102 5`.

[scripts/concurrentTest.js](scripts/concurrentTest.js) fires all
requests **simultaneously** with `Promise.all` (no sequential await),
uses a different existing patient ID per request, prints a summary, and
exits non-zero on any failure.

> WARNING: the script deletes existing appointments for the target slot
> first (test-only). Never point it at production data.

## 19. Verifying the database result

After each run:

```sql
SELECT SlotId, COUNT(*) AS BookingCount
FROM dbo.Appointments WHERE SlotId = 101 GROUP BY SlotId;
-- expected: one row, BookingCount = 1

SELECT SlotId, COUNT(*) AS BookingCount
FROM dbo.Appointments GROUP BY SlotId HAVING COUNT(*) > 1;
-- expected: zero rows
```

`scripts/concurrentTest.js` also performs both checks automatically.

## 20. Performing the rollback test

Full step-by-step instructions (including the temporary failing trigger)
are in [scripts/rollbackTest.md](scripts/rollbackTest.md). Summary: add
`TR_Test_FailAppointmentInsert` (AFTER INSERT `THROW`), attempt a
booking, expect `500` + zero rows persisted, drop the trigger
immediately.

## 21. Limitations and possible future improvements

- **Cancellation/rescheduling** are out of scope; the unique-per-slot
  schema would need redesign (active-status + filtered unique index) to
  support re-booking history.
- **No authentication**: a real system must derive the patient identity
  from an authenticated session, not from a client-supplied `patientId`.
- **Deadlocks (`1205`)** are possible transient failures under
  serialized access patterns. A bounded, idempotent-keyed retry is a
  safe future addition; none is implemented, and retries are never
  applied blindly to uncertain outcomes (e.g. after a connection drop
  during commit).
- No rate limiting, logging pipeline, or horizontal scaling readiness
  (a single SQL Server serializes the slot lock; that is the intended
  design here).
- Possible extensions: doctors/slots management APIs, waitlists, and
  calendar views — deliberately not implemented here.

## Honest test status

See `TEST-RESULTS.md` (if present) or the accompanying description of
which tests were actually executed in the coding environment and which
must be run locally.
