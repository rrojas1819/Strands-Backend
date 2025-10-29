const express = require('express');
const router = express.Router();
const { addProduct, getProducts, deleteProduct, updateProduct } = require('../controllers/productsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

//SF 1.1 Owner Shop
router.post('/', authenticateToken, roleAuthorization(['OWNER']), addProduct);
router.get('/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER','OWNER']), getProducts);
router.delete('/:product_id', authenticateToken, roleAuthorization(['OWNER']), deleteProduct);
router.patch('/:product_id', authenticateToken, roleAuthorization(['OWNER']), updateProduct);


module.exports = router;