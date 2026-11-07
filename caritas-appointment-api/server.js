require('dotenv').config();

const express = require('express');
const { getPool, closePool } = require('./config/db');
const appointmentRoutes = require('./routes/appointmentRoutes');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ success: true, message: 'Caritas Hospital Appointment API is running' });
});

app.use('/api/appointments', appointmentRoutes);

/* Central error handler. Malformed JSON from express.json() arrives here
 * as a SyntaxError with a 400 status - map it to a client-safe message.
 * Anything else is logged server-side and returned as a generic 500
 * that never leaks SQL text, passwords or stack traces. */
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ success: false, message: 'Invalid JSON request body' });
    }
    console.error('Unhandled request error:', err);
    return res.status(500).json({
        success: false,
        message: 'An unexpected server error occurred. Please try again later.'
    });
});

/* Connect to SQL Server before accepting requests; start the HTTP server
 * only once the database connection succeeds. */
async function start() {
    try {
        await getPool();
        console.log('Connected to SQL Server.');
    } catch (err) {
        console.error('Could not connect to SQL Server on startup:', err.message);
        console.error('Check your .env settings (DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT, DB_ENCRYPT, DB_TRUST_CERT) against your local SQL Server configuration.');
        process.exitCode = 1;
        return;
    }

    const port = parseInt(process.env.PORT, 10) || 5000;
    app.listen(port, () => {
        console.log(`Caritas Hospital Appointment API listening on port ${port}`);
        console.log('Endpoint: POST /api/appointments/book');
    });
}

if (require.main === module) {
    process.on('SIGINT', async () => {
        await closePool().catch(() => {});
        process.exit();
    });
    start();
}

/* exported so tests can mount the app without starting a listener */
module.exports = app;
