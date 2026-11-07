# Test execution status (honest record)

Environment: Windows 11, Node.js v26.13.0, SQL Server 2022 Express
(`localhost:1433`, instance `SQLEXPRESS`, Mixed Mode auth, `sa` login set
up during this session — password in `.env`, never committed).

## Actually executed and PASSED on the live SQL Server

| Test | Command | Result |
|---|---|---|
| Dependency install | `npm install` | PASSED (8 low/moderate npm-audit advisories, mostly Jest dev toolchain) |
| Syntax check of all JS sources | `node --check` | PASSED |
| Functional tests F01–F10 | `npm test` | **10 passed, 10 total** (201/409/404/validation/persistence cases) |
| 2-request concurrency | `npm run concurrency:2` | PASSED — 1 × 201, 1 × 409, 1 DB row |
| 5-request concurrency | `npm run concurrency:5` | PASSED — 1 × 201, 4 × 409, 1 DB row |
| 10-request concurrency | `npm run concurrency:10` | PASSED — 1 × 201, 9 × 409, 1 DB row |
| Database verification | script-based, after each run | exactly 1 appointment row for slot 101; zero slots with >1 appointment |
| Rollback test | `TR_Test_FailAppointmentInsert` trigger (created, tested, dropped) | PASSED — HTTP 500 with safe message, **0** rows persisted |

Notes from the real runs:

- The concurrency winner differed between runs (patient 5002 won the
  2-request run; patient 5001 won the 5- and 10-request runs) — the
  winning patient is not predetermined, as the spec requires.
- The rollback test was executed with the temporary trigger; the
  trigger was dropped immediately afterwards and the appointments table
  was reset to empty so the demo data starts clean.

## Environment setup performed during this session

- Installed SQL Server 2022 Express via `winget` (instance `SQLEXPRESS`).
- Enabled TCP/IP on port 1433 and switched the instance to Mixed Mode
  authentication (registry via an elevated one-shot script; keys
  `MSSQL16.SQLEXPRESS\MSSQLServer` and `...\SuperSocketNetLib\Tcp`).
- Enabled and set a strong random password for `sa` (stored in `.env`).
- Installed Microsoft `sqlcmd` (`C:\Program Files\Sqlcmd\sqlcmd.exe`).
- Ran `scripts/database.sql` successfully against the instance.

## Not executed / residual items

- SSMS was not installed (optional; sqlcmd used instead). To view the
  database in a GUI, install SSMS from the SQL Server installer.
- The instance still also listens on a dynamic port 50059 alongside
  1433 (harmless; the project uses 1433). To remove it, set
  `SuperSocketNetLib\Tcp\IPAll\TcpDynamicPorts` to 0 via SQL Server
  Configuration Manager.
- npm audit reports 8 low/moderate advisories in dev dependencies.
