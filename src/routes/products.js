const express = require('express');
const router = express.Router();
const { addProduct, getProducts, deleteProduct, updateProduct, addToCart, viewCart, removeFromCart } = require('../controllers/productsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

//SF 1.1 Owner Shop
router.post('/', authenticateToken, roleAuthorization(['OWNER']), addProduct);
router.get('/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER','OWNER']), getProducts);
router.delete('/:product_id', authenticateToken, roleAuthorization(['OWNER']), deleteProduct);
router.patch('/:product_id', authenticateToken, roleAuthorization(['OWNER']), updateProduct);

// SF 1.2 Customer Shop
router.post('/customer/add-to-cart', authenticateToken, roleAuthorization(['CUSTOMER']), addToCart);
router.get('/customer/view-cart/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER']), viewCart);
router.delete('/customer/remove-from-cart', authenticateToken, roleAuthorization(['CUSTOMER']), removeFromCart);

module.exports = router;