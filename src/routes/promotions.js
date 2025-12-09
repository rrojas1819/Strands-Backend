const express = require('express');
const router = express.Router();
const {issueLoyalCustomerPromotions,getUserPromotions,sendPromotionToCustomer,previewPromoCode} = require('../controllers/promotionsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/promotions/salons/{salonId}/issue-promotions:
 *   post:
 *     summary: Issue promotions to loyal customers (bulk)
 *     description: Owner issues promotions to all customers with 5+ visits (Gold status)
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
 *               - discount_pct
 *             properties:
 *               discount_pct:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Discount percentage
 *               description:
 *                 type: string
 *                 description: Optional promo description
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration date (ISO format)
 *     responses:
 *       201:
 *         description: Promotions issued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Promotions issued to loyal customers
 *                 data:
 *                   type: object
 *                   properties:
 *                     salon_id:
 *                       type: integer
 *                     promotions_created:
 *                       type: integer
 *                       description: Number of promotions created
 *                     notifications_created:
 *                       type: integer
 *                       description: Number of notifications sent
 *                     recipients:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           user_id:
 *                             type: integer
 *                           user_promo_id:
 *                             type: integer
 *                           notification_id:
 *                             type: integer
 *                           promo_code:
 *                             type: string
 *       200:
 *         description: No loyal customers found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: No loyal customers to send promotions to
 *                 data:
 *                   type: object
 *                   properties:
 *                     salon_id:
 *                       type: integer
 *                     notifications_created:
 *                       type: integer
 *                     promotions_created:
 *                       type: integer
 *       400:
 *         description: Invalid discount_pct or expires_at
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found for this owner
 *       500:
 *         description: Internal server error
 */
router.post('/salons/:salonId/issue-promotions',authenticateToken,roleAuthorization(['OWNER']),issueLoyalCustomerPromotions);

/**
 * @swagger
 * /api/promotions/salons/{salonId}/sendPromoToCustomer:
 *   post:
 *     summary: Send promotion to a specific customer
 *     description: Owner sends a promotion to a specific customer by email
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
 *               - email
 *               - discount_pct
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Customer's email address
 *               discount_pct:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               description:
 *                 type: string
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Promotion sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Promotion sent to customer
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_id:
 *                       type: integer
 *                     promo_code:
 *                       type: string
 *                     user_promo_id:
 *                       type: integer
 *                     notification_id:
 *                       type: integer
 *       400:
 *         description: Invalid fields or discount_pct
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found or has no bookings at this salon
 *       500:
 *         description: Internal server error
 */
router.post('/salons/:salonId/sendPromoToCustomer',authenticateToken,roleAuthorization(['OWNER']),sendPromotionToCustomer);

/**
 * @swagger
 * /api/promotions/user/get-promotions:
 *   get:
 *     summary: Get user promotions
 *     description: Customer gets all their available promotions
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User promotions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User promotions retrieved
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       user_promo_id:
 *                         type: integer
 *                       user_id:
 *                         type: integer
 *                       salon_id:
 *                         type: integer
 *                       salon_name:
 *                         type: string
 *                       promo_code:
 *                         type: string
 *                       description:
 *                         type: string
 *                       discount_pct:
 *                         type: number
 *                       status:
 *                         type: string
 *                         enum: [ISSUED, REDEEMED, EXPIRED]
 *                       issued_at:
 *                         type: string
 *                       expires_at:
 *                         type: string
 *                         nullable: true
 *                       redeemed_at:
 *                         type: string
 *                         nullable: true
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/user/get-promotions',authenticateToken,roleAuthorization(['CUSTOMER']),getUserPromotions);

/**
 * @swagger
 * /api/promotions/preview:
 *   post:
 *     summary: Preview promo code (get info and discounted price)
 *     description: Customer previews a promo code to see discount details without redeeming
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - promo_code
 *               - booking_id
 *             properties:
 *               promo_code:
 *                 type: string
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Promo code preview retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Promo code preview retrieved
 *                 data:
 *                   type: object
 *                   properties:
 *                     promo:
 *                       type: object
 *                       properties:
 *                         user_promo_id:
 *                           type: integer
 *                         promo_code:
 *                           type: string
 *                         description:
 *                           type: string
 *                         discount_pct:
 *                           type: number
 *                         status:
 *                           type: string
 *                         issued_at:
 *                           type: string
 *                         expires_at:
 *                           type: string
 *                           nullable: true
 *                     booking:
 *                       type: object
 *                       properties:
 *                         booking_id:
 *                           type: integer
 *                         services:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               service_id:
 *                                 type: integer
 *                               service_name:
 *                                 type: string
 *                               price:
 *                                 type: number
 *                               duration_minutes:
 *                                 type: integer
 *                     pricing:
 *                       type: object
 *                       properties:
 *                         original_total:
 *                           type: number
 *                           description: Original total price
 *                         discount_percentage:
 *                           type: number
 *                           description: Discount percentage applied
 *                         discount_amount:
 *                           type: number
 *                           description: Amount saved
 *                         discounted_total:
 *                           type: number
 *                           description: Final price after discount
 *       400:
 *         description: Invalid or expired promo code
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Booking does not belong to you
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Internal server error
 */
router.post('/preview',authenticateToken,roleAuthorization(['CUSTOMER']),previewPromoCode);

module.exports = router;
