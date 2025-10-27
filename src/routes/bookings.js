const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

//BS 1.4 customer views their appointments
router.get('/myAppointments', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.getMyAppointments);

//BS 1.2 customer reschedules booking/appointment
router.post('/reschedule', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.rescheduleBooking);

//BS 1.3 customer cancels booking/appointment
router.post('/cancel', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.cancelBooking);

module.exports = router;