const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/reviews/create:
 *   post:
 *     summary: Create a salon review (Customer)
 *     tags: [Reviews]
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
 *               - rating
 *             properties:
 *               salon_id:
 *                 type: integer
 *               rating:
 *                 type: integer
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Review created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.createReview);

/**
 * @swagger
 * /api/reviews/update/{review_id}:
 *   patch:
 *     summary: Update a salon review (Customer)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: review_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: integer
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Review updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.patch('/update/:review_id', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.updateReview);

/**
 * @swagger
 * /api/reviews/delete/{review_id}:
 *   delete:
 *     summary: Delete a salon review (Customer)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: review_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Review deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.delete('/delete/:review_id', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.deleteReview);

/**
 * @swagger
 * /api/reviews/salon/{salon_id}/all:
 *   get:
 *     summary: List all reviews for a salon
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Salon reviews retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer, Owner, or Employee role required
 */
router.get('/salon/:salon_id/all', authenticateToken, roleAuthorization(['CUSTOMER','OWNER','EMPLOYEE']), reviewController.listSalonReviews);

/**
 * @swagger
 * /api/reviews/salon/{salon_id}/myReview:
 *   get:
 *     summary: Get customer's review for a salon
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Customer review retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/salon/:salon_id/myReview', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.getMyReviewForSalon);

/**
 * @swagger
 * /api/reviews/replies/create:
 *   post:
 *     summary: Create a reply to a review (Owner)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - review_id
 *               - reply_text
 *             properties:
 *               review_id:
 *                 type: integer
 *               reply_text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reply created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/replies/create', authenticateToken, roleAuthorization(['OWNER']), reviewController.createReply);

/**
 * @swagger
 * /api/reviews/replies/update/{reply_id}:
 *   patch:
 *     summary: Update a reply to a review (Owner)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reply_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reply_text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reply updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.patch('/replies/update/:reply_id', authenticateToken, roleAuthorization(['OWNER']), reviewController.updateReply);

/**
 * @swagger
 * /api/reviews/replies/delete/{reply_id}:
 *   delete:
 *     summary: Delete a reply to a review (Owner)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reply_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Reply deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.delete('/replies/delete/:reply_id', authenticateToken, roleAuthorization(['OWNER']), reviewController.deleteReply);

module.exports = router;
