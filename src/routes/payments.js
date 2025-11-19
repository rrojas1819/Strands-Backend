const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/payments/process:
 *   post:
 *     summary: Process payment
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
 *               - booking_id
 *               - amount
 *             properties:
 *               booking_id:
 *                 type: integer
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Payment processed successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/process', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.processPayment);

/**
 * @swagger
 * /api/payments/availableRewards:
 *   post:
 *     summary: Get available rewards for a salon
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
 *         description: Available rewards retrieved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/availableRewards', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getAvailableRewards);

/**
 * @swagger
 * /api/payments/saveCreditCard:
 *   post:
 *     summary: Save credit card (Customer)
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
 *               - expiry_date
 *               - cvv
 *             properties:
 *               card_number:
 *                 type: string
 *               expiry_date:
 *                 type: string
 *               cvv:
 *                 type: string
 *     responses:
 *       200:
 *         description: Credit card saved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/saveCreditCard', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.saveCreditCard);

/**
 * @swagger
 * /api/payments/saveTempCreditCard:
 *   post:
 *     summary: Save temporary credit card (Customer)
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
 *               - expiry_date
 *               - cvv
 *             properties:
 *               card_number:
 *                 type: string
 *               expiry_date:
 *                 type: string
 *               cvv:
 *                 type: string
 *     responses:
 *       200:
 *         description: Temporary credit card saved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/saveTempCreditCard', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.saveTempCreditCard);

/**
 * @swagger
 * /api/payments/getCreditCards:
 *   get:
 *     summary: Get saved credit cards (Customer)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Credit cards retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/getCreditCards', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getCreditCards);

/**
 * @swagger
 * /api/payments/deleteCreditCard/{credit_card_id}:
 *   delete:
 *     summary: Delete credit card (Customer)
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
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.delete('/deleteCreditCard/:credit_card_id', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.deleteCreditCard);

/**
 * @swagger
 * /api/payments/createBillingAddress:
 *   post:
 *     summary: Create billing address (Customer)
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
 *               - street_address
 *               - city
 *               - state
 *               - zip_code
 *             properties:
 *               street_address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Billing address created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/createBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.createBillingAddress);

/**
 * @swagger
 * /api/payments/getBillingAddress:
 *   get:
 *     summary: Get billing address (Customer)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing address retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/getBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.getBillingAddress);

/**
 * @swagger
 * /api/payments/updateBillingAddress:
 *   put:
 *     summary: Update billing address (Customer)
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
 *               street_address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Billing address updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.put('/updateBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.updateBillingAddress);

/**
 * @swagger
 * /api/payments/deleteBillingAddress:
 *   delete:
 *     summary: Delete billing address (Customer)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing address deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.delete('/deleteBillingAddress', authenticateToken, roleAuthorization(['CUSTOMER']), paymentController.deleteBillingAddress);

module.exports = router;
