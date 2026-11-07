const express = require('express');

const { bookAppointment } = require('../controllers/appointmentController');

const router = express.Router();

/* POST /api/appointments/book */
router.post('/book', bookAppointment);

module.exports = router;
