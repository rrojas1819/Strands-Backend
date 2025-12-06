const request = require('supertest');
const app = require('../../src/app');
const connection = require('../../src/config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../../src/utils/utilies');
const { insertUserWithCredentials } = require('./authTestUtils');

const db = connection.promise();

const DEFAULT_PASSWORD = 'Password123!';
const DEFAULT_CATEGORY = 'SHAMPOO';

const baseProductPayload = (overrides = {}) => {
    const sku = overrides.sku || `SHAMPOO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return {
        name: overrides.name || 'Shampoo',
        description: overrides.description || 'Premium hair shampoo',
        sku: sku,
        price: overrides.price !== undefined ? overrides.price : 20.00,
        category: overrides.category || DEFAULT_CATEGORY,
        stock_qty: overrides.stock_qty !== undefined ? overrides.stock_qty : 50,
        ...overrides
    };
};

const loginUser = async (email, password) => {
    const loginResponse = await request(app)
        .post('/api/user/login')
        .send({ email, password });
    
    if (loginResponse.status !== 200) {
        throw new Error(`Login failed with status ${loginResponse.status}: ${loginResponse.body.message || 'Unknown error'}`);
    }
    
    return loginResponse.body.data.token;
};

const createSalon = async (ownerUserId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
         address, city, state, postal_code, country, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            ownerUserId,
            options.name || 'Test Salon',
            options.description || 'Test salon description',
            options.category || 'HAIR SALON',
            options.phone || '555-0100',
            options.email || 'test-salon@test.com',
            options.address || '123 Main St',
            options.city || 'Test City',
            options.state || 'TS',
            options.postal_code || '12345',
            options.country || 'USA',
            options.status || 'APPROVED',
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const setupOwnerWithSalon = async (options = {}) => {
    const password = options.password || DEFAULT_PASSWORD;
    const owner = await insertUserWithCredentials({
        password,
        role: 'OWNER',
        ...options.ownerOverrides
    });

    const salonId = await createSalon(owner.user_id, options.salonOptions || {});
    const token = await loginUser(owner.email, password);

    return {
        owner,
        salonId,
        token,
        password
    };
};

const setupOwnerAndCustomer = async (options = {}) => {
    const password = options.password || DEFAULT_PASSWORD;
    
    const owner = await insertUserWithCredentials({
        password,
        role: 'OWNER',
        ...options.ownerOverrides
    });

    const customer = await insertUserWithCredentials({
        password,
        role: 'CUSTOMER',
        ...options.customerOverrides
    });

    const salonId = await createSalon(owner.user_id, options.salonOptions || {});
    const ownerToken = await loginUser(owner.email, password);
    const customerToken = await loginUser(customer.email, password);

    return {
        owner,
        customer,
        salonId,
        ownerToken,
        customerToken,
        password
    };
};

const setupTwoOwners = async (options = {}) => {
    const password = options.password || DEFAULT_PASSWORD;
    
    const ownerA = await insertUserWithCredentials({
        password,
        role: 'OWNER',
        ...options.ownerAOverrides
    });

    const ownerB = await insertUserWithCredentials({
        password,
        role: 'OWNER',
        ...options.ownerBOverrides
    });

    const salonA = await createSalon(ownerA.user_id, { name: 'Salon A', ...options.salonAOptions });
    const salonB = await createSalon(ownerB.user_id, { name: 'Salon B', ...options.salonBOptions });
    const tokenA = await loginUser(ownerA.email, password);
    const tokenB = await loginUser(ownerB.email, password);

    return {
        ownerA,
        ownerB,
        salonA,
        salonB,
        tokenA,
        tokenB,
        password
    };
};

const createProductInDb = async (salonId, productData) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO products (salon_id, name, description, sku, price, category, stock_qty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            salonId,
            productData.name,
            productData.description,
            productData.sku,
            productData.price,
            productData.category,
            productData.stock_qty,
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const getProductBySku = async (sku) => {
    const [rows] = await db.execute(
        'SELECT * FROM products WHERE sku = ?',
        [sku]
    );
    return rows[0] || null;
};

const getProductById = async (productId) => {
    const [rows] = await db.execute(
        'SELECT * FROM products WHERE product_id = ?',
        [productId]
    );
    return rows[0] || null;
};

const getProductsBySalonId = async (salonId) => {
    const [rows] = await db.execute(
        'SELECT * FROM products WHERE salon_id = ?',
        [salonId]
    );
    return rows;
};

const getProductStock = async (productId) => {
    const [rows] = await db.execute(
        'SELECT stock_qty FROM products WHERE product_id = ?',
        [productId]
    );
    return rows[0] ? Number(rows[0].stock_qty) : null;
};

const verifyProductExists = async (salonId, productName) => {
    const [rows] = await db.execute(
        'SELECT product_id FROM products WHERE salon_id = ? AND name = ?',
        [salonId, productName]
    );
    return rows.length > 0;
};

const verifyNoProductsExist = async (salonId) => {
    const [rows] = await db.execute(
        'SELECT product_id FROM products WHERE salon_id = ?',
        [salonId]
    );
    return rows.length === 0;
};

const addProductViaAPI = async (token, productData) => {
    return await request(app)
        .post('/api/products/')
        .set('Authorization', `Bearer ${token}`)
        .send(productData);
};

const getProductsViaAPI = async (token, salonId) => {
    return await request(app)
        .get(`/api/products/${salonId}`)
        .set('Authorization', `Bearer ${token}`);
};

const addToCartViaAPI = async (token, cartData) => {
    return await request(app)
        .post('/api/products/customer/add-to-cart')
        .set('Authorization', `Bearer ${token}`)
        .send(cartData);
};

const checkoutViaAPI = async (token, checkoutData) => {
    return await request(app)
        .post('/api/products/customer/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(checkoutData);
};

const createCreditCard = async (userId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const cardNumber = options.card_number || '4111111111111111';
    const last4 = cardNumber.slice(-4);
    const brand = options.brand || (cardNumber.startsWith('4') ? 'VISA' : 'MASTERCARD');
    
    const [result] = await db.execute(
        `INSERT INTO credit_cards (user_id, brand, last4, exp_month, exp_year, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            brand,
            last4,
            options.exp_month || 12,
            options.exp_year || 2025,
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const createBillingAddress = async (userId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO billing_addresses (user_id, full_name, address_line1, address_line2, city, state, postal_code, country, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            options.full_name || 'Test User',
            options.address_line1 || options.street_address || '123 Test St',
            options.address_line2 || null,
            options.city || 'Test City',
            options.state || 'TS',
            options.postal_code || '12345',
            options.country || 'USA',
            options.phone || null,
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const setupCheckoutData = async (userId, options = {}) => {
    const creditCardId = await createCreditCard(userId, options.creditCardOptions);
    const billingAddressId = await createBillingAddress(userId, options.billingAddressOptions);
    
    return {
        creditCardId,
        billingAddressId
    };
};

const verifySalonExists = async (salonId) => {
    const [rows] = await db.execute(
        'SELECT salon_id FROM salons WHERE salon_id = ?',
        [salonId]
    );
    return rows.length > 0;
};

const generateUniqueSku = (prefix = 'SHAMPOO') => {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

const generateLongString = (length) => {
    return 'A'.repeat(length);
};

const generateMaliciousString = () => {
    return '<h1>Buy Here</h1><script>stealData()</script>';
};

module.exports = {
    DEFAULT_PASSWORD,
    DEFAULT_CATEGORY,
    
    baseProductPayload,
    
    loginUser,
    createSalon,
    
    setupOwnerWithSalon,
    setupOwnerAndCustomer,
    setupTwoOwners,
    
    createProductInDb,
    getProductBySku,
    getProductById,
    getProductsBySalonId,
    getProductStock,
    verifyProductExists,
    verifyNoProductsExist,
    
    addProductViaAPI,
    getProductsViaAPI,
    addToCartViaAPI,
    checkoutViaAPI,
    
    createCreditCard,
    createBillingAddress,
    setupCheckoutData,
    
    verifySalonExists,
    
    generateUniqueSku,
    generateLongString,
    generateMaliciousString
};
