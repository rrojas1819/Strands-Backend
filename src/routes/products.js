const express = require('express');
const router = express.Router();
const { addProduct, getProducts, deleteProduct, updateProduct, addToCart, viewCart, removeFromCart, updateCart, checkout, viewUserOrders, viewSalonOrders } = require('../controllers/productsController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Add a new product to salon inventory
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
 *               - name
 *               - description
 *               - sku
 *               - price
 *               - category
 *               - stock_qty
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               sku:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               stock_qty:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Product added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product added successfully
 *       400:
 *         description: Missing required fields or invalid data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER role required
 *       404:
 *         description: Failed to add product
 *       409:
 *         description: SKU already exists
 *       500:
 *         description: Internal server error
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
 *         description: Products retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product_id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       sku:
 *                         type: string
 *                       price:
 *                         type: number
 *                       category:
 *                         type: string
 *                       stock_qty:
 *                         type: integer
 *       400:
 *         description: Salon ID is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER or OWNER role required
 *       404:
 *         description: No products found
 *       500:
 *         description: Internal server error
 */
router.get('/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER','OWNER']), getProducts);

/**
 * @swagger
 * /api/products/{product_id}:
 *   delete:
 *     summary: Delete a product
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product deleted successfully
 *       400:
 *         description: Product ID is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER role required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:product_id', authenticateToken, roleAuthorization(['OWNER']), deleteProduct);

/**
 * @swagger
 * /api/products/{product_id}:
 *   patch:
 *     summary: Update a product
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
 *             required:
 *               - name
 *               - description
 *               - sku
 *               - price
 *               - category
 *               - stock_qty
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               sku:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               stock_qty:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product updated successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER role required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
router.patch('/:product_id', authenticateToken, roleAuthorization(['OWNER']), updateProduct);

/**
 * @swagger
 * /api/products/customer/add-to-cart:
 *   post:
 *     summary: Add product to shopping cart
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
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Product added to cart successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product added to cart successfully
 *       400:
 *         description: Missing required fields, invalid quantity, or insufficient stock
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Product not found in salon
 *       500:
 *         description: Internal server error
 */
router.post('/customer/add-to-cart', authenticateToken, roleAuthorization(['CUSTOMER']), addToCart);

/**
 * @swagger
 * /api/products/customer/view-cart/{salon_id}:
 *   get:
 *     summary: View shopping cart for a salon
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
 *         description: Cart retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product_id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       sku:
 *                         type: string
 *                       price:
 *                         type: number
 *                       category:
 *                         type: string
 *                       stock_qty:
 *                         type: integer
 *                       quantity:
 *                         type: integer
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Cart not found
 *       500:
 *         description: Internal server error
 */
router.get('/customer/view-cart/:salon_id', authenticateToken, roleAuthorization(['CUSTOMER']), viewCart);

/**
 * @swagger
 * /api/products/customer/remove-from-cart:
 *   delete:
 *     summary: Remove product from cart
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
 *             properties:
 *               salon_id:
 *                 type: integer
 *               product_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Product removed from cart
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product deleted successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
router.delete('/customer/remove-from-cart', authenticateToken, roleAuthorization(['CUSTOMER']), removeFromCart);

/**
 * @swagger
 * /api/products/customer/update-cart:
 *   patch:
 *     summary: Update cart item quantity
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
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Cart updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product updated successfully
 *       400:
 *         description: Missing required fields or invalid quantity
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
router.patch('/customer/update-cart', authenticateToken, roleAuthorization(['CUSTOMER']), updateCart);

/**
 * @swagger
 * /api/products/customer/checkout:
 *   post:
 *     summary: Checkout and process payment for cart
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
 *               - credit_card_id
 *               - billing_address_id
 *             properties:
 *               salon_id:
 *                 type: integer
 *               credit_card_id:
 *                 type: integer
 *               billing_address_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Checkout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Payment processed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     payment_id:
 *                       type: integer
 *                     amount:
 *                       type: number
 *       400:
 *         description: Missing required fields or insufficient stock
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: Cart, credit card, or billing address not found
 *       500:
 *         description: Internal server error
 */
router.post('/customer/checkout', authenticateToken, roleAuthorization(['CUSTOMER']), checkout);

/**
 * @swagger
 * /api/products/customer/view-orders:
 *   post:
 *     summary: View customer orders with pagination
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
 *               - limit
 *               - offset
 *             properties:
 *               salon_id:
 *                 type: integer
 *                 description: Optional filter by salon
 *               limit:
 *                 type: integer
 *               offset:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Orders retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orders:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       salon_name:
 *                         type: string
 *                       order_code:
 *                         type: string
 *                       subtotal_order_price:
 *                         type: number
 *                       order_tax:
 *                         type: number
 *                       total_order_price:
 *                         type: number
 *                       name:
 *                         type: string
 *                       quantity:
 *                         type: integer
 *                       ordered_date:
 *                         type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     total_orders:
 *                       type: integer
 *                     has_next_page:
 *                       type: boolean
 *                     has_prev_page:
 *                       type: boolean
 *       400:
 *         description: Invalid fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CUSTOMER role required
 *       404:
 *         description: No orders found
 *       500:
 *         description: Internal server error
 */
router.post('/customer/view-orders', authenticateToken, roleAuthorization(['CUSTOMER']), viewUserOrders);

/**
 * @swagger
 * /api/products/owner/view-orders:
 *   post:
 *     summary: View salon orders (owner)
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
 *               - limit
 *               - offset
 *             properties:
 *               limit:
 *                 type: integer
 *               offset:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Salon orders retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orders:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       customer_name:
 *                         type: string
 *                       order_code:
 *                         type: string
 *                       subtotal_order_price:
 *                         type: number
 *                       order_tax:
 *                         type: number
 *                       total_order_price:
 *                         type: number
 *                       name:
 *                         type: string
 *                       quantity:
 *                         type: integer
 *                       ordered_date:
 *                         type: string
 *                 pagination:
 *                   type: object
 *       400:
 *         description: Invalid fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER role required
 *       500:
 *         description: No orders found or internal error
 */
router.post('/owner/view-orders', authenticateToken, roleAuthorization(['OWNER']), viewSalonOrders);

module.exports = router;
