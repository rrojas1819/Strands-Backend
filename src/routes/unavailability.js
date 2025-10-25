const express = require('express');
const router = express.Router();
const unavailabilityController = require('../controllers/unavailabilityController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

//BS 1.5 block unavailable time slots
router.post('/:employeeId', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.createRecurringBlock);
router.get('/:employeeId', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.listRecurringBlocks);
router.delete('/:employeeId/:unavailabilityId', authenticateToken, roleAuthorization(['EMPLOYEE']), unavailabilityController.deleteRecurringBlock);

module.exports = router;