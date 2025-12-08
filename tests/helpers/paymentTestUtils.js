const request = require('supertest');
const app = require('../../src/app');
const connection = require('../../src/config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../../src/utils/utilies');
const { insertUserWithCredentials } = require('./authTestUtils');

const db = connection.promise();

const DEFAULT_PASSWORD = 'Password123!';

const loginUser = async (email, password) => {
    const loginResponse = await request(app)
        .post('/api/user/login')
        .send({ email, password });
    expect(loginResponse.status).toBe(200);
    return loginResponse.body.data.token;
};

const createBillingAddressViaAPI = async (token, options = {}) => {
    const response = await request(app)
        .post('/api/payments/createBillingAddress')
        .set('Authorization', `Bearer ${token}`)
        .send({
            full_name: options.full_name || 'Test User',
            address_line1: options.address_line1 || '123 Test St',
            city: options.city || 'Test City',
            state: options.state || 'TS',
            postal_code: options.postal_code || '12345',
            country: options.country || 'USA',
            phone: options.phone || null
        });
    return response;
};

const getBillingAddressViaAPI = async (token) => {
    return await request(app)
        .get('/api/payments/getBillingAddress')
        .set('Authorization', `Bearer ${token}`);
};

const saveCreditCardViaAPI = async (token, options = {}) => {
    const response = await request(app)
        .post('/api/payments/saveCreditCard')
        .set('Authorization', `Bearer ${token}`)
        .send({
            card_number: options.card_number || '4242424242424242',
            cvc: options.cvc || '123',
            exp_month: options.exp_month || 12,
            exp_year: options.exp_year || 2025,
            billing_address_id: options.billing_address_id
        });
    return response;
};

const getCreditCardsViaAPI = async (token) => {
    return await request(app)
        .get('/api/payments/getCreditCards')
        .set('Authorization', `Bearer ${token}`);
};

const processPaymentViaAPI = async (token, payload) => {
    return await request(app)
        .post('/api/payments/process')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
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

const createService = async (salonId, name = 'Haircut', price = 50.00) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO services (salon_id, name, description, price, duration_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [salonId, name, 'Test service', price, 60, nowUtc, nowUtc]
    );
    return result.insertId;
};

const createBooking = async (salonId, customerUserId, scheduledStart, scheduledEnd, status = 'SCHEDULED') => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [salonId, customerUserId, toMySQLUtc(scheduledStart), toMySQLUtc(scheduledEnd), status, nowUtc, nowUtc]
    );
    return result.insertId;
};

const createBookingService = async (bookingId, serviceId, employeeId = null, price = 50.00) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    await db.execute(
        `INSERT INTO booking_services (booking_id, service_id, employee_id, price, duration_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, serviceId, employeeId, price, 60, nowUtc, nowUtc]
    );
};

const setupCustomerWithPaymentMethod = async (options = {}) => {
    const password = options.password || DEFAULT_PASSWORD;
    const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
    const customerToken = await loginUser(customer.email, password);
    
    await createBillingAddressViaAPI(customerToken, options.billingAddressOptions);
    const billingAddressResponse = await getBillingAddressViaAPI(customerToken);
    const billingAddressId = billingAddressResponse.body.billing_address?.billing_address_id;
    
    const creditCardResponse = await saveCreditCardViaAPI(customerToken, {
        billing_address_id: billingAddressId,
        ...options.creditCardOptions
    });
    const creditCardId = creditCardResponse.body.data?.credit_card_id;
    
    return {
        customer,
        customerToken,
        billingAddressId,
        creditCardId
    };
};

const setupPaymentEnvironment = async (options = {}) => {
    const password = options.password || DEFAULT_PASSWORD;
    const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
    const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
    
    const salonId = await createSalon(owner.user_id, { status: 'APPROVED' });
    const serviceId = await createService(salonId, 'Haircut', options.servicePrice || 50.00);
    
    const futureDate = DateTime.utc().plus({ days: 1 });
    const bookingId = await createBooking(
        salonId,
        customer.user_id,
        futureDate,
        futureDate.plus({ hours: 1 }),
        'PENDING'
    );
    await createBookingService(bookingId, serviceId, null, options.servicePrice || 50.00);
    
    const customerToken = await loginUser(customer.email, password);
    
    await createBillingAddressViaAPI(customerToken);
    const billingAddressResponse = await getBillingAddressViaAPI(customerToken);
    const billingAddressId = billingAddressResponse.body.billing_address?.billing_address_id;
    
    const creditCardResponse = await saveCreditCardViaAPI(customerToken, {
        billing_address_id: billingAddressId
    });
    const creditCardId = creditCardResponse.body.data?.credit_card_id;
    
    return {
        customer,
        owner,
        salonId,
        serviceId,
        bookingId,
        customerToken,
        billingAddressId,
        creditCardId
    };
};

module.exports = {
    DEFAULT_PASSWORD,
    
    loginUser,
    createBillingAddressViaAPI,
    getBillingAddressViaAPI,
    saveCreditCardViaAPI,
    getCreditCardsViaAPI,
    processPaymentViaAPI,
    
    createSalon,
    createService,
    createBooking,
    createBookingService,
    
    setupCustomerWithPaymentMethod,
    setupPaymentEnvironment
};

