const express = require('express');
const router = express.Router();
const { signUp, login, authTest } = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth.middleware');


router.post('/signup', signUp);
router.post('/login', login);

router.get('/auth-test', authenticateToken, authTest); // Example Authenication Test


module.exports = router;
