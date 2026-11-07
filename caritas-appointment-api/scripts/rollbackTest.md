# Rollback test: proving a failed insert leaves no partial booking

Concurrency safety has two halves: (1) two concurrent bookings must not
both succeed, and (2) when a booking fails mid-transaction, **nothing**
must be committed — no orphan rows, no partial state. This test
demonstrates (2).

> **Important:** everything in this document is for a **local test
> database only**. The throw-away trigger below makes all appointment
> inserts fail; never run any part of this against production data, and
> always drop the trigger immediately after the test.

## What is being proven

The controller performs slot lock → checks → insert → commit inside one
transaction. If the insert fails, the transaction must roll back and the
API must **not** return `201`. Specifically:

- the API returns `500` (a safe generic error),
- no appointment row exists for the test slot afterwards.

## Step 1 — reset the test slot

```sql
DELETE FROM dbo.Appointments WHERE SlotId = 105; -- test-only, never production
```

The sample script seeds slots `101`–`105`; slot `105` is used here so
the concurrency test slot `101` stays untouched.

## Step 2 — install the temporary failing trigger

This trigger throws on every insert into `dbo.Appointments`, simulating
a database-side failure (constraint violation, disk error, etc.):

```sql
USE CaritasHospital;
GO

CREATE TRIGGER dbo.TR_Test_FailAppointmentInsert
ON dbo.Appointments
AFTER INSERT
AS
BEGIN
    THROW 51000, 'Intentional test failure', 1;
END;
GO
```

`THROW` aborts the statement and bubbles up as error 51000 to the
driver. This trigger is **test-only** — it is never part of the normal
database setup.

## Step 3 — attempt the booking

With the API running (`npm start`):

```bash
curl -i -X POST http://localhost:5000/api/appointments/book ^
  -H "Content-Type: application/json" ^
  -d "{\"slotId\": 105, \"patientId\": 5001}"
```

(Equivalent Node one-liner, if `curl` is unavailable):

```bash
node -e "fetch('http://localhost:5000/api/appointments/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slotId:105,patientId:5001})}).then(async r=>console.log(r.status, JSON.stringify(await r.json())))"
```

Expected result:

- HTTP `500` with a safe generic message — **not** `201`.
- The server log contains the trigger error (`Intentional test failure`,
  SQL error 51000) and, if applicable, rollback diagnostics.

## Step 4 — drop the trigger immediately

```sql
DROP TRIGGER dbo.TR_Test_FailAppointmentInsert;
GO
```

## Step 5 — verify the rollback

```sql
SELECT COUNT(*) AS OrphanRows FROM dbo.Appointments WHERE SlotId = 105;
```

Expected: `0`. The insert was rejected and the transaction rolled back,
so nothing partial was committed. The slot is still bookable:

```bash
node -e "fetch('http://localhost:5000/api/appointments/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slotId:105,patientId:5002})}).then(async r=>console.log(r.status, JSON.stringify(await r.json())))"
```

Second attempt expected: HTTP `201` (the trigger is gone and the slot is
available). Then clean up:

```sql
DELETE FROM dbo.Appointments WHERE SlotId = 105; -- restore test slot
```

## Why the rollback matters here

The insert in [controllers/appointmentController.js] runs inside the
same transaction that holds the `UPDLOCK, HOLDLOCK` slot lock. If the
insert throws, the controller rolls both back. Without the rollback, a
failed insert could theoretically leave the slot's lock table state or
any pre-insert writes committed — the transaction boundary guarantees
all-or-nothing.

Windows `curl` note: in `cmd.exe` use `^` line continuation and escaped
quotes as shown; in PowerShell use a single-line command or
`Invoke-RestMethod -Method POST -ContentType 'application/json' -Body '{"slotId":105,"patientId":5001}'`.
