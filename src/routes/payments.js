const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/payments/process:
 *   post:
 *     summary: Process a payment for booking or order
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credit_card_id
 *               - billing_address_id
 *               - amount
 *             properties:
 *               credit_card_id:
 *                 type: integer
 *               billing_address_id:
 *                 type: integer
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *               booking_id:
 *                 type: integer
 *                 description: Required if no order_id. Exactly one must be provided.
 *               order_id:
 *                 type: integer
 *                 description: Required if no booking_id. Exactly one must be provided.
 *               use_loyalty_discount:
 *                 type: boolean
 *                 default: false
 *               reward_id:
 *                 type: integer
 *                 description: Required if use_loyalty_discount is true
 *               promo_code:
 *                 type: string
 *                 description: Cannot be used with loyalty discount
 *     responses:
 *       200:
 *         description: Payment processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Payment processed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     payment_id:
 *                       type: integer
 *                     amount:
 *                       type: number
 *                     original_amount:
 *                       type: number
 *                     discount_applied:
 *                       type: boolean
 *                     discount_type:
 *                       type: string
 *                       enum: [loyalty, promo_code]
 *                     promo_code:
 *                       type: string
 *                     promo_discount_pct:
 *                       type: number
 *                     booking_status_updated:
 *                       type: boolean
 *       400:
 *         description: Bad request - missing fields, invalid amount, or cannot use both discounts
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden or booking doesn't belong to user
 *       404:
 *         description: Credit card, billing address, or booking not found
 *       500:
 *         description: Internal server error
 */
router.post('/process', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.processPayment);

/**
 * @swagger
 * /api/payments/availableRewards:
 *   post:
 *     summary: Get available loyalty rewards for a salon
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - salon_id
 *             properties:
 *               salon_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Available rewards retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rewards:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       reward_id:
 *                         type: integer
 *                       discount_percentage:
 *                         type: number
 *                       note:
 *                         type: string
 *                       creationDate:
 *                         type: string
 *                 loyalty_program:
 *                   type: object
 *                   properties:
 *                     target_visits:
 *                       type: integer
 *                     discount_percentage:
 *                       type: number
 *                     note:
 *                       type: string
 *                 total_available:
 *                   type: integer
 *       400:
 *         description: salon_id is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       500:
 *         description: Internal server error
 */
router.post('/availableRewards', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getAvailableRewards);

/**
 * @swagger
 * /api/payments/saveCreditCard:
 *   post:
 *     summary: Save a credit card permanently
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - card_number
 *               - cvc
 *               - exp_month
 *               - exp_year
 *               - billing_address_id
 *             properties:
 *               card_number:
 *                 type: string
 *               cvc:
 *                 type: string
 *               exp_month:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 12
 *               exp_year:
 *                 type: integer
 *               billing_address_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Credit card saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Credit card saved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     credit_card_id:
 *                       type: integer
 *                     brand:
 *                       type: string
 *                       example: VISA
 *                     last4:
 *                       type: string
 *                     exp_month:
 *                       type: integer
 *                     exp_year:
 *                       type: integer
 *                     is_temporary:
 *                       type: boolean
 *       400:
 *         description: Bad request - invalid card, expired, or already saved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Billing address not found
 *       500:
 *         description: Internal server error
 */
router.post('/saveCreditCard', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.saveCreditCard);

/**
 * @swagger
 * /api/payments/saveTempCreditCard:
 *   post:
 *     summary: Save a temporary credit card for immediate use
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - card_number
 *               - cvc
 *               - exp_month
 *               - exp_year
 *               - billing_address_id
 *             properties:
 *               card_number:
 *                 type: string
 *               cvc:
 *                 type: string
 *               exp_month:
 *                 type: integer
 *               exp_year:
 *                 type: integer
 *               billing_address_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Temporary credit card ready for payment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Credit card ready for payment
 *                 data:
 *                   type: object
 *                   properties:
 *                     credit_card_id:
 *                       type: integer
 *                     brand:
 *                       type: string
 *                     last4:
 *                       type: string
 *                     is_temporary:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: Bad request - invalid card or already have permanent card
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Billing address not found
 *       500:
 *         description: Internal server error
 */
router.post('/saveTempCreditCard', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.saveTempCreditCard);

/**
 * @swagger
 * /api/payments/getCreditCards:
 *   get:
 *     summary: Get saved credit cards (permanent only)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Credit cards retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 credit_cards:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       credit_card_id:
 *                         type: integer
 *                       brand:
 *                         type: string
 *                       last4:
 *                         type: string
 *                       pan_length:
 *                         type: integer
 *                       exp_month:
 *                         type: integer
 *                       exp_year:
 *                         type: integer
 *                       masked_pan:
 *                         type: string
 *                         example: "************1234"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       500:
 *         description: Internal server error
 */
router.get('/getCreditCards', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getCreditCards);

/**
 * @swagger
 * /api/payments/deleteCreditCard/{credit_card_id}:
 *   delete:
 *     summary: Delete a credit card
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: credit_card_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Credit card deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Credit card deleted successfully
 *       400:
 *         description: Credit card ID is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Credit card not found
 *       500:
 *         description: Internal server error
 */
router.delete('/deleteCreditCard/:credit_card_id', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.deleteCreditCard);

/**
 * @swagger
 * /api/payments/createBillingAddress:
 *   post:
 *     summary: Create billing address (one per user)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - full_name
 *               - address_line1
 *               - city
 *               - state
 *               - postal_code
 *               - country
 *             properties:
 *               full_name:
 *                 type: string
 *               address_line1:
 *                 type: string
 *               address_line2:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               postal_code:
 *                 type: string
 *               country:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Billing address created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Billing address created successfully
 *       400:
 *         description: Missing required fields, invalid city/postal code, or already exists
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       500:
 *         description: Internal server error
 */
router.post('/createBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.createBillingAddress);

/**
 * @swagger
 * /api/payments/getBillingAddress:
 *   get:
 *     summary: Get user's billing address
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing address retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 billing_address:
 *                   type: object
 *                   properties:
 *                     billing_address_id:
 *                       type: integer
 *                     full_name:
 *                       type: string
 *                     address_line1:
 *                       type: string
 *                     address_line2:
 *                       type: string
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     postal_code:
 *                       type: string
 *                     country:
 *                       type: string
 *                     phone:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Billing address not found
 *       500:
 *         description: Internal server error
 */
router.get('/getBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getBillingAddress);

/**
 * @swagger
 * /api/payments/updateBillingAddress:
 *   put:
 *     summary: Update billing address
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *               address_line1:
 *                 type: string
 *               address_line2:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               postal_code:
 *                 type: string
 *               country:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Billing address updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Billing address updated successfully
 *                 data:
 *                   type: object
 *       400:
 *         description: At least one field must be provided or invalid data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Billing address not found
 *       500:
 *         description: Internal server error
 */
router.put('/updateBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.updateBillingAddress);

/**
 * @swagger
 * /api/payments/deleteBillingAddress:
 *   delete:
 *     summary: Delete billing address
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing address deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Billing address deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Billing address not found
 *       500:
 *         description: Internal server error
 */
router.delete('/deleteBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.deleteBillingAddress);

module.exports = router;
