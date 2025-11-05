const express = require('express');
const router = express.Router();
const staffReviewController = require('../controllers/staffReviewController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

//UPH 1.5 as a user (customer) I want to leave reviews for specific staff members
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.createStaffReview);
router.patch('/update/:staff_review_id', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.updateStaffReview);
router.delete('/delete/:staff_review_id', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.deleteStaffReview);

//listing all reviews and replies for an employee
router.get('/employee/:employee_id/all', authenticateToken, roleAuthorization(['CUSTOMER', 'EMPLOYEE', 'OWNER']), staffReviewController.listEmployeeReviews);

//getting an individual customer's employee review for updating purposes
router.get('/employee/:employee_id/myReview', authenticateToken, roleAuthorization(['CUSTOMER']), staffReviewController.getMyStaffReviewForEmployee);

//UPH 1.51 as an employee I want to reply to reviews made about me
router.post('/replies/create', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.createStaffReply);
router.patch('/replies/update/:staff_reply_id', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.updateStaffReply);
router.delete('/replies/delete/:staff_reply_id', authenticateToken, roleAuthorization(['EMPLOYEE']), staffReviewController.deleteStaffReply);

//UPH 1.52 as an owner I want to see reviews and replies for all of my staff
router.get('/owner/all', authenticateToken, roleAuthorization(['OWNER']), staffReviewController.listOwnerStaffReviews);

module.exports = router;