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

//UPH 1.2/1.21 salon owner/stylist seeing customer visits, stylists' only see their own
router.get('/visits/customers', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE']), bookingController.listVisitCustomers);

//UPH 1.2/1.21 salon owner/stylist seeing an individual customer's details
router.get('/visits/customers/:customer_user_id', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE']), bookingController.getCustomerVisitHistory);

module.exports = router;