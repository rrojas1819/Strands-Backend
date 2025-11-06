const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

// PLR 1.1
router.post('/process', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.processPayment);

// PLR 1.5 Get available rewards for a salon
router.post('/availableRewards', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getAvailableRewards);


// PLR 1.1 / PLR 1.101 save and get credit cards
router.post('/saveCreditCard', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.saveCreditCard);
router.post('/saveTempCreditCard', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.saveTempCreditCard);
router.get('/getCreditCards', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getCreditCards);
router.delete('/deleteCreditCard/:credit_card_id', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.deleteCreditCard);

// PLR 1.1 / PLR 1.101 for Billing Address Management (one per user)
router.post('/createBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.createBillingAddress);
router.get('/getBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getBillingAddress);
router.put('/updateBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.updateBillingAddress);
router.delete('/deleteBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.deleteBillingAddress);

module.exports = router;




