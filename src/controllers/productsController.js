require('dotenv').config();
const connection = require('../config/databaseConnection');

// SF 1.1 Add Product
exports.addProduct = async (req, res) => {
    const db = connection.promise();

    try {

        const { name, description, sku, price, category, stock_qty } = req.body;
        const owner_user_id = req.user?.user_id;

        if (!name || !description || !sku || !price || !category || !stock_qty) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const checkUserQuery = 
        `INSERT INTO products (salon_id, name, description, sku, price, category, stock_qty, created_at, updated_at)
        VALUES ((SELECT salon_id FROM salons WHERE owner_user_id = ?), ?, ?, ?, ?, ?, ?, NOW(), NOW());`;

        const [results] = await db.execute(checkUserQuery, [owner_user_id, name, description, sku, price, category, stock_qty]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Failed to add product' });
        }

        res.status(200).json({
            message: "Product added successfully"
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'SKU already exists' });
        }
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.1 Get Products
exports.getProducts = async (req, res) => {
    const db = connection.promise();

    try {

        const { salon_id } = req.params;

        if (!salon_id) {
            return res.status(400).json({ message: 'Salon ID is required' });
        }

        const getProductsQuery = 
        `SELECT product_id, name, description, sku, price, category, stock_qty FROM products WHERE salon_id = ?;`;

        const [results] = await db.execute(getProductsQuery, [salon_id]);

        if (results.length === 0) {
            return res.status(404).json({ message: 'No products found' });
        }

        res.status(200).json({
            products: results
        });

    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.1 Delete Product
exports.deleteProduct = async (req, res) => {
    const db = connection.promise();

    try {
        const { product_id } = req.params;
        const owner_user_id = req.user?.user_id;

        if (!product_id) {
            return res.status(400).json({ message: 'Product ID is required' });
        }

        const deleteProductQuery = 
        `DELETE FROM products WHERE product_id = ? AND salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?);`;

        const [results] = await db.execute(deleteProductQuery, [product_id, owner_user_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.status(200).json({
            message: "Product deleted successfully"
        });
    } catch (error) {
        console.error('deleteProduct error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.1 Update Product
exports.updateProduct = async (req, res) => {
    const db = connection.promise();

    try {
        const { product_id } = req.params;
        const { name, description, sku, price, category, stock_qty } = req.body;
        const owner_user_id = req.user?.user_id;

        if (!name || !description || !sku || !price || !category || !stock_qty) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const updateProductQuery = 
        `UPDATE products SET name = ?, description = ?, sku = ?, price = ?, category = ?, stock_qty = ? WHERE product_id = ? AND salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?);`;
        const [results] = await db.execute(updateProductQuery, [name, description, sku, price, category, stock_qty, product_id, owner_user_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found or SKU already exists.' });
        }

        res.status(200).json({
            message: "Product updated successfully"
        });

    } catch (error) {
        console.error('updateProduct error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.2 Add to Cart
exports.addToCart = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        const { salon_id, product_id, quantity } = req.body;
        let cart_id = null;

        if (!salon_id || !product_id || !quantity) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        if (quantity <= 0) {
            return res.status(400).json({ message: 'Quantity must be greater than 0' });
        }

        // Check if product exists in salon
        const checkProductExistsQuery = `SELECT product_id FROM products WHERE salon_id = ? AND product_id = ?`;
        const [productResults] = await db.execute(checkProductExistsQuery, [salon_id, product_id]);

        if (productResults.length === 0) {
            return res.status(404).json({ message: 'Product not found in this salon' });
        }

        // Check if cart exists
        const viewCartQuery = `SELECT cart_id FROM carts WHERE user_id = ? AND salon_id = ? AND status = ?`
        const [results] = await db.execute(viewCartQuery, [user_id, salon_id, 'ACTIVE']);

        if (results.length === 0) {

            const createCartQuery = `INSERT INTO carts (user_id, salon_id, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`;
            const [createResults] = await db.execute(createCartQuery, [user_id, salon_id, 'ACTIVE']);
            
            if (createResults.affectedRows === 0) {
                return res.status(404).json({ message: 'Failed to create cart' });
            }

            cart_id = createResults.insertId;
        }
        else {
            cart_id = results[0].cart_id;
        }

        // Verify stock availability for the requested addition
        const getStockQuery = `SELECT stock_qty FROM products WHERE salon_id = ? AND product_id = ?`;
        const [stockRows] = await db.execute(getStockQuery, [salon_id, product_id]);

        if (stockRows.length === 0) {
            return res.status(404).json({ message: 'Product not found in this salon' });
        }

        const stockQty = Number(stockRows[0].stock_qty) || 0;

        const getExistingQtyQuery = `SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?`;
        const [existingItemRows] = await db.execute(getExistingQtyQuery, [cart_id, product_id]);
        const existingQty = existingItemRows.length ? Number(existingItemRows[0].quantity) : 0;
        const requestedQty = Number(quantity) || 0;

        if (existingQty + requestedQty > stockQty) {
            const availableToAdd = Math.max(stockQty - existingQty, 0);
            return res.status(400).json({ message: `Insufficient stock. ${availableToAdd} left in stock`});
        }

        // Add Cart Item
        const addToCartQuery = `INSERT INTO cart_items (cart_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity);`;
        const [addToResults] = await db.execute(addToCartQuery, [cart_id, product_id, quantity]);
        
        if (addToResults.affectedRows === 0) {
            return res.status(404).json({ message: 'Failed to add to cart' });
        }

        res.status(200).json({
            message: "Product added to cart successfully"
        });

    } catch (error) {
        console.error('addToCart error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.2 View Cart
exports.viewCart = async (req, res) => {
    const db = connection.promise();

    try {
        const { salon_id } = req.params;
        const owner_user_id = req.user?.user_id;

        if (!salon_id || !owner_user_id) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const updateProductQuery = 
        `SELECT p.product_id, p.name, p.description, p.sku, p.price, p.category, p.stock_qty ,ci.quantity FROM cart_items ci JOIN products p ON p.product_id = ci.product_id WHERE cart_id = (SELECT cart_id FROM carts WHERE user_id = ? AND salon_id = ?);`;
        const [results] = await db.execute(updateProductQuery, [owner_user_id, salon_id]);

        if (results.length === 0) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        res.status(200).json({
            items: results
        });

    } catch (error) {
        console.error('updateProduct error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};