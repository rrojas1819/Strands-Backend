const connection = require('../config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../utils/utilies');
const { createNotification } = require('./notificationsController');

// SF 1.1 Add Product
exports.addProduct = async (req, res) => {
    const db = connection.promise();

    try {

        const { name, description, sku, price, category, stock_qty } = req.body;
        const owner_user_id = req.user?.user_id;

        if (!name || !description || !sku || !price || !category || !stock_qty) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const nowUtc = toMySQLUtc(DateTime.utc());
        const checkUserQuery = 
        `INSERT INTO products (salon_id, name, description, sku, price, category, stock_qty, created_at, updated_at)
        VALUES ((SELECT salon_id FROM salons WHERE owner_user_id = ?), ?, ?, ?, ?, ?, ?, ?, ?);`;

        const [results] = await db.execute(checkUserQuery, [owner_user_id, name, description, sku, price, category, stock_qty, nowUtc, nowUtc]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Failed to add product' });
        }

        const [[ownerInfo]] = await db.execute(
            `SELECT u.user_id, u.email, s.salon_id, s.name as salon_name
             FROM salons s
             JOIN users u ON s.owner_user_id = u.user_id
             WHERE s.owner_user_id = ?`,
            [owner_user_id]
        );

        if (ownerInfo) {
            try {
                await createNotification(db, {
                    user_id: ownerInfo.user_id,
                    salon_id: ownerInfo.salon_id,
                    product_id: results.insertId,
                    email: ownerInfo.email,
                    type_code: 'PRODUCT_ADDED',
                    message: `Product "${name}" has been successfully added to ${ownerInfo.salon_name}.`,
                    sender_email: 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send product added notification:', notifError);
            }
        }

        res.status(200).json({
            message: "Product added successfully"
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            console.error('addProduct error - duplicate SKU:', error);
            return res.status(409).json({ message: 'SKU already exists' });
        }
        console.error('addProduct error:', error);
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
        console.error('getProducts error:', error);
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

        const [[productInfo]] = await db.execute(
            `SELECT p.name, p.salon_id, s.owner_user_id, u.email, s.name as salon_name
             FROM products p
             JOIN salons s ON p.salon_id = s.salon_id
             JOIN users u ON s.owner_user_id = u.user_id
             WHERE p.product_id = ? AND s.owner_user_id = ?`,
            [product_id, owner_user_id]
        );

        const deleteProductQuery = 
        `DELETE FROM products WHERE product_id = ? AND salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?);`;

        const [results] = await db.execute(deleteProductQuery, [product_id, owner_user_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        if (productInfo) {
            try {
                await createNotification(db, {
                    user_id: productInfo.owner_user_id,
                    salon_id: productInfo.salon_id,
                    product_id: product_id,
                    email: productInfo.email,
                    type_code: 'PRODUCT_DELETED',
                    message: `Product "${productInfo.name}" has been deleted from ${productInfo.salon_name}.`,
                    sender_email: 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send product deleted notification:', notifError);
            }
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

        const [[oldProduct]] = await db.execute(
            `SELECT stock_qty, salon_id FROM products WHERE product_id = ? AND salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)`,
            [product_id, owner_user_id]
        );

        if (!oldProduct) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const updateProductQuery = 
        `UPDATE products SET name = ?, description = ?, sku = ?, price = ?, category = ?, stock_qty = ? WHERE product_id = ? AND salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?);`;
        const [results] = await db.execute(updateProductQuery, [name, description, sku, price, category, stock_qty, product_id, owner_user_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found or SKU already exists.' });
        }

        const [[ownerInfo]] = await db.execute(
            `SELECT u.user_id, u.email, s.name as salon_name
             FROM salons s
             JOIN users u ON s.owner_user_id = u.user_id
             WHERE s.owner_user_id = ?`,
            [owner_user_id]
        );

        if (ownerInfo && stock_qty > oldProduct.stock_qty) {
            try {
                await createNotification(db, {
                    user_id: ownerInfo.user_id,
                    salon_id: oldProduct.salon_id,
                    product_id: product_id,
                    email: ownerInfo.email,
                    type_code: 'PRODUCT_RESTOCKED',
                    message: `Product "${name}" has been restocked. Stock updated from ${oldProduct.stock_qty} to ${stock_qty} units at ${ownerInfo.salon_name}.`,
                    sender_email: 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send product restocked notification:', notifError);
            }
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

            const nowUtc = toMySQLUtc(DateTime.utc());
            const createCartQuery = `INSERT INTO carts (user_id, salon_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`;
            const [createResults] = await db.execute(createCartQuery, [user_id, salon_id, 'ACTIVE', nowUtc, nowUtc]);
            
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
        const nowUtc = toMySQLUtc(DateTime.utc());
        const addToCartQuery = `INSERT INTO cart_items (cart_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity);`;
        const [addToResults] = await db.execute(addToCartQuery, [cart_id, product_id, quantity, nowUtc, nowUtc]);
        
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
        console.error('viewCart error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.2 Remove from Cart
exports.removeFromCart = async (req, res) => {
    const db = connection.promise();

    try {
        const { salon_id, product_id } = req.body;
        const owner_user_id = req.user?.user_id;

        if (!salon_id || !owner_user_id || !product_id) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const deleteProductQuery = 
        `DELETE FROM cart_items WHERE product_id = ? AND cart_id = (SELECT cart_id FROM carts WHERE user_id = ? AND salon_id = ?);`;

        const [results] = await db.execute(deleteProductQuery, [product_id, owner_user_id, salon_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.status(200).json({
            message: "Product deleted successfully"
        });
    } catch (error) {
        console.error('removeFromCart error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.2 Update Cart
exports.updateCart = async (req, res) => {
    const db = connection.promise();

    try {
        const { salon_id, product_id, quantity } = req.body;;
        const owner_user_id = req.user?.user_id;

        if (!salon_id || !product_id || !owner_user_id) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        if (quantity <= 0) {
            return res.status(400).json({ message: 'Quantity must be greater than 0' });
        }

        const updateProductQuery = 
        `UPDATE cart_items SET quantity = ? WHERE product_id = ? AND cart_id = (SELECT cart_id FROM carts WHERE user_id = ? AND salon_id = ?);`;
        const [results] = await db.execute(updateProductQuery, [quantity, product_id, owner_user_id, salon_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        res.status(200).json({
            message: "Product updated successfully"
        });

    } catch (error) {
        console.error('updateCart error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// SF 1.2 Checkout
exports.checkout = async (req, res) => {
    const db = connection.promise();

    try {
        const { salon_id, credit_card_id, billing_address_id } = req.body;;
        const owner_user_id = req.user?.user_id;

        if (!salon_id || !owner_user_id || !credit_card_id || !billing_address_id) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Validate credit card belongs to user
        const [cardRows] = await db.execute(
            'SELECT credit_card_id FROM credit_cards WHERE credit_card_id = ? AND user_id = ?',
            [credit_card_id, owner_user_id]
        );

        if (cardRows.length === 0) {
            return res.status(404).json({ message: 'Credit card not found or does not belong to you' });
        }

        // Validate billing address belongs to user
        const [addressRows] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE billing_address_id = ? AND user_id = ?',
            [billing_address_id, owner_user_id]
        );

        if (addressRows.length === 0) {
            return res.status(404).json({ message: 'Billing address not found or does not belong to you' });
        }

        // Get Cart Details
        const getCartQuery = `SELECT c.cart_id, (SELECT SUM(p.price * ci.quantity) FROM cart_items ci JOIN products p ON ci.product_id = p.product_id WHERE ci.cart_id = c.cart_id) AS amount_due FROM carts c WHERE c.user_id = ? AND c.salon_id = ?;`;
        const [cartRows] = await db.execute(getCartQuery, [owner_user_id, salon_id]);

        if (cartRows.length === 0) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        await db.query('START TRANSACTION');

        try {
            // Check Stock Availability
            const checkStockQuery = `SELECT p.product_id, p.stock_qty as Store_Stock, ci.quantity as User_Cart FROM products p JOIN cart_items ci ON ci.product_id = p.product_id WHERE ci.cart_id = ?;`;
            const [stockRows] = await db.execute(checkStockQuery, [cartRows[0].cart_id]);

            if (stockRows.length === 0) {
                return res.status(404).json({ message: 'Product not found in this salon' });
            }

            // Check if any products have insufficient stock
            const insufficientStock = stockRows.filter(row => row.User_Cart > row.Store_Stock);
            if (insufficientStock.length > 0) {
                return res.status(400).json({
                    message: 'Insufficient stock',
                    details: insufficientStock.map(r => ({
                      product_id: r.product_id,
                      store_stock: r.Store_Stock,
                      user_cart: r.User_Cart
                    }))
                  });
            }

            // Reserve Inventory
            const reserveInventoryQuery = `UPDATE products SET stock_qty = stock_qty - ? WHERE product_id = ?`;

            for (const row of stockRows) {
                await connection.execute(reserveInventoryQuery, [row.User_Cart, row.product_id]);
            }
            
            // Copy cart to orders table
            const copyCartQuery = 
            `INSERT INTO orders (user_id, salon_id, subtotal, tax, order_code)
            SELECT 
                c.user_id,
                c.salon_id,
                SUM(p.price * ci.quantity) AS subtotal,
                SUM(p.price * ci.quantity) * 0.06625 AS tax,
                CONCAT('ORD-', UPPER(HEX(FLOOR(RAND() * 0xFFFFFF))))
            FROM carts c
            JOIN cart_items ci ON c.cart_id = ci.cart_id
            JOIN products p ON p.product_id = ci.product_id
            WHERE c.cart_id = ?
            GROUP BY c.user_id, c.salon_id;`;

            const [copyResults] = await db.execute(copyCartQuery, [cartRows[0].cart_id]);

            if (copyResults.affectedRows === 0) {
                await db.query('ROLLBACK');
                return res.status(500).json({ message: 'Failed to copy cart to orders' });
            }

            // Create payment record
            const nowUtc = toMySQLUtc(DateTime.utc());
            const insertPaymentQuery = `
                INSERT INTO payments 
                (credit_card_id, billing_address_id, amount, booking_id, order_id, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?)
            `;

            const [paymentResults] = await db.execute(insertPaymentQuery, [credit_card_id, billing_address_id, cartRows[0].amount_due, null, copyResults.insertId, nowUtc, nowUtc]);

            // Failed to process payment
            if (paymentResults.affectedRows === 0) {
                await db.query('ROLLBACK');
                return res.status(500).json({ message: 'Failed to process payment' });
            }

            const [orderItems] = await db.execute(
                `SELECT p.name, oi.quantity, oi.purchase_price
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.product_id
                 WHERE oi.order_id = ?`,
                [copyResults.insertId]
            );

            const [[customerInfo]] = await db.execute(
                `SELECT u.user_id, u.email, u.full_name, s.name as salon_name, o.salon_id
                 FROM orders o
                 JOIN users u ON o.user_id = u.user_id
                 JOIN salons s ON o.salon_id = s.salon_id
                 WHERE o.order_id = ?`,
                [copyResults.insertId]
            );

            if (customerInfo && orderItems.length > 0) {
                const itemsList = orderItems.map(item => `${item.name} (x${item.quantity})`).join(', ');
                const totalAmount = orderItems.reduce((sum, item) => sum + (item.purchase_price * item.quantity), 0);
                try {
                    await createNotification(db, {
                        user_id: customerInfo.user_id,
                        salon_id: customerInfo.salon_id,
                        payment_id: paymentResults.insertId,
                        email: customerInfo.email,
                        type_code: 'PRODUCT_PURCHASED',
                        message: `Your order from ${customerInfo.salon_name} has been confirmed! Items: ${itemsList}. Total: $${totalAmount.toFixed(2)}.`,
                        sender_email: 'SYSTEM'
                    });
                } catch (notifError) {
                    console.error('Failed to send product purchase notification:', notifError);
                }
            }

            //Copy cart items 
            const copyCartItemsQuery = 
            `INSERT INTO order_items (order_id, product_id, quantity, purchase_price)
            SELECT 
                ? AS order_id,
                ci.product_id,
                ci.quantity,
                p.price AS purchase_price
            FROM cart_items AS ci
            JOIN products AS p ON ci.product_id = p.product_id
            WHERE ci.cart_id = ?;`;

            const [copyCartItemsResults] = await db.execute(copyCartItemsQuery, [copyResults.insertId, cartRows[0].cart_id]);

            if (copyCartItemsResults.affectedRows === 0) {
                await db.query('ROLLBACK');
                return res.status(500).json({ message: 'Failed to copy cart items to order items' });
            }


            // Delete cart items
            const deleteCartItemsQuery = `DELETE FROM cart_items WHERE cart_id = ?`;
            const [deleteCartItemsResults] = await db.execute(deleteCartItemsQuery, [cartRows[0].cart_id]);

            if (deleteCartItemsResults.affectedRows === 0) {
                await db.query('ROLLBACK');
                return res.status(500).json({ message: 'Failed to delete cart items' });
            }

            // Delete cart
            const deleteCartQuery = `DELETE FROM carts WHERE cart_id = ?`;
            const [deleteResults] = await db.execute(deleteCartQuery, [cartRows[0].cart_id]);
            
            if (deleteResults.affectedRows === 0) {
                await db.query('ROLLBACK');
                return res.status(500).json({ message: 'Failed to delete cart' });
            }

            await db.query('COMMIT');

            res.status(200).json({
                message: 'Payment processed successfully',
                data: {
                    payment_id: paymentResults.insertId,
                    amount: cartRows[0].amount_due
                }
            });

        } catch (transactionError) {
            await db.query('ROLLBACK');
            console.error('checkoutCart error:', transactionError);
            return res.status(500).json({ message: 'Transaction failed' });
        }

    } catch (error) {
        console.error('checkoutCart error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};


// SF 1.2 View Orders
exports.viewUserOrders = async (req, res) => {
    const db = connection.promise();

  try {
    const { salon_id, limit, offset } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!salon_id || !limit || isNaN(offset)) {
      return res.status(400).json({ message: 'Invalid fields.' });
    }

    const countQuery = 
    `SELECT COUNT(*) as total 
    FROM orders
    WHERE salon_id = ? AND user_id = ?`;

    const [countResult] = await db.execute(countQuery, [salon_id, owner_user_id]);

    const total = countResult[0]?.total || 0;

    if (total === 0) {
      return res.status(500).json({
        message: 'No orders found',
      });
    }

    const limitInt = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 10);
    const offsetInt = Math.max(0, Number.isFinite(Number(offset)) ? Number(offset) : 0);

    const viewUserOrdersQuery = `
    SELECT o.order_code, o.subtotal as subtotal_order_price, o.tax as order_tax, o.tax + o.subtotal as total_order_price, oi.purchase_price, oi.quantity, p.name, p.description, p.sku, p.price as listed_price, p.category, o.created_at as ordered_date
    FROM orders o 
    JOIN order_items oi ON o.order_id = oi.order_id 
    JOIN products p ON oi.product_id = p.product_id
    JOIN salons s ON o.salon_id = s.salon_id
    WHERE o.salon_id = ? AND o.user_id = ?
    LIMIT ${limitInt} OFFSET ${offsetInt}`;

    const [employees] = await db.execute(viewUserOrdersQuery, [salon_id, owner_user_id]);


    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const hasNextPage = offset + employees.length < total;
    const hasPrevPage = offset > 0;

    return res.status(200).json({
      orders: employees,
      pagination: {
        current_page: currentPage,
        total_pages: totalPages,
        total_employees: total,
        limit: limit,
        offset: offset,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage
      }
    });

  } catch (err) {
    console.error('viewPastOrders error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// SF 1.2 View Salon Orders
exports.viewSalonOrders = async (req, res) => {
    const db = connection.promise();

  try {
    const { limit, offset } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!limit || isNaN(offset)) {
      return res.status(400).json({ message: 'Invalid fields.' });
    }

    const countQuery = 
    `SELECT COUNT(*) as total 
    FROM orders
    WHERE salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)`;

    const [countResult] = await db.execute(countQuery, [owner_user_id]);

    const total = countResult[0]?.total || 0;

    if (total === 0) {
      return res.status(500).json({
        message: 'No orders found',
      });
    }

    const limitInt = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 10);
    const offsetInt = Math.max(0, Number.isFinite(Number(offset)) ? Number(offset) : 0);

    const viewSalonOrdersQuery = `
    SELECT o.order_code, u.full_name as customer_name, o.order_code, o.subtotal as subtotal_order_price, o.tax as order_tax, o.tax + o.subtotal as total_order_price, oi.quantity, oi.purchase_price, p.name, p.description, p.sku, p.price as listed_price, p.category, o.created_at as ordered_date
    FROM orders o 
    JOIN order_items oi ON o.order_id = oi.order_id 
    JOIN products p ON oi.product_id = p.product_id
    JOIN users u ON o.user_id = u.user_id
    WHERE o.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
    LIMIT ${limitInt} OFFSET ${offsetInt};`;

    const [employees] = await db.execute(viewSalonOrdersQuery, [owner_user_id]);

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const hasNextPage = offset + employees.length < total;
    const hasPrevPage = offset > 0;

    return res.status(200).json({
      orders: employees,
      pagination: {
        current_page: currentPage,
        total_pages: totalPages,
        total_employees: total,
        limit: limit,
        offset: offset,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage
      }
    });

  } catch (err) {
    console.error('viewPastSalonOrders error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};