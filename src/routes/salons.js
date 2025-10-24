const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

// UAR 1.3/1.4 registration + salon type
router.get('/check', authenticateToken, roleAuthorization(['OWNER']), salonController.checkOwnerHasSalon);
router.post('/create', authenticateToken, roleAuthorization(['OWNER']), salonController.createSalon);

// UAR 1.5 salon approval
router.patch('/approve', authenticateToken, roleAuthorization(['ADMIN']), salonController.approveSalon);

// UAR 1.6 browse salons
router.get('/browse', authenticateToken, roleAuthorization(['ADMIN', 'CUSTOMER']), salonController.browseSalons);

// UAR 1.7 Add/Remove Employee
router.post('/addEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.addEmployee);
router.delete('/removeEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.removeEmployee);


// PLR 1.6 Configure Loyalty Program
router.post('/configureLoyalty', authenticateToken, roleAuthorization(['OWNER']), salonController.configureLoyalty);

module.exports = router;