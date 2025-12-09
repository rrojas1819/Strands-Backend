const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/reviews/create:
 *   post:
 *     summary: Create a salon review
 *     description: Customer creates a review for a salon after a completed visit
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
 *                 description: The salon to review
 *               rating:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 5
 *                 description: Rating from 0 to 5
 *               message:
 *                 type: string
 *                 description: Optional review message
 *     responses:
 *       201:
 *         description: Review created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Review created
 *                 data:
 *                   type: object
 *                   properties:
 *                     review_id:
 *                       type: integer
 *                     salon_id:
 *                       type: integer
 *                     user:
 *                       type: object
 *                       properties:
 *                         user_id:
 *                           type: integer
 *                         name:
 *                           type: string
 *                     rating:
 *                       type: number
 *                     message:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *       400:
 *         description: Invalid salon_id or rating
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Must have completed visit to review
 *       404:
 *         description: Salon not found
 *       409:
 *         description: Already reviewed this salon
 *       500:
 *         description: Internal server error
 */
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.createReview);

/**
 * @swagger
 * /api/reviews/update/{review_id}:
 *   patch:
 *     summary: Update a review
 *     description: Customer updates their own review
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
 *                 type: number
 *                 minimum: 0
 *                 maximum: 5
 *                 description: Rating from 0 to 5
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Review updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Review updated
 *                 data:
 *                   type: object
 *                   properties:
 *                     review_id:
 *                       type: integer
 *                     salon_id:
 *                       type: integer
 *                     user:
 *                       type: object
 *                       properties:
 *                         user_id:
 *                           type: integer
 *                         name:
 *                           type: string
 *                     rating:
 *                       type: number
 *                     message:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *       400:
 *         description: Invalid review_id or rating
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Review not found
 *       500:
 *         description: Internal server error
 */
router.patch('/update/:review_id', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.updateReview);

/**
 * @swagger
 * /api/reviews/delete/{review_id}:
 *   delete:
 *     summary: Delete a review
 *     description: Customer deletes their own review
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Review deleted
 *       400:
 *         description: Invalid review_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Review not found
 *       500:
 *         description: Internal server error
 */
router.delete('/delete/:review_id', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.deleteReview);

/**
 * @swagger
 * /api/reviews/salon/{salon_id}/all:
 *   get:
 *     summary: List all reviews for a salon
 *     description: Get paginated reviews for a salon with average rating metrics
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Reviews retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       review_id:
 *                         type: integer
 *                       rating:
 *                         type: number
 *                       message:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *                       user:
 *                         type: object
 *                         properties:
 *                           user_id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                       reply:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           reply_id:
 *                             type: integer
 *                           message:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                           updated_at:
 *                             type: string
 *                           user:
 *                             type: object
 *                             properties:
 *                               user_id:
 *                                 type: integer
 *                               name:
 *                                 type: string
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of reviews
 *                     avg_rating:
 *                       type: number
 *                       nullable: true
 *                       description: Average rating for the salon
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       400:
 *         description: Invalid salon_id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.get('/salon/:salon_id/all', authenticateToken, roleAuthorization(['CUSTOMER','OWNER','EMPLOYEE']), reviewController.listSalonReviews);

/**
 * @swagger
 * /api/reviews/salon/{salon_id}/myReview:
 *   get:
 *     summary: Get my review for a salon
 *     description: Customer gets their own review for a specific salon
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
 *         description: Review retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     review_id:
 *                       type: integer
 *                     rating:
 *                       type: number
 *                     message:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *       400:
 *         description: Invalid salon_id
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/salon/:salon_id/myReview', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.getMyReviewForSalon);

/**
 * @swagger
 * /api/reviews/replies/create:
 *   post:
 *     summary: Create a reply to a review (owner)
 *     description: Salon owner creates a reply to a customer review
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
 *               - message
 *             properties:
 *               review_id:
 *                 type: integer
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Reply created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Reply created
 *                 data:
 *                   type: object
 *                   properties:
 *                     reply_id:
 *                       type: integer
 *                     review_id:
 *                       type: integer
 *                     message:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *                     user:
 *                       type: object
 *                       properties:
 *                         user_id:
 *                           type: integer
 *                         name:
 *                           type: string
 *       400:
 *         description: Invalid review_id or message
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Can only reply to reviews for your own salon
 *       404:
 *         description: Review not found
 *       409:
 *         description: Reply already exists for this review
 *       500:
 *         description: Internal server error
 */
router.post('/replies/create', authenticateToken, roleAuthorization(['OWNER']), reviewController.createReply);

/**
 * @swagger
 * /api/reviews/replies/update/{reply_id}:
 *   patch:
 *     summary: Update a reply (owner)
 *     description: Salon owner updates their reply to a review
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
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Reply updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Reply updated
 *                 data:
 *                   type: object
 *                   properties:
 *                     reply_id:
 *                       type: integer
 *                     review_id:
 *                       type: integer
 *                     message:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *                     user:
 *                       type: object
 *                       properties:
 *                         user_id:
 *                           type: integer
 *                         name:
 *                           type: string
 *       400:
 *         description: Invalid reply_id or message
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Can only update your own salon reply
 *       404:
 *         description: Reply not found
 *       500:
 *         description: Internal server error
 */
router.patch('/replies/update/:reply_id', authenticateToken, roleAuthorization(['OWNER']), reviewController.updateReply);

/**
 * @swagger
 * /api/reviews/replies/delete/{reply_id}:
 *   delete:
 *     summary: Delete a reply (owner)
 *     description: Salon owner deletes their reply to a review
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Reply deleted
 *       400:
 *         description: Invalid reply_id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Can only delete your own salon reply
 *       404:
 *         description: Reply not found
 *       500:
 *         description: Internal server error
 */
router.delete('/replies/delete/:reply_id', authenticateToken, roleAuthorization(['OWNER']), reviewController.deleteReply);

module.exports = router;
