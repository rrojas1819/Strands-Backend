const express = require('express');
const router = express.Router();
const {issueLoyalCustomerPromotions,getUserPromotions,sendPromotionToCustomer} = require('../controllers/promotionsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/promotions/salons/{salonId}/issue-promotions:
 *   post:
 *     summary: Issue loyal customer promotions (Bulk to gold customers) (Owner)
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salonId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Promotions issued successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/salons/:salonId/issue-promotions',authenticateToken,roleAuthorization(['OWNER']),issueLoyalCustomerPromotions);

/**
 * @swagger
 * /api/promotions/salons/{salonId}/sendPromoToCustomer:
 *   post:
 *     summary: Send promotion to a specific customer (Owner)
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salonId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customer_id
 *               - promotion_details
 *             properties:
 *               customer_id:
 *                 type: integer
 *               promotion_details:
 *                 type: object
 *     responses:
 *       200:
 *         description: Promotion sent successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/salons/:salonId/sendPromoToCustomer',authenticateToken,roleAuthorization(['OWNER']),sendPromotionToCustomer);

/**
 * @swagger
 * /api/promotions/user/get-promotions:
 *   get:
 *     summary: Get user promotions (Customer)
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User promotions retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/user/get-promotions',authenticateToken,roleAuthorization(['CUSTOMER']),getUserPromotions);

module.exports = router;
