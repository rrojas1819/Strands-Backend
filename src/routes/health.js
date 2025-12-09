const express = require('express');
const router = express.Router();
const { healthCheck } = require('../controllers/healthController');

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 message:
 *                   type: string
 *                   example: "Server: Online"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-01-15T10:30:00.000Z"
 */
router.get('/health', healthCheck);


module.exports = router;
