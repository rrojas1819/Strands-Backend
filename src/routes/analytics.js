const express = require('express');
const router = express.Router();
const { demographics, loyaltyProgramAnalytics, userEngagement, appointmentAnalytics, salonRevenueAnalytics } = require('../controllers/analyticsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/analytics/user-engagement:
 *   get:
 *     summary: Get user engagement analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User engagement analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/user-engagement', authenticateToken, roleAuthorization(['ADMIN']), userEngagement);

/**
 * @swagger
 * /api/analytics/appointment-analytics:
 *   get:
 *     summary: Get appointment analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Appointment analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/appointment-analytics', authenticateToken, roleAuthorization(['ADMIN']), appointmentAnalytics);

/**
 * @swagger
 * /api/analytics/demographics:
 *   get:
 *     summary: Get user demographics analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Demographics analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/demographics', authenticateToken, roleAuthorization(['ADMIN']), demographics);

/**
 * @swagger
 * /api/analytics/salon-revenue-analytics:
 *   get:
 *     summary: Get salon revenue analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon revenue analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/salon-revenue-analytics', authenticateToken, roleAuthorization(['ADMIN']), salonRevenueAnalytics);

/**
 * @swagger
 * /api/analytics/loyalty-program:
 *   get:
 *     summary: Get loyalty program analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty program analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/loyalty-program', authenticateToken, roleAuthorization(['ADMIN']), loyaltyProgramAnalytics);

module.exports = router;
