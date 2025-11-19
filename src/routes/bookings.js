const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/bookings/myAppointments:
 *   get:
 *     summary: Get customer's appointments
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Appointments retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/myAppointments', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.getMyAppointments);

/**
 * @swagger
 * /api/bookings/reschedule:
 *   post:
 *     summary: Reschedule a booking/appointment
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - booking_id
 *               - new_scheduled_start
 *             properties:
 *               booking_id:
 *                 type: integer
 *               new_scheduled_start:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Booking rescheduled successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/reschedule', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.rescheduleBooking);

/**
 * @swagger
 * /api/bookings/cancel:
 *   post:
 *     summary: Cancel a booking/appointment (customer)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - booking_id
 *             properties:
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/cancel', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.cancelBooking);

/**
 * @swagger
 * /api/bookings/stylist/cancel:
 *   post:
 *     summary: Cancel a booking/appointment (stylist)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - booking_id
 *             properties:
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.post('/stylist/cancel', authenticateToken, roleAuthorization(['EMPLOYEE']), bookingController.cancelBookingAsStylist);

/**
 * @swagger
 * /api/bookings/{booking_id}/deletePendingBooking:
 *   delete:
 *     summary: Delete a pending booking (transaction didn't go through)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pending booking deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.delete('/:booking_id/deletePendingBooking', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.deletePendingBooking);

/**
 * @swagger
 * /api/bookings/visits/customers:
 *   get:
 *     summary: List customer visits (owner sees all, stylist sees their own)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer visits retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner or Employee role required
 */
router.get('/visits/customers', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE']), bookingController.listVisitCustomers);

/**
 * @swagger
 * /api/bookings/visits/customers/{customer_user_id}:
 *   get:
 *     summary: Get individual customer's visit history
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customer_user_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Customer visit history retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner or Employee role required
 */
router.get('/visits/customers/:customer_user_id', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE']), bookingController.getCustomerVisitHistory);

module.exports = router;
