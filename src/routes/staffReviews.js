const express = require('express');
const router = express.Router();
const staffReviewController = require('../controllers/staffReviewController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/staff-reviews/create:
 *   post:
 *     summary: Create a staff review (Customer)
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
 *                 type: integer
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Staff review created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.createStaffReview);

/**
 * @swagger
 * /api/staff-reviews/update/{staff_review_id}:
 *   patch:
 *     summary: Update a staff review (Customer)
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
 *                 type: integer
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Staff review updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.patch('/update/:staff_review_id', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.updateStaffReview);

/**
 * @swagger
 * /api/staff-reviews/delete/{staff_review_id}:
 *   delete:
 *     summary: Delete a staff review (Customer)
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
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.delete('/delete/:staff_review_id', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.deleteStaffReview);

/**
 * @swagger
 * /api/staff-reviews/employee/{employee_id}/all:
 *   get:
 *     summary: List all reviews and replies for an employee
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
 *         description: Employee reviews retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer, Employee, or Owner role required
 */
router.get('/employee/:employee_id/all', authenticateToken, roleAuthorization(['CUSTOMER', 'EMPLOYEE', 'OWNER']), staffReviewController.listEmployeeReviews);

/**
 * @swagger
 * /api/staff-reviews/employee/{employee_id}/myReview:
 *   get:
 *     summary: Get customer's staff review for an employee
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
 *         description: Customer staff review retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/employee/:employee_id/myReview', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.getMyStaffReviewForEmployee);

/**
 * @swagger
 * /api/staff-reviews/replies/create:
 *   post:
 *     summary: Create a reply to a staff review (Employee)
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
 *               - reply_text
 *             properties:
 *               staff_review_id:
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
 *         description: Forbidden - Employee role required
 */
router.post('/replies/create', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.createStaffReply);

/**
 * @swagger
 * /api/staff-reviews/replies/update/{staff_reply_id}:
 *   patch:
 *     summary: Update a reply to a staff review (Employee)
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
 *         description: Forbidden - Employee role required
 */
router.patch('/replies/update/:staff_reply_id', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.updateStaffReply);

/**
 * @swagger
 * /api/staff-reviews/replies/delete/{staff_reply_id}:
 *   delete:
 *     summary: Delete a reply to a staff review (Employee)
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
 *         description: Reply deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.delete('/replies/delete/:staff_reply_id', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.deleteStaffReply);

/**
 * @swagger
 * /api/staff-reviews/owner/all:
 *   get:
 *     summary: List reviews and replies for all staff (Owner)
 *     tags: [Staff Reviews]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Owner staff reviews retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/owner/all', authenticateToken, roleAuthorization(['OWNER']), staffReviewController.listOwnerStaffReviews);

module.exports = router;
