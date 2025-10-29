const express = require('express');
const router = express.Router();
const { addProduct } = require('../controllers/productsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

//SF 1.1 Owner Shop
router.post('/', authenticateToken, roleAuthorization(['OWNER']), addProduct);

module.exports = router;