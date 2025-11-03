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

module.exports = router;