const express = require('express');
const router = express.Router();
const {issueLoyalCustomerPromotions,getUserPromotions,sendPromotionToCustomer,previewPromoCode} = require('../controllers/promotionsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

// NC 1.2 - Issue loyal customer promotions (Bulk to gold customers)
router.post('/salons/:salonId/issue-promotions',authenticateToken,roleAuthorization(['OWNER']),issueLoyalCustomerPromotions);

// NC 1.2 - Send promotion to a specific customer
router.post('/salons/:salonId/sendPromoToCustomer',authenticateToken,roleAuthorization(['OWNER']),sendPromotionToCustomer);

// NC 1.2 - Get user promotions
router.get('/user/get-promotions',authenticateToken,roleAuthorization(['CUSTOMER']),getUserPromotions);

// Preview promo code - Get promo info and discounted price without redeeming
router.post('/preview',authenticateToken,roleAuthorization(['CUSTOMER']),previewPromoCode);

module.exports = router;


