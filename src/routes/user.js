const express = require('express');
const router = express.Router();
const { signUp, login, logout, authTest, getStylistSalon,viewLoyaltyProgram, getStylistWeeklySchedule, viewStylistMetrics, viewTotalRewards, getAllRewards, viewSingleLoyaltyProgram } = require('../controllers/userController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/user/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - full_name
 *               - email
 *               - role
 *               - password
 *             properties:
 *               full_name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               role:
 *                 type: string
 *                 enum: [CUSTOMER, OWNER, EMPLOYEE, ADMIN]
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User signed up successfully
 *       400:
 *         description: Bad request - missing fields or invalid data
 *       409:
 *         description: Conflict - user already exists
 *       500:
 *         description: Internal server error
 */
router.post('/signup', signUp);

/**
 * @swagger
 * /api/user/login:
 *   post:
 *     summary: Login user
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_id:
 *                       type: integer
 *                     full_name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     token:
 *                       type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Internal server error
 */
router.post('/login', login);

/**
 * @swagger
 * /api/user/logout:
 *   post:
 *     summary: Logout user
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logout successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_id:
 *                       type: integer
 *                     active:
 *                       type: integer
 *                       example: 0
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/logout', authenticateToken, logout);

/**
 * @swagger
 * /api/user/auth-test:
 *   get:
 *     summary: Test authentication
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Authentication valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Request Authorized via Token
 *       401:
 *         description: Unauthorized
 */
router.get('/auth-test', authenticateToken, authTest);

/**
 * @swagger
 * /api/user/stylist/getSalon:
 *   get:
 *     summary: Get stylist's assigned salon
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     salon_id:
 *                       type: integer
 *                     name:
 *                       type: string
 *                     description:
 *                       type: string
 *                     category:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     email:
 *                       type: string
 *                     address:
 *                       type: string
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     postal_code:
 *                       type: string
 *                     country:
 *                       type: string
 *                     owner_name:
 *                       type: string
 *                     employee_title:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       404:
 *         description: No salon assigned to this stylist
 *       500:
 *         description: Internal server error
 */
router.get('/stylist/getSalon', authenticateToken, roleAuthorization(['EMPLOYEE']), getStylistSalon);

/**
 * @swagger
 * /api/user/stylist/weeklySchedule:
 *   get:
 *     summary: Get stylist's weekly schedule
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *         description: Start date (MM-DD-YYYY format)
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *         description: End date (MM-DD-YYYY format)
 *     responses:
 *       200:
 *         description: Weekly schedule retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     schedule:
 *                       type: object
 *                       description: Map of dates to daily schedule
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           weekday:
 *                             type: string
 *                           availability:
 *                             type: object
 *                             properties:
 *                               availability_id:
 *                                 type: integer
 *                               start_time:
 *                                 type: string
 *                               end_time:
 *                                 type: string
 *                           unavailability:
 *                             type: array
 *                             items:
 *                               type: object
 *                           bookings:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 booking_id:
 *                                   type: integer
 *                                 customer:
 *                                   type: object
 *                                 scheduled_start:
 *                                   type: string
 *                                 scheduled_end:
 *                                   type: string
 *                                 status:
 *                                   type: string
 *                                 services:
 *                                   type: array
 *                                 total_price:
 *                                   type: number
 *                                 actual_amount_paid:
 *                                   type: number
 *       400:
 *         description: Invalid date format
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       500:
 *         description: Internal server error
 */
router.get('/stylist/weeklySchedule', authenticateToken, roleAuthorization(['EMPLOYEE']), getStylistWeeklySchedule);

/**
 * @swagger
 * /api/user/loyalty/view:
 *   get:
 *     summary: View customer loyalty program overview
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty program data retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userData:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       visits_count:
 *                         type: integer
 *                       total_visits_count:
 *                         type: integer
 *                       target_visits:
 *                         type: integer
 *                       discount_percentage:
 *                         type: number
 *                       note:
 *                         type: string
 *                       salon_name:
 *                         type: string
 *                 goldenSalons:
 *                   type: integer
 *                   description: Number of salons where user has 5+ visits
 *                 totalVisits:
 *                   type: integer
 *                   description: Total visits across all salons
 *                 userRewards:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       reward_id:
 *                         type: integer
 *                       earned_at:
 *                         type: string
 *                       active:
 *                         type: boolean
 *                       redeemed_at:
 *                         type: string
 *                       discount_percentage:
 *                         type: number
 *                       note:
 *                         type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: No Loyalty Program found
 *       500:
 *         description: Internal server error
 */
router.get('/loyalty/view', authenticateToken, roleAuthorization(['CUSTOMER']), viewLoyaltyProgram);

/**
 * @swagger
 * /api/user/loyalty/salon-view:
 *   get:
 *     summary: View loyalty program for a specific salon
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The salon ID
 *     responses:
 *       200:
 *         description: Salon loyalty program retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userData:
 *                   type: object
 *                   properties:
 *                     visits_count:
 *                       type: integer
 *                     total_visits_count:
 *                       type: integer
 *                     target_visits:
 *                       type: integer
 *                     discount_percentage:
 *                       type: number
 *                     note:
 *                       type: string
 *                     salon_name:
 *                       type: string
 *                 goldenSalons:
 *                   type: integer
 *                 totalVisits:
 *                   type: integer
 *                 userRewards:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized or invalid fields
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: No Loyalty Program found
 *       500:
 *         description: Internal server error
 */
router.get('/loyalty/salon-view', authenticateToken, roleAuthorization(['CUSTOMER']), viewSingleLoyaltyProgram);

/**
 * @swagger
 * /api/user/loyalty/total-rewards:
 *   get:
 *     summary: View total active rewards count
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Total rewards retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalRewards:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       500:
 *         description: Internal server error
 */
router.get('/loyalty/total-rewards', authenticateToken, roleAuthorization(['CUSTOMER']), viewTotalRewards);

/**
 * @swagger
 * /api/user/loyalty/all-rewards:
 *   get:
 *     summary: Get all active rewards with details
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All rewards retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalRewards:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       reward_id:
 *                         type: integer
 *                       discount_percentage:
 *                         type: number
 *                       note:
 *                         type: string
 *                       creationDate:
 *                         type: string
 *                       salon_name:
 *                         type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       500:
 *         description: Internal server error
 */
router.get('/loyalty/all-rewards', authenticateToken, roleAuthorization(['CUSTOMER']), getAllRewards);

/**
 * @swagger
 * /api/user/stylist/metrics:
 *   get:
 *     summary: View stylist revenue metrics
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stylist metrics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 revenueMetrics:
 *                   type: object
 *                   properties:
 *                     revenue_today:
 *                       type: number
 *                     revenue_past_week:
 *                       type: number
 *                     revenue_all_time:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/stylist/metrics', authenticateToken, roleAuthorization(['EMPLOYEE']), viewStylistMetrics);

module.exports = router;
