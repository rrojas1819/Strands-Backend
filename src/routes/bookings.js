const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

//BS 1.3 customer cancels booking/appointment
router.post('/cancel', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.cancelBooking);

module.exports = router;
