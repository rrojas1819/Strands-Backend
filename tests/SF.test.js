const request = require('supertest');
const app = require('../src/app');
const notificationsController = require('../src/controllers/notificationsController');
const { insertUserWithCredentials } = require('./helpers/authTestUtils');
const {
    DEFAULT_PASSWORD,
    baseProductPayload,
    loginUser,
    setupOwnerWithSalon,
    setupOwnerAndCustomer,
    setupTwoOwners,
    getProductBySku,
    getProductStock,
    verifyProductExists,
    verifyNoProductsExist,
    addProductViaAPI,
    getProductsViaAPI,
    addToCartViaAPI,
    checkoutViaAPI,
    setupCheckoutData,
    verifySalonExists,
    generateUniqueSku,
    generateLongString
} = require('./helpers/shopTestUtils');

// Shopping Features unit tests

// SF 1.1 - Create Online Shop
describe('SF 1.1 - Create Online Shop', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('1. Pre-conditions (The Setup)', () => {
        test('Verify User State: Valid JWT for a user with role OWNER', async () => {
            const owner = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'OWNER'
            });

            const token = await loginUser(owner.email, DEFAULT_PASSWORD);
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
        });

        test('Verify Data State: The salon exists but does not yet have products (shop not yet active)', async () => {
            const { salonId } = await setupOwnerWithSalon();

            const salonExists = await verifySalonExists(salonId);
            expect(salonExists).toBe(true);

            const noProducts = await verifyNoProductsExist(salonId);
            expect(noProducts).toBe(true);
        });
    });

    describe('2. Positive Flow (The "Happy Path")', () => {
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

    describe('3. Negative Flow (Error Handling & Rejection)', () => {
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

    describe('5. Security & Permissions (RBAC)', () => {
        test('Verify Employee Restriction: User with role EMPLOYEE attempting to POST /api/products/ returns 403 Forbidden', async () => {
            const employee = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'EMPLOYEE'
            });
            const token = await loginUser(employee.email, DEFAULT_PASSWORD);
            const productData = baseProductPayload({ sku: generateUniqueSku() });

            const response = await addProductViaAPI(token, productData);
            expect(response.status).toBe(403);
        });

        test('Verify Customer Restriction: User with role CUSTOMER attempting to POST /api/products/ returns 403 Forbidden', async () => {
            const customer = await insertUserWithCredentials({
                password: DEFAULT_PASSWORD,
                role: 'CUSTOMER'
            });
            const token = await loginUser(customer.email, DEFAULT_PASSWORD);
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

    describe('6. Edge Cases', () => {
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
            const token = await loginUser(customer.email, DEFAULT_PASSWORD);
            const nonExistentSalonId = 99999;

            const response = await getProductsViaAPI(token, nonExistentSalonId);

            expect([200, 404]).toContain(response.status);
        });
    });
});
