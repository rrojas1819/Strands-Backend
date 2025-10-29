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