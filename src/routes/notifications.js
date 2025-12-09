const express = require('express');
const router = express.Router();
const { getNotifications, getUnreadCount, markAsRead, markAllAsRead, stylistSendReminder, deleteNotification, deleteAllNotifications, ownerSendUnusedOffersNotifications } = require('../controllers/notificationsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/notifications/inbox:
 *   get:
 *     summary: Get user's notifications with pagination
 *     description: Get paginated notifications with optional category filter
 *     tags: [Notifications]
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
 *           maximum: 20
 *         description: Items per page (max 20)
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [all, bookings, rewards, products, reviews]
 *           default: all
 *         description: Filter notifications by category
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Notifications retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           notification_id:
 *                             type: integer
 *                           user_id:
 *                             type: integer
 *                           salon_id:
 *                             type: integer
 *                             nullable: true
 *                           employee_id:
 *                             type: integer
 *                             nullable: true
 *                           email:
 *                             type: string
 *                           booking_id:
 *                             type: integer
 *                             nullable: true
 *                           payment_id:
 *                             type: integer
 *                             nullable: true
 *                           product_id:
 *                             type: integer
 *                             nullable: true
 *                           review_id:
 *                             type: integer
 *                             nullable: true
 *                           type_code:
 *                             type: string
 *                           status:
 *                             type: string
 *                             enum: [UNREAD, READ]
 *                           message:
 *                             type: string
 *                           sender_email:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                           read_at:
 *                             type: string
 *                             nullable: true
 *                     unread_count:
 *                       type: integer
 *                       description: Total unread notifications
 *                     filter:
 *                       type: object
 *                       properties:
 *                         active:
 *                           type: string
 *                         available:
 *                           type: array
 *                           items:
 *                             type: string
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         total_pages:
 *                           type: integer
 *                         has_more:
 *                           type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/inbox', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE', 'CUSTOMER', "ADMIN"]), getNotifications);

/**
 * @swagger
 * /api/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     description: Get the count of unread notifications for the current user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unread_count:
 *                   type: integer
 *                   description: Number of unread notifications
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/unread-count', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE', 'CUSTOMER', "ADMIN"]), getUnreadCount);

/**
 * @swagger
 * /api/notifications/mark-read:
 *   post:
 *     summary: Mark notification as read
 *     description: Mark a specific notification as read
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Notification marked as read
 *                 data:
 *                   type: object
 *                   properties:
 *                     notification_id:
 *                       type: integer
 *                     read_at:
 *                       type: string
 *       400:
 *         description: Invalid notification_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found or already read
 *       500:
 *         description: Internal server error
 */
router.post('/mark-read', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE', 'CUSTOMER', "ADMIN"]), markAsRead);

/**
 * @swagger
 * /api/notifications/mark-all-read:
 *   post:
 *     summary: Mark all notifications as read
 *     description: Mark all unread notifications as read for the current user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: All notifications marked as read
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications_updated:
 *                       type: integer
 *                       description: Number of notifications marked as read
 *                     read_at:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/mark-all-read', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE', 'CUSTOMER', "ADMIN"]), markAllAsRead);

/**
 * @swagger
 * /api/notifications/stylist/send-reminder:
 *   post:
 *     summary: Stylist sends appointment reminder to customers
 *     description: Stylist sends appointment reminders to all customers with bookings today (limited to once per hour)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Reminders sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Reminders sent successfully to customers
 *                 data:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       description: Date reminders were sent for
 *                     salon_timezone:
 *                       type: string
 *                     notifications_created:
 *                       type: integer
 *                       description: Number of customers notified
 *                     total_bookings:
 *                       type: integer
 *                       description: Total bookings for today
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           notification_id:
 *                             type: integer
 *                           user_id:
 *                             type: integer
 *                           email:
 *                             type: string
 *                           full_name:
 *                             type: string
 *                           bookings_count:
 *                             type: integer
 *                           booking_ids:
 *                             type: array
 *                             items:
 *                               type: integer
 *       200:
 *         description: No bookings found for today
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: No bookings found for today
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications_created:
 *                       type: integer
 *                     date:
 *                       type: string
 *                     salon_timezone:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Employee not found or inactive
 *       429:
 *         description: Rate limited - can only send reminders once per hour
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
 *                     last_reminder_sent:
 *                       type: string
 *                     next_allowed_at:
 *                       type: string
 *                     minutes_remaining:
 *                       type: integer
 *       500:
 *         description: Internal server error
 */
router.post('/stylist/send-reminder', authenticateToken, roleAuthorization(['EMPLOYEE']), stylistSendReminder);

/**
 * @swagger
 * /api/notifications/delete/{notification_id}:
 *   delete:
 *     summary: Delete a notification
 *     description: Delete a specific notification
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Notification deleted successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     notification_id:
 *                       type: integer
 *       400:
 *         description: Invalid notification_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found or does not belong to you
 *       500:
 *         description: Internal server error
 */
router.delete('/delete/:notification_id', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE', 'CUSTOMER', "ADMIN"]), deleteNotification);

/**
 * @swagger
 * /api/notifications/delete-all:
 *   delete:
 *     summary: Delete all notifications
 *     description: Delete all notifications for the current user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: All notifications deleted successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications_deleted:
 *                       type: integer
 *                       description: Number of notifications deleted
 *                     total_before:
 *                       type: integer
 *                       description: Total notifications before deletion
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.delete('/delete-all', authenticateToken, roleAuthorization(['OWNER', 'EMPLOYEE', 'CUSTOMER', "ADMIN"]), deleteAllNotifications);

/**
 * @swagger
 * /api/notifications/owner/send-unused-offers:
 *   post:
 *     summary: Owner triggers unused offers notifications
 *     description: Owner manually sends notifications to customers with unused promos/rewards
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unused offers notifications sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Unused offers notifications sent successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     notifications_created:
 *                       type: integer
 *                       description: Number of notifications created
 *                     total_users_with_offers:
 *                       type: integer
 *                     users_processed:
 *                       type: integer
 *                     users_failed:
 *                       type: integer
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           notification_id:
 *                             type: integer
 *                           user_id:
 *                             type: integer
 *                           email:
 *                             type: string
 *                           salon_id:
 *                             type: integer
 *                           salon_name:
 *                             type: string
 *                           type:
 *                             type: string
 *                             enum: [promo_codes, loyalty_rewards]
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Only owners can trigger this notification
 *       404:
 *         description: Salon not found for this owner
 *       500:
 *         description: Internal server error
 */
router.post('/owner/send-unused-offers', authenticateToken, roleAuthorization(['OWNER']), ownerSendUnusedOffersNotifications);

module.exports = router;
