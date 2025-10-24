const express = require('express');
const router = express.Router();
const { signUp, login, logout, authTest, getStylistSalon,viewLoyaltyProgram, getStylistWeeklySchedule } = require('../controllers/userController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');


router.post('/signup', signUp);
router.post('/login', login);
router.post('/logout', authenticateToken, logout);

router.get('/auth-test', authenticateToken, authTest); // Example Authenication Test

// UAR 1.8 Get stylist's assigned salon
router.get('/stylist/getSalon', authenticateToken, roleAuthorization(['EMPLOYEE']), getStylistSalon);

// BS 1.4 Get stylist's weekly schedule
router.get('/stylist/weeklySchedule', authenticateToken, roleAuthorization(['EMPLOYEE']), getStylistWeeklySchedule);
// PLR 1.4 View Loyalty Program
router.get('/loyalty/view', authenticateToken, roleAuthorization(['CUSTOMER']), viewLoyaltyProgram);

module.exports = router;
