const express = require('express');
const router = express.Router();
const unavailabilityController = require('../controllers/unavailabilityController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/unavailability:
 *   post:
 *     summary: Create recurring unavailable time block (Employee)
 *     tags: [Unavailability]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - day_of_week
 *               - start_time
 *               - end_time
 *             properties:
 *               day_of_week:
 *                 type: integer
 *               start_time:
 *                 type: string
 *               end_time:
 *                 type: string
 *     responses:
 *       200:
 *         description: Recurring block created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.post('/', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.createRecurringBlock);

/**
 * @swagger
 * /api/unavailability:
 *   get:
 *     summary: List recurring unavailable time blocks (Employee)
 *     tags: [Unavailability]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recurring blocks retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.get('/', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.listRecurringBlocks);

/**
 * @swagger
 * /api/unavailability:
 *   delete:
 *     summary: Delete recurring unavailable time block (Employee)
 *     tags: [Unavailability]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - block_id
 *             properties:
 *               block_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Recurring block deleted successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.delete('/', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.deleteRecurringBlock);

module.exports = router;
