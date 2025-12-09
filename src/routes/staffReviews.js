const express = require('express');
const router = express.Router();
const staffReviewController = require('../controllers/staffReviewController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/staff-reviews/create:
 *   post:
 *     summary: Create a staff review
 *     description: Customer creates a review for a staff member after a completed service
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - employee_id
 *               - rating
 *             properties:
 *               employee_id:
 *                 type: integer
 *               rating:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 5
 *                 description: Rating from 0.0 to 5.0 in 0.5 steps
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Staff review created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Staff review created
 *                 data:
 *                   type: object
 *                   properties:
 *                     staff_review_id:
 *                       type: integer
 *                     employee_id:
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
 *         description: Invalid employee_id or rating
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Must have completed service to review
 *       404:
 *         description: Employee not found
 *       409:
 *         description: Already reviewed this stylist
 *       500:
 *         description: Internal server error
 */
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.createStaffReview);

/**
 * @swagger
 * /api/staff-reviews/update/{staff_review_id}:
 *   patch:
 *     summary: Update a staff review
 *     description: Customer updates their own staff review
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staff_review_id
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
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Staff review updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Staff review updated
 *                 data:
 *                   type: object
 *                   properties:
 *                     staff_review_id:
 *                       type: integer
 *                     employee_id:
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
 *         description: Invalid staff_review_id or rating
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Staff review not found
 *       500:
 *         description: Internal server error
 */
router.patch('/update/:staff_review_id', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.updateStaffReview);

/**
 * @swagger
 * /api/staff-reviews/delete/{staff_review_id}:
 *   delete:
 *     summary: Delete a staff review
 *     description: Customer deletes their own staff review
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staff_review_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Staff review deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Staff review deleted
 *       400:
 *         description: Invalid staff_review_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Staff review not found
 *       500:
 *         description: Internal server error
 */
router.delete('/delete/:staff_review_id', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.deleteStaffReview);

/**
 * @swagger
 * /api/staff-reviews/employee/{employee_id}/all:
 *   get:
 *     summary: List all reviews for an employee
 *     description: Get paginated reviews for an employee with average rating metrics
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employee_id
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
 *         description: Employee reviews retrieved successfully
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
 *                       staff_review_id:
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
 *                           staff_reply_id:
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
 *                       description: Average rating for the employee
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       400:
 *         description: Invalid employee_id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/employee/:employee_id/all', authenticateToken, roleAuthorization(['CUSTOMER', 'EMPLOYEE', 'OWNER']), staffReviewController.listEmployeeReviews);

/**
 * @swagger
 * /api/staff-reviews/employee/{employee_id}/myReview:
 *   get:
 *     summary: Get my review for an employee
 *     description: Customer gets their own review for a specific employee
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Staff review retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     staff_review_id:
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
 *         description: Invalid employee_id
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/employee/:employee_id/myReview', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.getMyStaffReviewForEmployee);

/**
 * @swagger
 * /api/staff-reviews/replies/create:
 *   post:
 *     summary: Create a reply to a staff review (employee)
 *     description: Employee creates a reply to a customer review about them
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - staff_review_id
 *               - message
 *             properties:
 *               staff_review_id:
 *                 type: integer
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Staff reply created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Staff reply created
 *                 data:
 *                   type: object
 *                   properties:
 *                     staff_reply_id:
 *                       type: integer
 *                     staff_review_id:
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
 *         description: Invalid staff_review_id or message
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Can only reply to reviews about you
 *       404:
 *         description: Staff review or employee profile not found
 *       409:
 *         description: Reply already exists for this staff review
 *       500:
 *         description: Internal server error
 */
router.post('/replies/create', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.createStaffReply);

/**
 * @swagger
 * /api/staff-reviews/replies/update/{staff_reply_id}:
 *   patch:
 *     summary: Update a staff reply (employee)
 *     description: Employee updates their reply to a staff review
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staff_reply_id
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
 *         description: Staff reply updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Staff reply updated
 *                 data:
 *                   type: object
 *                   properties:
 *                     staff_reply_id:
 *                       type: integer
 *                     staff_review_id:
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
 *         description: Invalid staff_reply_id or message
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Can only update your own reply
 *       404:
 *         description: Reply or employee profile not found
 *       500:
 *         description: Internal server error
 */
router.patch('/replies/update/:staff_reply_id', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.updateStaffReply);

/**
 * @swagger
 * /api/staff-reviews/replies/delete/{staff_reply_id}:
 *   delete:
 *     summary: Delete a staff reply (employee)
 *     description: Employee deletes their reply to a staff review
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staff_reply_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Staff reply deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Staff reply deleted
 *       400:
 *         description: Invalid staff_reply_id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Can only delete your own reply
 *       404:
 *         description: Reply or employee profile not found
 *       500:
 *         description: Internal server error
 */
router.delete('/replies/delete/:staff_reply_id', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.deleteStaffReply);

/**
 * @swagger
 * /api/staff-reviews/owner/all:
 *   get:
 *     summary: List all staff reviews for owner's salon
 *     description: Owner gets all staff reviews for employees at their salon with metrics
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *         description: Owner's staff reviews retrieved successfully
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
 *                       staff_review_id:
 *                         type: integer
 *                       employee:
 *                         type: object
 *                         properties:
 *                           employee_id:
 *                             type: integer
 *                           name:
 *                             type: string
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
 *                           staff_reply_id:
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
 *                       description: Total number of staff reviews
 *                     avg_rating:
 *                       type: number
 *                       nullable: true
 *                       description: Average rating across all staff
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/owner/all', authenticateToken, roleAuthorization(['OWNER']), staffReviewController.listOwnerStaffReviews);

module.exports = router;
