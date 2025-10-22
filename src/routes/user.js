const express = require('express');
const router = express.Router();
const { signUp, login, logout, authTest, getStylistSalon } = require('../controllers/userController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');


router.post('/signup', signUp);
router.post('/login', login);
router.post('/logout', authenticateToken, logout);

router.get('/auth-test', authenticateToken, authTest); // Example Authenication Test

// UAR 1.8 Get stylist's assigned salon
router.get('/stylist/getSalon', authenticateToken, roleAuthorization(['EMPLOYEE']), getStylistSalon);

module.exports = router;
