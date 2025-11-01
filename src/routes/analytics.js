const express = require('express');
const router = express.Router();
const { demographics, loyaltyProgramAnalytics, userEngagement, appointmentAnalytics } = require('../controllers/analyticsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

// AFVD 1.1 User Engagement
router.get('/user-engagement', authenticateToken, roleAuthorization(['ADMIN']), userEngagement);

// AFVD 1.2 Appointment Analytics
router.get('/appointment-analytics', authenticateToken, roleAuthorization(['ADMIN']), appointmentAnalytics);

// User Pie Chart
router.get('/demographics', authenticateToken, roleAuthorization(['ADMIN']), demographics);

// AFDV 1.4 Loyalty Program Analytics
router.get('/loyalty-program', authenticateToken, roleAuthorization(['ADMIN']), loyaltyProgramAnalytics);



module.exports = router;
