const express = require('express');
const router = express.Router();
const { demographics, loyaltyProgramAnalytics } = require('../controllers/analyticsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

// User Pie Chart
router.get('/demographics', authenticateToken, roleAuthorization(['ADMIN']), demographics);

// AFDV 1.4 Loyalty Program Analytics
router.get('/loyalty-program', authenticateToken, roleAuthorization(['ADMIN']), loyaltyProgramAnalytics);

module.exports = router;
