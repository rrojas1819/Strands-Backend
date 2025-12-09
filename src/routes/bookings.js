const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/bookings/myAppointments:
 *   get:
 *     summary: Get customer's appointments with pagination
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *         description: Items per page
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [canceled, upcoming, past]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: Appointments retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       booking_id:
 *                         type: integer
 *                       salon:
 *                         type: object
 *                         properties:
 *                           salon_id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           address:
 *                             type: string
 *                           phone:
 *                             type: string
 *                       appointment:
 *                         type: object
 *                         properties:
 *                           scheduled_start:
 *                             type: string
 *                           scheduled_end:
 *                             type: string
 *                           duration_minutes:
 *                             type: integer
 *                           status:
 *                             type: string
 *                       stylists:
 *                         type: array
 *                         items:
 *                           type: object
 *                       services:
 *                         type: array
 *                         items:
 *                           type: object
 *                       total_price:
 *                         type: number
 *                       actual_amount_paid:
 *                         type: number
 *                       reward:
 *                         type: object
 *                       promo:
 *                         type: object
 *                 filter:
 *                   type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     total_items:
 *                       type: integer
 *                     has_next_page:
 *                       type: boolean
 *                     has_prev_page:
 *                       type: boolean
 *       400:
 *         description: Invalid filter
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       500:
 *         description: Internal server error
 */
router.get('/myAppointments', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.getMyAppointments);

/**
 * @swagger
 * /api/bookings/reschedule:
 *   post:
 *     summary: Reschedule a booking (creates new booking, cancels old)
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
 *               - scheduled_start
 *             properties:
 *               booking_id:
 *                 type: integer
 *               scheduled_start:
 *                 type: string
 *                 format: date-time
 *                 description: ISO 8601 datetime with timezone
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Booking rescheduled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     old_booking_id:
 *                       type: integer
 *                     new_booking_id:
 *                       type: integer
 *                     appointment:
 *                       type: object
 *                       properties:
 *                         scheduled_start:
 *                           type: string
 *                         scheduled_end:
 *                           type: string
 *                         duration_minutes:
 *                           type: integer
 *                         status:
 *                           type: string
 *                     total_services:
 *                       type: integer
 *       400:
 *         description: Bad request - cannot reschedule same day
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Booking not found or not reschedulable
 *       409:
 *         description: Time slot conflict
 *       500:
 *         description: Internal server error
 */
router.post('/reschedule', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.rescheduleBooking);

/**
 * @swagger
 * /api/bookings/cancel:
 *   post:
 *     summary: Cancel a booking (customer)
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
 *         description: Booking cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Booking canceled
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking_id:
 *                       type: integer
 *                     previous_status:
 *                       type: string
 *                     new_status:
 *                       type: string
 *                       example: CANCELED
 *                     canceled_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad request - cannot cancel same day
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Internal server error
 */
router.post('/cancel', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.cancelBooking);

/**
 * @swagger
 * /api/bookings/stylist/cancel:
 *   post:
 *     summary: Cancel a booking (stylist)
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
 *         description: Booking cancelled by stylist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking_id:
 *                       type: integer
 *                     previous_status:
 *                       type: string
 *                     new_status:
 *                       type: string
 *                     canceled_at:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       404:
 *         description: Booking not found or not assigned to you
 *       500:
 *         description: Internal server error
 */
router.post('/stylist/cancel', authenticateToken, roleAuthorization(['EMPLOYEE']), bookingController.cancelBookingAsStylist);

/**
 * @swagger
 * /api/bookings/{booking_id}/deletePendingBooking:
 *   delete:
 *     summary: Delete a pending booking (transaction didn't complete)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The booking ID
 *     responses:
 *       200:
 *         description: Pending booking deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Pending booking deleted successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking_id:
 *                       type: integer
 *                     deleted_at:
 *                       type: string
 *       400:
 *         description: Invalid booking id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Booking not found or not PENDING
 *       500:
 *         description: Internal server error
 */
router.delete('/:booking_id/deletePendingBooking', authenticateToken, roleAuthorization(['CUSTOMER']), bookingController.deletePendingBooking);

/**
 * @swagger
 * /api/bookings/visits/customers:
 *   get:
 *     summary: Get customer visit list (owner sees all, stylist sees their own)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Customer visits retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total_records:
 *                           type: integer
 *                     customers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           user_id:
 *                             type: integer
 *                           full_name:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phone:
 *                             type: string
 *                           total_visits:
 *                             type: integer
 *                           last_visit:
 *                             type: string
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     has_more:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER or EMPLOYEE role required
 *       404:
 *         description: Salon or employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/visits/customers', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE']), bookingController.listVisitCustomers);

/**
 * @swagger
 * /api/bookings/visits/customers/{customer_user_id}:
 *   get:
 *     summary: Get individual customer visit history
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customer_user_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The customer user ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Customer visit history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     customer:
 *                       type: object
 *                       properties:
 *                         user_id:
 *                           type: integer
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total_records:
 *                           type: integer
 *                     visits:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           booking_id:
 *                             type: integer
 *                           scheduled_start:
 *                             type: string
 *                           scheduled_end:
 *                             type: string
 *                           status:
 *                             type: string
 *                           services:
 *                             type: array
 *                           total_price:
 *                             type: number
 *                           actual_amount_paid:
 *                             type: number
 *                     has_more:
 *                       type: boolean
 *       400:
 *         description: Invalid customer ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER or EMPLOYEE role required
 *       500:
 *         description: Internal server error
 */
router.get('/visits/customers/:customer_user_id', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE']), bookingController.getCustomerVisitHistory);

module.exports = router;
