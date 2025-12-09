const express = require('express');
const router = express.Router();
const unavailabilityController = require('../controllers/unavailabilityController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/unavailability:
 *   post:
 *     summary: Create a recurring unavailability block
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
 *               - weekday
 *               - start_time
 *               - end_time
 *             properties:
 *               weekday:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 6
 *                 description: 0=Sunday, 1=Monday, ..., 6=Saturday
 *               start_time:
 *                 type: string
 *                 example: "09:00"
 *                 description: HH:MM format (24h)
 *               end_time:
 *                 type: string
 *                 example: "12:00"
 *                 description: HH:MM format (24h)
 *               slot_interval_minutes:
 *                 type: integer
 *                 default: 30
 *     responses:
 *       201:
 *         description: Unavailability block created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Recurring block created
 *                 data:
 *                   type: object
 *                   properties:
 *                     unavailability_id:
 *                       type: integer
 *                     employee_id:
 *                       type: integer
 *                     weekday:
 *                       type: integer
 *                     start_time:
 *                       type: string
 *                     end_time:
 *                       type: string
 *                     slot_interval_minutes:
 *                       type: integer
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *       400:
 *         description: Invalid weekday, time format, or unavailability outside availability hours
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       404:
 *         description: Employee not found or no availability set
 *       409:
 *         description: Overlaps existing block or conflicting appointments
 *       500:
 *         description: Internal server error
 */
router.post('/', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.createRecurringBlock);

/**
 * @swagger
 * /api/unavailability:
 *   get:
 *     summary: List recurring unavailability blocks
 *     tags: [Unavailability]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: weekday
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *         description: Filter by weekday (0-6)
 *     responses:
 *       200:
 *         description: Unavailability blocks retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       unavailability_id:
 *                         type: integer
 *                       employee_id:
 *                         type: integer
 *                       weekday:
 *                         type: integer
 *                       start_time:
 *                         type: string
 *                       end_time:
 *                         type: string
 *                       slot_interval_minutes:
 *                         type: integer
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *       400:
 *         description: Invalid weekday value
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.listRecurringBlocks);

/**
 * @swagger
 * /api/unavailability:
 *   delete:
 *     summary: Delete a recurring unavailability block
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
 *               - weekday
 *               - start_time
 *               - end_time
 *             properties:
 *               weekday:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 6
 *               start_time:
 *                 type: string
 *                 example: "09:00"
 *               end_time:
 *                 type: string
 *                 example: "12:00"
 *     responses:
 *       200:
 *         description: Unavailability block deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Recurring block deleted
 *       400:
 *         description: Invalid weekday or time format
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - EMPLOYEE role required
 *       404:
 *         description: Employee or recurring block not found
 *       500:
 *         description: Internal server error
 */
router.delete('/', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.deleteRecurringBlock);

module.exports = router;
