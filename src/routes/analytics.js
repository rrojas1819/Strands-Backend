const express = require('express');
const router = express.Router();
const { demographics } = require('../controllers/analyticsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

// User Pie Chart
router.get('/demographics', authenticateToken, roleAuthorization(['ADMIN']), demographics);


module.exports = router;
