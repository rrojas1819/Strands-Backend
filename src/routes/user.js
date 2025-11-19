const express = require('express');
const router = express.Router();
const { signUp, login, logout, authTest, getStylistSalon,viewLoyaltyProgram, getStylistWeeklySchedule, viewStylistMetrics } = require('../controllers/userController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/user/signup:
 *   post:
 *     summary: User registration
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
 *               - full_name
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               full_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [CUSTOMER, OWNER, EMPLOYEE, ADMIN]
 *     responses:
 *       200:
 *         description: User created successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.post('/signup', signUp);

/**
 * @swagger
 * /api/user/login:
 *   post:
 *     summary: User login
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
 *                 token:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', login);

/**
 * @swagger
 * /api/user/logout:
 *   post:
 *     summary: User logout
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', authenticateToken, logout);

/**
 * @swagger
 * /api/user/auth-test:
 *   get:
 *     summary: Test authentication endpoint
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Authentication successful
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
 *         description: Salon information retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
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
 *     responses:
 *       200:
 *         description: Weekly schedule retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.get('/stylist/weeklySchedule', authenticateToken, roleAuthorization(['EMPLOYEE']), getStylistWeeklySchedule);

/**
 * @swagger
 * /api/user/loyalty/view:
 *   get:
 *     summary: View loyalty program
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty program information retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/loyalty/view', authenticateToken, roleAuthorization(['CUSTOMER']), viewLoyaltyProgram);

/**
 * @swagger
 * /api/user/stylist/metrics:
 *   get:
 *     summary: View stylist metrics
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stylist metrics retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.get('/stylist/metrics', authenticateToken, roleAuthorization(['EMPLOYEE']), viewStylistMetrics);

module.exports = router;
