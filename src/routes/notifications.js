const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, stylistSendReminder, deleteNotification } = require('../controllers/notificationsController');
const { authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/notifications/inbox:
 *   get:
 *     summary: Get user's notifications with pagination
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/inbox', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER',"ADMIN"]), getNotifications);

/**
 * @swagger
 * /api/notifications/mark-read:
 *   post:
 *     summary: Mark notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - notification_id
 *             properties:
 *               notification_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Notification marked as read successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post('/mark-read', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER',"ADMIN"]), markAsRead);

/**
 * @swagger
 * /api/notifications/stylist/send-reminder:
 *   post:
 *     summary: Stylist manually sends appointment reminder to specific customers by email
 *     tags: [Notifications]
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
 *         description: Reminder sent successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.post('/stylist/send-reminder', authenticateToken, roleAuthorization(['EMPLOYEE']), stylistSendReminder);

/**
 * @swagger
 * /api/notifications/delete/{notification_id}:
 *   delete:
 *     summary: Delete notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notification_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notification deleted successfully
 *       401:
 *         description: Unauthorized
 */
router.delete('/delete/:notification_id', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER',"ADMIN"]), deleteNotification);

module.exports = router;
