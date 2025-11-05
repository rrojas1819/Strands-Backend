const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

//UPH 1.3 as a user (customer) I want to leave reviews for salons
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.createReview);
router.patch('/update/:review_id', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.updateReview);
router.delete('/delete/:review_id', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.deleteReview);

//listing all reviews for a salon
router.get('/salon/:salon_id/all', authenticateToken, roleAuthorization(['CUSTOMER','OWNER','EMPLOYEE']), reviewController.listSalonReviews);

//getting an individual customer's salon review for updating purposes
router.get('/salon/:salon_id/myReview', authenticateToken, roleAuthorization(['CUSTOMER']), reviewController.getMyReviewForSalon);

//UPH 1.4 as an owner I want to reply to reviews for my salon
router.post('/replies/create', authenticateToken, roleAuthorization(['OWNER']), reviewController.createReply);
router.patch('/replies/update/:reply_id', authenticateToken, roleAuthorization(['OWNER']), reviewController.updateReply);
router.delete('/replies/delete/:reply_id', authenticateToken, roleAuthorization(['OWNER']), reviewController.deleteReply);

module.exports = router;