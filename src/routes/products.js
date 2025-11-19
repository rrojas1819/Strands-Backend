const express = require('express');
const router = express.Router();
const { addProduct, getProducts, deleteProduct, updateProduct, addToCart, viewCart, removeFromCart, updateCart, checkout, viewUserOrders, viewSalonOrders } = require('../controllers/productsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Add a product to salon shop (Owner)
 *     tags: [Products]
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
 *               - product_name
 *               - price
 *             properties:
 *               salon_id:
 *                 type: integer
 *               product_name:
 *                 type: string
 *               price:
 *                 type: number
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product added successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/', authenticateToken, roleAuthorization(['OWNER']), addProduct);

/**
 * @swagger
 * /api/products/{salon_id}:
 *   get:
 *     summary: Get products for a salon
 *     tags: [Products]
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
 *         description: Products retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer or Owner role required
 */
router.get('/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER','OWNER']), getProducts);

/**
 * @swagger
 * /api/products/{product_id}:
 *   delete:
 *     summary: Delete a product (Owner)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: product_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.delete('/:product_id', authenticateToken, roleAuthorization(['OWNER']), deleteProduct);

/**
 * @swagger
 * /api/products/{product_id}:
 *   patch:
 *     summary: Update a product (Owner)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: product_id
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
 *               product_name:
 *                 type: string
 *               price:
 *                 type: number
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.patch('/:product_id', authenticateToken, roleAuthorization(['OWNER']), updateProduct);

/**
 * @swagger
 * /api/products/customer/add-to-cart:
 *   post:
 *     summary: Add product to cart (Customer)
 *     tags: [Products]
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
 *               - product_id
 *               - quantity
 *             properties:
 *               salon_id:
 *                 type: integer
 *               product_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Product added to cart successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/customer/add-to-cart', authenticateToken, roleAuthorization(['CUSTOMER']), addToCart);

/**
 * @swagger
 * /api/products/customer/view-cart/{salon_id}:
 *   get:
 *     summary: View cart for a salon (Customer)
 *     tags: [Products]
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
 *         description: Cart retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/customer/view-cart/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER']), viewCart);

/**
 * @swagger
 * /api/products/customer/remove-from-cart:
 *   delete:
 *     summary: Remove product from cart (Customer)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cart_item_id
 *             properties:
 *               cart_item_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Product removed from cart successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.delete('/customer/remove-from-cart', authenticateToken, roleAuthorization(['CUSTOMER']), removeFromCart);

/**
 * @swagger
 * /api/products/customer/update-cart:
 *   patch:
 *     summary: Update cart item quantity (Customer)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cart_item_id
 *               - quantity
 *             properties:
 *               cart_item_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Cart updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.patch('/customer/update-cart', authenticateToken, roleAuthorization(['CUSTOMER']), updateCart);

/**
 * @swagger
 * /api/products/customer/checkout:
 *   post:
 *     summary: Checkout cart (Customer)
 *     tags: [Products]
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
 *             properties:
 *               salon_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Checkout successful
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/customer/checkout', authenticateToken, roleAuthorization(['CUSTOMER']), checkout);

/**
 * @swagger
 * /api/products/customer/view-orders:
 *   post:
 *     summary: View user orders (Customer)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Orders retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/customer/view-orders', authenticateToken, roleAuthorization(['CUSTOMER']), viewUserOrders);

/**
 * @swagger
 * /api/products/owner/view-orders:
 *   post:
 *     summary: View salon orders (Owner)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Orders retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/owner/view-orders', authenticateToken, roleAuthorization(['OWNER']), viewSalonOrders);

module.exports = router;
