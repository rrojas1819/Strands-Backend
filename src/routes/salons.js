const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

// UAR 1.3/1.4 registration + salon type
router.post('/check', authenticateToken, roleAuthorization(['OWNER']), salonController.checkOwnerHasSalon);
router.post('/create', authenticateToken, roleAuthorization(['OWNER']), salonController.createSalon);

// UAR 1.5 salon approval
router.patch('/approve', authenticateToken, roleAuthorization(['ADMIN']), salonController.approveSalon);



module.exports = router;