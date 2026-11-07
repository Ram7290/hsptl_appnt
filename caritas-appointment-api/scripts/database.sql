/*
 * Caritas Hospital - database setup and sample data
 *
 * Run this in SQL Server Management Studio (SSMS) or with sqlcmd:
 *     sqlcmd -S localhost -U sa -P <password> -i scripts/database.sql
 *
 * IMPORTANT - The DELETE statement at the bottom of this script is for
 * LOCAL TESTING ONLY. Never run reset/delete statements against
 * production data.
 */

/* ------------------------------------------------------------------ */
/* 1. Create the database if it does not exist                         */
/* ------------------------------------------------------------------ */
IF DB_ID(N'CaritasHospital') IS NULL
BEGIN
    CREATE DATABASE CaritasHospital;
END
GO

USE CaritasHospital;
GO

/* ------------------------------------------------------------------ */
/* 2. Tables (guarded so the script is safe to re-run)                 */
/*    Creation order: Doctors and Patients (no FKs), then              */
/*    AppointmentSlots (FK to Doctors), then Appointments (FKs to      */
/*    AppointmentSlots and Patients) so every FK resolves at DDL time. */
/* ------------------------------------------------------------------ */

IF OBJECT_ID(N'dbo.Doctors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Doctors (
        DoctorId   INT NOT NULL
            CONSTRAINT PK_Doctors PRIMARY KEY,
        DoctorName VARCHAR(100) NOT NULL
    ) ON [PRIMARY];
END
GO

IF OBJECT_ID(N'dbo.Patients', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Patients (
        PatientId   INT NOT NULL
            CONSTRAINT PK_Patients PRIMARY KEY,
        PatientName VARCHAR(100) NOT NULL
    ) ON [PRIMARY];
END
GO

IF OBJECT_ID(N'dbo.AppointmentSlots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppointmentSlots (
        SlotId          INT NOT NULL
            CONSTRAINT PK_AppointmentSlots PRIMARY KEY,
        DoctorId        INT NOT NULL
            CONSTRAINT FK_AppointmentSlots_Doctors
            REFERENCES dbo.Doctors (DoctorId),
        AppointmentDate DATE NOT NULL,
        StartTime       TIME NOT NULL
    ) ON [PRIMARY];
END
GO

/* Appointments comes last and references the other three tables. */
IF OBJECT_ID(N'dbo.Appointments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Appointments (
        AppointmentId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_Appointments PRIMARY KEY,
        SlotId        INT NOT NULL
            CONSTRAINT FK_Appointments_AppointmentSlots
            REFERENCES dbo.AppointmentSlots (SlotId),
        PatientId     INT NOT NULL
            CONSTRAINT FK_Appointments_Patients
            REFERENCES dbo.Patients (PatientId),
        BookedAt      DATETIME2 NOT NULL
            CONSTRAINT DF_Appointments_BookedAt DEFAULT (SYSDATETIME())
    ) ON [PRIMARY];
END
GO

/* ------------------------------------------------------------------ */
/* 3. Unique constraint: one appointment row per slot, ever            */
/*    This is the database-level guarantee that prevents duplicates.   */
/* ------------------------------------------------------------------ */

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = N'UQ_Appointments_SlotId'
)
BEGIN
    ALTER TABLE dbo.Appointments
        ADD CONSTRAINT UQ_Appointments_SlotId UNIQUE (SlotId);
END
GO

/* ------------------------------------------------------------------ */
/* 4. Sample data                                                      */
/*    IDs are fixed so tests can rely on them. Slot dates/times are    */
/*    FIXED sample values and are clearly documented here - the        */
/*    booking API performs no date/time comparison, so availability    */
/*    depends only on whether an appointment row exists for the slot.  */
/* ------------------------------------------------------------------ */

IF NOT EXISTS (SELECT 1 FROM dbo.Doctors WHERE DoctorId = 1)
BEGIN
    INSERT INTO dbo.Doctors (DoctorId, DoctorName) VALUES (1, N'Dr. John');
END

IF NOT EXISTS (SELECT 1 FROM dbo.Doctors WHERE DoctorId = 2)
BEGIN
    INSERT INTO dbo.Doctors (DoctorId, DoctorName) VALUES (2, N'Dr. David');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Patients WHERE PatientId = 5001)
BEGIN
    INSERT INTO dbo.Patients (PatientId, PatientName)
    VALUES
        (5001, N'Patient 5001'),
        (5002, N'Patient 5002'),
        (5003, N'Patient 5003'),
        (5004, N'Patient 5004'),
        (5005, N'Patient 5005');
END

IF NOT EXISTS (SELECT 1 FROM dbo.Patients WHERE PatientId = 5006)
BEGIN
    INSERT INTO dbo.Patients (PatientId, PatientName)
    VALUES
        (5006, N'Patient 5006'),
        (5007, N'Patient 5007'),
        (5008, N'Patient 5008'),
        (5009, N'Patient 5009'),
        (5010, N'Patient 5010');
END
GO

/* Five pre-created slots. These dates are fixed sample values
   (10 Nov 2026), not computed at run time - the booking endpoint
   never compares AppointmentDate with today's date. */
IF NOT EXISTS (SELECT 1 FROM dbo.AppointmentSlots WHERE SlotId = 101)
BEGIN
    INSERT INTO dbo.AppointmentSlots (SlotId, DoctorId, AppointmentDate, StartTime)
    VALUES
        (101, 1, N'2026-11-10', N'09:00'),
        (102, 1, N'2026-11-10', N'09:30'),
        (103, 2, N'2026-11-10', N'10:00'),
        (104, 2, N'2026-11-10', N'10:30'),
        (105, 1, N'2026-11-10', N'11:00');
END
GO

/* ------------------------------------------------------------------ */
/* 5. Resetting a test slot (LOCAL TESTING ONLY - NEVER IN PROD)       */
/*                                                                     */
/*    The concurrency tests need an empty slot to start from. To       */
/*    reset slot 101, run:                                             */
/*                                                                     */
/*        DELETE FROM dbo.Appointments WHERE SlotId = 101;             */
/*                                                                     */
/*    The delete order is fine here because nothing references          */
/*    Appointments. This statement is test-only: running deletes on     */
/*    production booking data would destroy real appointments.          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 6. Display the inserted sample data                                 */
/* ------------------------------------------------------------------ */
SELECT DoctorId, DoctorName    FROM dbo.Doctors        ORDER BY DoctorId;
SELECT PatientId, PatientName  FROM dbo.Patients       ORDER BY PatientId;
SELECT SlotId, DoctorId, AppointmentDate, StartTime FROM dbo.AppointmentSlots ORDER BY SlotId;
SELECT AppointmentId, SlotId, PatientId, BookedAt FROM dbo.Appointments      ORDER BY AppointmentId;
GO
