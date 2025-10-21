const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken} = require('../middleware/auth.middleware');


router.post('/check', authenticateToken, salonController.checkOwnerHasSalon);
router.post('/create', authenticateToken, salonController.createSalon);



module.exports = router;