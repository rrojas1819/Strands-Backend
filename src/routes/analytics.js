const express = require('express');
const router = express.Router();
const { demographics, loyaltyProgramAnalytics, userEngagement, appointmentAnalytics, salonRevenueAnalytics, customerRetentionAnalytics } = require('../controllers/analyticsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/admin/analytics/user-engagement:
 *   get:
 *     summary: Get user engagement analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User engagement data retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     today_logins:
 *                       type: integer
 *                     yesterday_logins:
 *                       type: integer
 *                     past_week_logins:
 *                       type: integer
 *                     previous_week_logins:
 *                       type: integer
 *                     total_bookings:
 *                       type: integer
 *                     repeat_bookers:
 *                       type: integer
 *                     top3Services:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           total_bookings:
 *                             type: integer
 *                     top3ViewedSalons:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           clicks:
 *                             type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       500:
 *         description: Internal server error
 */
router.get('/user-engagement', authenticateToken, roleAuthorization(['ADMIN']), userEngagement);

/**
 * @swagger
 * /api/admin/analytics/appointment-analytics:
 *   get:
 *     summary: Get appointment analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Appointment analytics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 appointmentsByDay:
 *                   type: object
 *                   description: Map of day names to appointment counts
 *                   additionalProperties:
 *                     type: integer
 *                 peakHours:
 *                   type: object
 *                   description: Map of hour labels to appointment counts
 *                   additionalProperties:
 *                     type: integer
 *                 avgDurationInMin:
 *                   type: number
 *                   description: Average appointment duration in minutes
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       500:
 *         description: Internal server error
 */
router.get('/appointment-analytics', authenticateToken, roleAuthorization(['ADMIN']), appointmentAnalytics);

/**
 * @swagger
 * /api/admin/analytics/salon-revenue-analytics:
 *   get:
 *     summary: Get salon revenue analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon revenue analytics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 perSalonRevenueAnalytics:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       salon_id:
 *                         type: integer
 *                       salon_name:
 *                         type: string
 *                       salon_revenue:
 *                         type: number
 *                       refunded_amount:
 *                         type: number
 *                 platformRevenueAnalytics:
 *                   type: object
 *                   properties:
 *                     platform_revenue:
 *                       type: number
 *                     refunded_amount:
 *                       type: number
 *                     total_successful:
 *                       type: integer
 *                     total_refunded:
 *                       type: integer
 *                 topMetrics:
 *                   type: object
 *                   properties:
 *                     topSalon:
 *                       type: object
 *                       properties:
 *                         salon_name:
 *                           type: string
 *                         product_revenue:
 *                           type: number
 *                         booking_revenue:
 *                           type: number
 *                         total_revenue:
 *                           type: number
 *                     topProduct:
 *                       type: object
 *                       properties:
 *                         salon_name:
 *                           type: string
 *                         product_name:
 *                           type: string
 *                         listing_price:
 *                           type: number
 *                         units_sold:
 *                           type: integer
 *                         total_revenue:
 *                           type: number
 *                     topStylist:
 *                       type: object
 *                       properties:
 *                         stylist_name:
 *                           type: string
 *                         salon_name:
 *                           type: string
 *                         total_revenue:
 *                           type: number
 *                         total_bookings:
 *                           type: integer
 *                     topServices:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           service_name:
 *                             type: string
 *                           salon_name:
 *                             type: string
 *                           times_booked:
 *                             type: integer
 *                           total_revenue:
 *                             type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       500:
 *         description: Internal server error
 */
router.get('/salon-revenue-analytics', authenticateToken, roleAuthorization(['ADMIN']), salonRevenueAnalytics);

/**
 * @swagger
 * /api/admin/analytics/loyalty-program:
 *   get:
 *     summary: Get loyalty program analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty program analytics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_users:
 *                       type: integer
 *                     users_with_bookings:
 *                       type: integer
 *                     bronze_status:
 *                       type: integer
 *                     golden_status:
 *                       type: integer
 *                     total_rewards:
 *                       type: integer
 *                     redeemed_rewards:
 *                       type: integer
 *                 multiSalonMemberships:
 *                   type: integer
 *                 top3PerformingSalons:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       salon_name:
 *                         type: string
 *                       participants:
 *                         type: integer
 *                       golden_members:
 *                         type: integer
 *                       total_visits:
 *                         type: integer
 *                       avg_visits_per_member:
 *                         type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       500:
 *         description: Internal server error
 */
router.get('/loyalty-program', authenticateToken, roleAuthorization(['ADMIN']), loyaltyProgramAnalytics);

/**
 * @swagger
 * /api/admin/analytics/demographics:
 *   get:
 *     summary: Get user demographics (pie chart data)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Demographics data retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   description: User counts by role
 *                   properties:
 *                     ADMIN:
 *                       type: integer
 *                     OWNER:
 *                       type: integer
 *                     CUSTOMER:
 *                       type: integer
 *                     EMPLOYEE:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       500:
 *         description: Internal server error
 */
router.get('/demographics', authenticateToken, roleAuthorization(['ADMIN']), demographics);

/**
 * @swagger
 * /api/admin/analytics/customer-retention-analytics:
 *   get:
 *     summary: Get customer retention analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer retention analytics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     rebooking_rate_percent:
 *                       type: number
 *                     avg_return_interval_days:
 *                       type: number
 *                     first_time_VS_return_time:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           first_time_customers:
 *                             type: integer
 *                           returning_customers:
 *                             type: integer
 *                           first_time_percentage:
 *                             type: number
 *                           returning_percentage:
 *                             type: number
 *                     favorite_stylist_loyalty:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           stylist_name:
 *                             type: string
 *                           salon_name:
 *                             type: string
 *                           loyal_customers:
 *                             type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       500:
 *         description: Internal server error
 */
router.get('/customer-retention-analytics', authenticateToken, roleAuthorization(['ADMIN']), customerRetentionAnalytics);


module.exports = router;
