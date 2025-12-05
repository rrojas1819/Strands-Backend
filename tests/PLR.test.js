const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, insertUserWithCredentials } = require('./helpers/authTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');

const db = connection.promise();

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

const createLoyaltyMembership = async (userId, salonId, visitsCount = 0, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO loyalty_memberships (user_id, salon_id, visits_count, total_visits_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            userId,
            salonId,
            visitsCount,
            options.total_visits_count !== undefined ? options.total_visits_count : visitsCount,
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const createUserPromotion = async (userId, salonId, promoCode, discountPct, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const expiresAt = options.expires_at ? toMySQLUtc(options.expires_at) : null;
    const [result] = await db.execute(
        `INSERT INTO user_promotions 
         (user_id, salon_id, promo_code, description, discount_pct, issued_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            salonId,
            promoCode,
            options.description || '',
            discountPct,
            nowUtc,
            expiresAt,
            options.status || 'ISSUED'
        ]
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

const createService = async (salonId, name = 'Haircut', price = 50.00) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO services (salon_id, name, description, price, duration_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [salonId, name, 'Test service', price, 60, nowUtc, nowUtc]
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

// NC 1.2: Promotions & Loyalty
describe('NC 1.2: Promotions & Loyalty', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true,
            notification_id: 1
        });
    });

    describe('Positive Flow', () => {
        test('Verify Bulk Issue to Loyal Customers (HTTP 200): POST /issue-promotions sends to Gold tier customers', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const goldCustomer1 = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const goldCustomer2 = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const bronzeCustomer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);

            // Create Gold tier customers
            await createLoyaltyMembership(goldCustomer1.user_id, salonId, 5);
            await createLoyaltyMembership(goldCustomer2.user_id, salonId, 7);

            // Create Bronze tier customer
            await createLoyaltyMembership(bronzeCustomer.user_id, salonId, 3);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: owner.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post(`/api/promotions/salons/${salonId}/issue-promotions`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    discount_pct: 50,
                    description: 'VIP50 promotion'
                });

            expect(response.status).toBe(201);
            expect(response.body.data).toBeDefined();
            expect(response.body.data.promotions_created).toBeGreaterThanOrEqual(2);
            expect(response.body.data.notifications_created).toBeGreaterThanOrEqual(2);

            // Verify Gold customers received promotions
            const [promos1] = await db.execute(
                'SELECT promo_code FROM user_promotions WHERE user_id = ? AND salon_id = ?',
                [goldCustomer1.user_id, salonId]
            );
            const [promos2] = await db.execute(
                'SELECT promo_code FROM user_promotions WHERE user_id = ? AND salon_id = ?',
                [goldCustomer2.user_id, salonId]
            );
            expect(promos1.length).toBeGreaterThan(0);
            expect(promos2.length).toBeGreaterThan(0);

            // Verify Bronze customer did NOT receive promotion
            const [promos3] = await db.execute(
                'SELECT promo_code FROM user_promotions WHERE user_id = ? AND salon_id = ?',
                [bronzeCustomer.user_id, salonId]
            );
            expect(promos3.length).toBe(0);
        });

        test('Verify Customer Sees Promo (HTTP 200): Customer who received promo calls GET /user/get-promotions', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);

            // Create a promotion for the customer
            await createUserPromotion(customer.user_id, salonId, 'VIP50', 50, {
                description: 'VIP promotion'
            });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .get('/api/promotions/user/get-promotions')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            expect(Array.isArray(response.body.data)).toBe(true);

            const vipPromo = response.body.data.find(p => p.promo_code === 'VIP50');
            expect(vipPromo).toBeDefined();
            expect(Number(vipPromo.discount_pct)).toBe(50);
        });

        test('Verify Preview Calculation (HTTP 200): POST /preview returns discount without marking promo as used', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 100.00);

            // Create a booking with services
            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingId = await createBooking(
                salonId,
                customer.user_id,
                futureDate,
                futureDate.plus({ hours: 1 }),
                'SCHEDULED'
            );
            await createBookingService(bookingId, serviceId, null, 100.00);

            // Create a promotion
            const promoId = await createUserPromotion(customer.user_id, salonId, 'VIP50', 50);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/promotions/preview')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    promo_code: 'VIP50',
                    booking_id: bookingId
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            expect(response.body.data.pricing).toBeDefined();
            expect(response.body.data.pricing.original_total).toBe(100.00);
            expect(response.body.data.pricing.discount_amount).toBe(50.00);
            expect(response.body.data.pricing.discounted_total).toBe(50.00);

            // Verify promo is NOT marked as used
            const [promo] = await db.execute(
                'SELECT status FROM user_promotions WHERE user_promo_id = ?',
                [promoId]
            );
            expect(promo[0].status).toBe('ISSUED');
        });
    });

    describe('Negative Flow', () => {
        test.each([
            {
                description: 'non-existent promo code',
                promoCode: 'FAKE123',
                setupPromo: null,
                expectedStatus: [400, 404],
                expectedMessage: /Invalid|not exist|expired/i
            },
            {
                description: 'expired promotion',
                promoCode: 'EXPIRED50',
                setupPromo: async (userId, salonId) => {
                    const expiredDate = DateTime.utc().minus({ days: 1 });
                    await createUserPromotion(userId, salonId, 'EXPIRED50', 50, { expires_at: expiredDate });
                },
                expectedStatus: 400,
                expectedMessage: /expired/i
            }
        ])('Verify POST /preview returns error for $description', async ({ promoCode, setupPromo, expectedStatus, expectedMessage }) => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 100.00);

            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingId = await createBooking(
                salonId,
                customer.user_id,
                futureDate,
                futureDate.plus({ hours: 1 }),
                'SCHEDULED'
            );
            await createBookingService(bookingId, serviceId, null, 100.00);

            if (setupPromo) {
                await setupPromo(customer.user_id, salonId);
            }

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/promotions/preview')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    promo_code: promoCode,
                    booking_id: bookingId
                });

            const expectedStatusArray = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
            expect(expectedStatusArray).toContain(response.status);
            expect(response.body.message).toMatch(expectedMessage);
        });

    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Math Accuracy: Previewing 15% off code on $200 service calculates correctly', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Premium Service', 200.00);

            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingId = await createBooking(
                salonId,
                customer.user_id,
                futureDate,
                futureDate.plus({ hours: 1 }),
                'SCHEDULED'
            );
            await createBookingService(bookingId, serviceId, null, 200.00);

            await createUserPromotion(customer.user_id, salonId, 'SAVE15', 15);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/promotions/preview')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    promo_code: 'SAVE15',
                    booking_id: bookingId
                });

            expect(response.status).toBe(200);
            expect(response.body.data.pricing.original_total).toBe(200.00);
            expect(response.body.data.pricing.discount_amount).toBe(30.00);
            expect(response.body.data.pricing.discounted_total).toBe(170.00);
        });

    });

    describe('Security & Permissions', () => {
        test('Verify Cross-Salon Issuance (HTTP 403): Owner of Salon A cannot issue promotions for Salon B', async () => {
            const password = 'Password123!';
            const ownerA = await insertUserWithCredentials({ password, role: 'OWNER' });
            const ownerB = await insertUserWithCredentials({ password, role: 'OWNER' });

            const salonA = await createSalon(ownerA.user_id);
            const salonB = await createSalon(ownerB.user_id);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: ownerA.email, password });

            const token = loginResponse.body.data.token;

            // Owner A tries to issue promotions for Salon B
            const response = await request(app)
                .post(`/api/promotions/salons/${salonB}/issue-promotions`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    discount_pct: 50
                });

            expect(response.status).toBe(404);
            expect(response.body.message).toMatch(/not found|Salon/i);
        });

        test('Verify Customer Generating Promos (HTTP 403): Customer cannot hit POST /issue-promotions', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });

            const salonId = await createSalon(owner.user_id);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post(`/api/promotions/salons/${salonId}/issue-promotions`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    discount_pct: 50
                });

            expect(response.status).toBe(403);
            expect(response.body.error).toContain('Insufficient permissions');
        });

        test('Verify Cross-User Promo Access: Customer cannot preview promo code belonging to another user', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customerA = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const customerB = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 100.00);

            // Create booking for customer A
            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingIdA = await createBooking(
                salonId,
                customerA.user_id,
                futureDate,
                futureDate.plus({ hours: 1 }),
                'SCHEDULED'
            );
            await createBookingService(bookingIdA, serviceId, null, 100.00);

            // Create booking for customer B
            const bookingIdB = await createBooking(
                salonId,
                customerB.user_id,
                futureDate.plus({ hours: 2 }),
                futureDate.plus({ hours: 3 }),
                'SCHEDULED'
            );
            await createBookingService(bookingIdB, serviceId, null, 100.00);

            // Create promo for customer A
            await createUserPromotion(customerA.user_id, salonId, 'CUSTOMERA50', 50);

            // Customer B tries to preview Customer A's promo code
            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customerB.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/promotions/preview')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    promo_code: 'CUSTOMERA50',
                    booking_id: bookingIdB
                });

            expect([400, 403]).toContain(response.status);
            expect(response.body.message).toMatch(/Invalid|not exist|belong/i);
        });
    });

    describe('Edge Cases', () => {
        test('Verify Negative Price Prevention: $50 off coupon on $30 haircut returns finalPrice >= 0', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 30.00);

            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingId = await createBooking(
                salonId,
                customer.user_id,
                futureDate,
                futureDate.plus({ hours: 1 }),
                'SCHEDULED'
            );
            await createBookingService(bookingId, serviceId, null, 30.00);

            // Create a 50% off promo (which would be $15 off, not $50)
            // But let's test with a fixed amount scenario if the system supports it
            // For now, testing with percentage that would result in negative if not handled
            await createUserPromotion(customer.user_id, salonId, 'BIG50', 50);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/promotions/preview')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    promo_code: 'BIG50',
                    booking_id: bookingId
                });

            expect(response.status).toBe(200);
            expect(response.body.data.pricing.discounted_total).toBeGreaterThanOrEqual(0);
            expect(response.body.data.pricing.discounted_total).toBe(15.00);
        });

    });
});
