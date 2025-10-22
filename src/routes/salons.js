const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');


router.post('/check', authenticateToken, roleAuthorization(['OWNER']), salonController.checkOwnerHasSalon);
router.post('/create', authenticateToken, roleAuthorization(['OWNER']), salonController.createSalon);



module.exports = router;