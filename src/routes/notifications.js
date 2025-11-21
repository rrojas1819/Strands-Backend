const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, stylistSendReminder, deleteNotification, ownerSendUnusedOffersNotifications } = require('../controllers/notificationsController');
const { authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

// NC 1.1 - Get user's notifications with pagination
router.get('/inbox', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER',"ADMIN"]), getNotifications);

// NC 1.1 - Mark notification as read
router.post('/mark-read', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER',"ADMIN"]), markAsRead);

// NC 1.1 - Stylist manually sends appointment reminder to specific customers by email
router.post('/stylist/send-reminder', authenticateToken, roleAuthorization(['EMPLOYEE']), stylistSendReminder);

// NC 1.1 - Delete notification
router.delete('/delete/:notification_id', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER',"ADMIN"]), deleteNotification);

// NC 1.3 - Owner endpoint to manually trigger unused offers notifications
router.post('/owner/send-unused-offers', authenticateToken, roleAuthorization(['OWNER']), ownerSendUnusedOffersNotifications);

module.exports = router;

