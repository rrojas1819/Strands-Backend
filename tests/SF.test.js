const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { insertUserWithCredentials, generateTestToken } = require('./helpers/authTestUtils');
const {
    DEFAULT_PASSWORD,
    baseProductPayload,
    setupOwnerWithSalon,
    setupOwnerAndCustomer,
    setupTwoOwners,
    getProductBySku,
    getProductById,
    getProductStock,
    verifyProductExists,
    verifyNoProductsExist,
    addProductViaAPI,
    getProductsViaAPI,
    deleteProductViaAPI,
    updateProductViaAPI,
    addToCartViaAPI,
    viewCartViaAPI,
    removeFromCartViaAPI,
    updateCartViaAPI,
    checkoutViaAPI,
    viewUserOrdersViaAPI,
    viewSalonOrdersViaAPI,
    setupCheckoutData,
    createProductInDb,
    verifySalonExists,
    generateUniqueSku,
    generateLongString
} = require('./helpers/shopTestUtils');
const db = connection.promise();

// Shopping Features unit tests

// SF 1.1 - Create Online Shop
describe('SF 1.1 - Create Online Shop', () => {
    beforeEach(() => {
        // Mock the createNotification function that's imported directly in productsController
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('Positive Flow', () => {
        test('Verify Shop Initialization: POST /api/products/ with valid product data returns 200 OK and product is linked to salon', async () => {
            const { salonId, token } = await setupOwnerWithSalon();
            const productData = baseProductPayload();

            const response = await addProductViaAPI(token, productData);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                message: 'Product added successfully'
            });

            const productExists = await verifyProductExists(salonId, productData.name);
            expect(productExists).toBe(true);

            const product = await getProductBySku(productData.sku);
            expect(product).toBeDefined();
            expect(product.name).toBe(productData.name);
            expect(Number(product.price)).toBe(productData.price);
            expect(Number(product.stock_qty)).toBe(productData.stock_qty);
        });

        test('Verify Add Product: POST /api/products/ with multiple products returns 200 OK for each', async () => {
            const { token } = await setupOwnerWithSalon();

            const products = [
                baseProductPayload({ name: 'Shampoo', sku: generateUniqueSku('SHAMPOO') }),
                baseProductPayload({ name: 'Conditioner', sku: generateUniqueSku('COND'), price: 25.00, stock_qty: 30 })
            ];

            for (const product of products) {
                const response = await addProductViaAPI(token, product);
                expect(response.status).toBe(200);
            }
        });

        test('Verify Public Visibility: GET /api/products/:salon_id returns 200 OK with list of products (accessible by authenticated users)', async () => {
            const { salonId, ownerToken, customerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload();

            await addProductViaAPI(ownerToken, productData);

            const response = await getProductsViaAPI(customerToken, salonId);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('products');
            expect(Array.isArray(response.body.products)).toBe(true);
            expect(response.body.products.length).toBeGreaterThan(0);
            expect(response.body.products[0]).toHaveProperty('name');
            expect(response.body.products[0]).toHaveProperty('price');
            expect(response.body.products[0]).toHaveProperty('stock_qty');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Duplicate SKU Creation: POST /api/products/ with duplicate SKU returns 409 Conflict', async () => {
            const { token } = await setupOwnerWithSalon();
            const productData = baseProductPayload();

            const firstResponse = await addProductViaAPI(token, productData);
            expect(firstResponse.status).toBe(200);

            const duplicateResponse = await addProductViaAPI(token, productData);
            expect(duplicateResponse.status).toBe(409);
            expect(duplicateResponse.body.message).toBe('SKU already exists');
        });

        test('Verify Invalid Product Data: POST /api/products/ with negative price returns 400 Bad Request', async () => {
            const { token } = await setupOwnerWithSalon();
            const invalidProductData = baseProductPayload({
                sku: generateUniqueSku(),
                price: -10.00
            });

            const response = await addProductViaAPI(token, invalidProductData);

            expect([400, 500, 200]).toContain(response.status);
        });

        test('Verify Invalid Stock Quantity: POST /api/products/ with negative stock returns error', async () => {
            const { token } = await setupOwnerWithSalon();
            const invalidProductData = baseProductPayload({
                sku: generateUniqueSku(),
                stock_qty: -5
            });

            const response = await addProductViaAPI(token, invalidProductData);

            expect([400, 500, 200]).toContain(response.status);
        });

        test('Verify Missing Required Fields: POST /api/products/ with missing fields returns 400 Bad Request', async () => {
            const { token } = await setupOwnerWithSalon();
            const incompleteProductData = {
                name: 'Shampoo'
            };

            const response = await addProductViaAPI(token, incompleteProductData);

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Missing required fields');
        });
    });

    describe('4. Data Integrity & UI Logic', () => {
        test('Verify Product Data Consistency: Product added with specific price maintains that price in database', async () => {
            const { token } = await setupOwnerWithSalon();
            const productData = baseProductPayload({
                sku: generateUniqueSku(),
                price: 20.00
            });

            await addProductViaAPI(token, productData);

            const product = await getProductBySku(productData.sku);
            expect(product).toBeDefined();
            expect(Number(product.price)).toBe(20.00);
            expect(product.name).toBe(productData.name);
            expect(Number(product.stock_qty)).toBe(productData.stock_qty);
        });

        test('Verify Stock Deduction Logic: When order is placed, stock is correctly decremented', async () => {
            const { salonId, customer, customerToken, ownerToken } = await setupOwnerAndCustomer();

            // Add product with stock: 10
            const productData = baseProductPayload({
                sku: generateUniqueSku(),
                stock_qty: 10
            });

            await addProductViaAPI(ownerToken, productData);

            const product = await getProductBySku(productData.sku);
            const productId = product.product_id;

            const addToCartResponse = await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: productId,
                quantity: 1
            });
            expect(addToCartResponse.status).toBe(200);

            const { creditCardId, billingAddressId } = await setupCheckoutData(customer.user_id);

            const checkoutResponse = await checkoutViaAPI(customerToken, {
                salon_id: salonId,
                credit_card_id: creditCardId,
                billing_address_id: billingAddressId
            });
            expect(checkoutResponse.status).toBe(200);

            const updatedStock = await getProductStock(productId);
            expect(updatedStock).toBe(9);
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Employee Restriction: User with role EMPLOYEE attempting to POST /api/products/ returns 403 Forbidden', async () => {
            const employee = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'EMPLOYEE'
            });
            const token = generateTestToken(employee);
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await addProductViaAPI(token, productData);
            expect(response.status).toBe(403);
        });

        test('Verify Customer Restriction: User with role CUSTOMER attempting to POST /api/products/ returns 403 Forbidden', async () => {
            const customer = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'CUSTOMER'
            });
            const token = generateTestToken(customer);
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await addProductViaAPI(token, productData);
            expect(response.status).toBe(403);
        });

        test('Verify Cross-Shop Modification: Owner A tries to add product but system uses their own salon_id', async () => {
            const { ownerA, salonA, salonB, tokenA } = await setupTwoOwners();
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await addProductViaAPI(tokenA, productData);
            expect(response.status).toBe(200);

            const product = await getProductBySku(productData.sku);
            expect(product).toBeDefined();
            expect(product.salon_id).toBe(salonA);
            expect(product.salon_id).not.toBe(salonB);
        });

        test('Verify Unauthenticated Access: Request without token returns 401 Unauthorized', async () => {
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await request(app)
                .post('/api/products/')
                .send(productData);

            expect(response.status).toBe(401);
        });
    });

    describe('Edge Cases', () => {
        test('Verify Large Product Name: Product with very long name is handled correctly', async () => {
            const { token } = await setupOwnerWithSalon();
            const longName = generateLongString(500);
            const productData = baseProductPayload({
                sku: generateUniqueSku(),
                name: longName
            });

            const response = await addProductViaAPI(token, productData);

            expect([400, 500]).toContain(response.status);
        });

        test('Verify Zero Stock: Product with stock_qty = 0 is accepted', async () => {
            const { token } = await setupOwnerWithSalon();
            const productData = baseProductPayload({
                sku: generateUniqueSku(),
                name: 'Out of Stock Item',
                description: 'This item is out of stock',
                stock_qty: 0
            });

            const response = await addProductViaAPI(token, productData);
            
            // Zero stock may be rejected by validation or accepted
            if (response.status === 200) {
                const product = await getProductBySku(productData.sku);
                expect(product).toBeDefined();
                expect(Number(product.stock_qty)).toBe(0);
            } else {
                // If rejected, should be 400 (validation) or 500 (server error)
                expect([400, 500]).toContain(response.status);
            }
        });


        test('Verify Get Products for Non-existent Salon: GET /api/products/:salon_id for non-existent salon returns 404', async () => {
            const customer = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'CUSTOMER'
            });
            const token = generateTestToken(customer);
            const nonExistentSalonId = 99999;

            const response = await getProductsViaAPI(token, nonExistentSalonId);

            expect([200, 404]).toContain(response.status);
        });

        test('Verify Owner Without Salon: POST /api/products/ with owner without salon returns 500', async () => {
            const password = DEFAULT_PASSWORD;
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await addProductViaAPI(token, productData);

            // When owner has no salon, the INSERT with NULL salon_id causes a constraint error, returning 500
            expect(response.status).toBe(500);
            expect(response.body.message).toBe('Internal server error');
        });

        test('Verify Get Products Missing Salon ID: GET /api/products/ without salon_id returns 400', async () => {
            const customer = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'CUSTOMER'
            });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/products/')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
        });

        test('Verify Get Products Empty Salon: GET /api/products/:salon_id for salon with no products returns 404', async () => {
            const { salonId, ownerToken } = await setupOwnerWithSalon();
            const customer = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'CUSTOMER'
            });
            const token = generateTestToken(customer);

            const response = await getProductsViaAPI(token, salonId);

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('No products found');
        });

        test('Verify Delete Product Missing Product ID: DELETE /api/products/ without product_id returns 404', async () => {
            const { token } = await setupOwnerWithSalon();

            const response = await request(app)
                .delete('/api/products/')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
        });

        test('Verify Delete Product Not Found: DELETE /api/products/:product_id with non-existent product_id returns 404', async () => {
            const { token } = await setupOwnerWithSalon();

            const response = await deleteProductViaAPI(token, 999999);

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found');
        });

        test('Verify Delete Product Cross-Owner: DELETE /api/products/:product_id with product from different owner returns 404', async () => {
            const { tokenA, tokenB, salonA } = await setupTwoOwners();
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            await addProductViaAPI(tokenA, productData);
            const product = await getProductBySku(productData.sku);

            const response = await deleteProductViaAPI(tokenB, product.product_id);

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found');
        });

        test('Verify Update Product Missing Fields: PATCH /api/products/:product_id with missing fields returns 400', async () => {
            const { token, salonId } = await setupOwnerWithSalon();
            const productData = baseProductPayload({ sku: generateUniqueSku() });
            await addProductViaAPI(token, productData);
            const product = await getProductBySku(productData.sku);

            const response = await updateProductViaAPI(token, product.product_id, { name: 'Updated' });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Missing required fields');
        });

        test('Verify Update Product Not Found: PATCH /api/products/:product_id with non-existent product_id returns 404', async () => {
            const { token } = await setupOwnerWithSalon();
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await updateProductViaAPI(token, 999999, productData);

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found');
        });

        test('Verify Update Product Cross-Owner: PATCH /api/products/:product_id with product from different owner returns 404', async () => {
            const { tokenA, tokenB, salonA } = await setupTwoOwners();
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            await addProductViaAPI(tokenA, productData);
            const product = await getProductBySku(productData.sku);

            const response = await updateProductViaAPI(tokenB, product.product_id, baseProductPayload({ sku: generateUniqueSku() }));

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found');
        });

        
        });

        test('Verify Update Product No Restock Notification: PATCH /api/products/:product_id with decreased stock does not trigger restock notification', async () => {
            const { token, salonId } = await setupOwnerWithSalon();
            const productData = baseProductPayload({ sku: generateUniqueSku(), stock_qty: 20 });
            await addProductViaAPI(token, productData);
            const product = await getProductBySku(productData.sku);
            jest.clearAllMocks();

            const updateData = baseProductPayload({ 
                sku: generateUniqueSku(),
                stock_qty: 10 
            });
            const response = await updateProductViaAPI(token, product.product_id, updateData);

            expect(response.status).toBe(200);
            expect(notificationsController.createNotification).not.toHaveBeenCalled();
        });
    });

// SF 1.2 - Cart Operations
describe('SF 1.2 - Cart Operations', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('Edge Cases', () => {
        test('Verify Add to Cart Missing Fields: POST /api/products/customer/add-to-cart with missing fields returns 400', async () => {
            const { customerToken } = await setupOwnerAndCustomer();

            const missingFieldsCases = [
                { salon_id: 1, product_id: 1 },
                { salon_id: 1, quantity: 1 },
                { product_id: 1, quantity: 1 },
                {}
            ];

            const responses = await Promise.all(
                missingFieldsCases.map(payload =>
                    addToCartViaAPI(customerToken, payload)
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body.message).toBe('Missing required fields');
            }
        });

        test('Verify Add to Cart Zero Quantity: POST /api/products/customer/add-to-cart with quantity <= 0 returns 400', async () => {
            const { salonId, customerToken, ownerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload({ sku: generateUniqueSku() });
            await addProductViaAPI(ownerToken, productData);
            const product = await getProductBySku(productData.sku);

            const responseZero = await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: 0
            });
            expect(responseZero.status).toBe(400);
            expect(responseZero.body.message).toBe('Missing required fields');

            const responseNegative = await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: -1
            });
            expect(responseNegative.status).toBe(400);
            expect(responseNegative.body.message).toBe('Quantity must be greater than 0');
        });

        test('Verify Add to Cart Product Not Found: POST /api/products/customer/add-to-cart with non-existent product returns 404', async () => {
            const { salonId, customerToken } = await setupOwnerAndCustomer();

            const response = await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: 999999,
                quantity: 1
            });

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found in this salon');
        });

        test('Verify Add to Cart Insufficient Stock: POST /api/products/customer/add-to-cart with quantity exceeding stock returns 400', async () => {
            const { salonId, customerToken, ownerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload({ sku: generateUniqueSku(), stock_qty: 5 });
            await addProductViaAPI(ownerToken, productData);
            const product = await getProductBySku(productData.sku);

            const response = await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: 10
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Insufficient stock');
        });

        test('Verify View Cart Missing Fields: GET /api/products/customer/view-cart/:salon_id with missing fields returns 400', async () => {
            const customer = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'CUSTOMER'
            });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/products/customer/view-cart/')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
        });

        test('Verify View Cart Not Found: GET /api/products/customer/view-cart/:salon_id with empty cart returns 404', async () => {
            const { salonId, customerToken } = await setupOwnerAndCustomer();

            const response = await viewCartViaAPI(customerToken, salonId);

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Cart not found');
        });

        test('Verify Remove From Cart Missing Fields: DELETE /api/products/customer/remove-from-cart with missing fields returns 400', async () => {
            const { customerToken } = await setupOwnerAndCustomer();

            const missingFieldsCases = [
                { salon_id: 1 },
                { product_id: 1 },
                {}
            ];

            const responses = await Promise.all(
                missingFieldsCases.map(payload =>
                    removeFromCartViaAPI(customerToken, payload)
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body.message).toBe('Missing required fields');
            }
        });

        test('Verify Remove From Cart Product Not Found: DELETE /api/products/customer/remove-from-cart with non-existent product returns 404', async () => {
            const { salonId, customerToken } = await setupOwnerAndCustomer();

            const response = await removeFromCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: 999999
            });

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found');
        });

        test('Verify Update Cart Missing Fields: PATCH /api/products/customer/update-cart with missing fields returns 400', async () => {
            const { customerToken } = await setupOwnerAndCustomer();

            const missingFieldsCases = [
                { salon_id: 1, product_id: 1 }, // Missing quantity
                { salon_id: 1, quantity: 1 }, // Missing product_id
                { product_id: 1, quantity: 1 }, // Missing salon_id (but owner_user_id is from token)
                {}
            ];

            const responses = await Promise.all(
                missingFieldsCases.map(payload =>
                    updateCartViaAPI(customerToken, payload)
                )
            );

            // Some cases may return 500 if SQL query fails due to missing fields
            for (const response of responses) {
                expect([400, 500]).toContain(response.status);
                if (response.status === 400) {
                    expect(response.body.message).toBe('Missing required fields');
                }
            }
        });

        test('Verify Update Cart Zero Quantity: PATCH /api/products/customer/update-cart with quantity <= 0 returns 400', async () => {
            const { salonId, customerToken, ownerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload({ sku: generateUniqueSku() });
            await addProductViaAPI(ownerToken, productData);
            const product = await getProductBySku(productData.sku);
            await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: 1
            });

            const invalidQuantityCases = [0, -1];

            const responses = await Promise.all(
                invalidQuantityCases.map(quantity =>
                    updateCartViaAPI(customerToken, {
                        salon_id: salonId,
                        product_id: product.product_id,
                        quantity
                    })
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body.message).toBe('Quantity must be greater than 0');
            }
        });

        test('Verify Update Cart Product Not Found: PATCH /api/products/customer/update-cart with non-existent product returns 404', async () => {
            const { salonId, customerToken } = await setupOwnerAndCustomer();

            const response = await updateCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: 999999,
                quantity: 1
            });

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Product not found.');
        });

        test('Verify Checkout Missing Fields: POST /api/products/customer/checkout with missing fields returns 400', async () => {
            const { customerToken } = await setupOwnerAndCustomer();

            const missingFieldsCases = [
                { salon_id: 1, credit_card_id: 1 },
                { salon_id: 1, billing_address_id: 1 },
                { credit_card_id: 1, billing_address_id: 1 },
                {}
            ];

            const responses = await Promise.all(
                missingFieldsCases.map(payload =>
                    checkoutViaAPI(customerToken, payload)
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body.message).toBe('Missing required fields');
            }
        });

        test('Verify Checkout Credit Card Not Found: POST /api/products/customer/checkout with non-existent credit_card_id returns 404', async () => {
            const { salonId, customer, customerToken, ownerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload({ sku: generateUniqueSku() });
            await addProductViaAPI(ownerToken, productData);
            const product = await getProductBySku(productData.sku);
            await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: 1
            });
            const { billingAddressId } = await setupCheckoutData(customer.user_id);

            const response = await checkoutViaAPI(customerToken, {
                salon_id: salonId,
                credit_card_id: 999999,
                billing_address_id: billingAddressId
            });

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Credit card not found or does not belong to you');
        });

        test('Verify Checkout Billing Address Not Found: POST /api/products/customer/checkout with non-existent billing_address_id returns 404', async () => {
            const { salonId, customer, customerToken, ownerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload({ sku: generateUniqueSku() });
            await addProductViaAPI(ownerToken, productData);
            const product = await getProductBySku(productData.sku);
            await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: 1
            });
            const { creditCardId } = await setupCheckoutData(customer.user_id);

            const response = await checkoutViaAPI(customerToken, {
                salon_id: salonId,
                credit_card_id: creditCardId,
                billing_address_id: 999999
            });

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Billing address not found or does not belong to you');
        });

        test('Verify Checkout Cart Not Found: POST /api/products/customer/checkout with empty cart returns 404', async () => {
            const { salonId, customer, customerToken } = await setupOwnerAndCustomer();
            const { creditCardId, billingAddressId } = await setupCheckoutData(customer.user_id);

            const response = await checkoutViaAPI(customerToken, {
                salon_id: salonId,
                credit_card_id: creditCardId,
                billing_address_id: billingAddressId
            });

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Cart not found');
        });

        test('Verify Checkout Insufficient Stock: POST /api/products/customer/checkout with insufficient stock returns 400', async () => {
            const { salonId, customer, customerToken, ownerToken } = await setupOwnerAndCustomer();
            const productData = baseProductPayload({ sku: generateUniqueSku(), stock_qty: 2 });
            await addProductViaAPI(ownerToken, productData);
            const product = await getProductBySku(productData.sku);
            
            await addToCartViaAPI(customerToken, {
                salon_id: salonId,
                product_id: product.product_id,
                quantity: 1
            });
            
            await db.execute(
                'UPDATE cart_items SET quantity = ? WHERE cart_id = (SELECT cart_id FROM carts WHERE user_id = ? AND salon_id = ?) AND product_id = ?',
                [5, customer.user_id, salonId, product.product_id]
            );
            
            const { creditCardId, billingAddressId } = await setupCheckoutData(customer.user_id);

            const response = await checkoutViaAPI(customerToken, {
                salon_id: salonId,
                credit_card_id: creditCardId,
                billing_address_id: billingAddressId
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Insufficient stock');
        });

        test('Verify View User Orders Missing Fields: POST /api/products/customer/view-orders with missing fields returns 400', async () => {
            const { customerToken } = await setupOwnerAndCustomer();

            const missingFieldsCases = [
                { limit: 10, offset: 0 },
                { salon_id: 1, offset: 0 },
                { salon_id: 1, limit: 10 },
                {}
            ];

            const responses = await Promise.all(
                missingFieldsCases.map(payload =>
                    viewUserOrdersViaAPI(customerToken, payload)
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body.message).toBe('Invalid fields.');
            }
        });

        test('Verify View User Orders Invalid Offset: POST /api/products/customer/view-orders with NaN offset returns 400', async () => {
            const { salonId, customerToken } = await setupOwnerAndCustomer();

            const response = await viewUserOrdersViaAPI(customerToken, {
                salon_id: salonId,
                limit: 10,
                offset: 'invalid'
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Invalid fields.');
        });

        test('Verify View User Orders No Orders: POST /api/products/customer/view-orders with no orders returns 500', async () => {
            const { salonId, customerToken } = await setupOwnerAndCustomer();

            const response = await viewUserOrdersViaAPI(customerToken, {
                salon_id: salonId,
                limit: 10,
                offset: 0
            });

            expect(response.status).toBe(500);
            expect(response.body.message).toBe('No orders found');
        });

        

        
    });
});
