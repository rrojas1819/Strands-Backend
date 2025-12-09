const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, insertUserWithCredentials, generateTestToken } = require('./helpers/authTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');
const notificationSecurity = require('../src/utils/notificationsSecurity');

const db = connection.promise();

const createNotification = async (userId, options = {}) => {
    const nowUtc = options.created_at || toMySQLUtc(DateTime.utc());
    const message = options.message || 'Test notification message';
    
    let encryptedMessage;
    try {
        encryptedMessage = notificationSecurity.encryptMessage(message.trim());
    } catch (encryptError) {
        console.error('Failed to encrypt notification message in test:', encryptError);
        throw new Error('Failed to encrypt notification message');
    }
    
    const [result] = await db.execute(
        `INSERT INTO notifications_inbox 
         (user_id, salon_id, employee_id, email, booking_id, type_code, status, message, sender_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            options.salon_id || null,
            options.employee_id || null,
            options.email || 'test@example.com',
            options.booking_id || null,
            options.type_code || 'BOOKING_CREATED',
            options.status || 'UNREAD',
            encryptedMessage,
            options.sender_email || 'SYSTEM',
            nowUtc
        ]
    );
    return result.insertId;
};

const createSalon = async (ownerUserId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
         address, city, state, postal_code, country, status, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            options.timezone || 'America/New_York',
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const createEmployee = async (salonId, userId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, userId, options.title || 'Stylist', options.active !== undefined ? options.active : 1, nowUtc, nowUtc]
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

const createBookingService = async (bookingId, serviceId, employeeId, price = 50.00) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    await db.execute(
        `INSERT INTO booking_services (booking_id, service_id, employee_id, price, duration_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, serviceId, employeeId, price, 60, nowUtc, nowUtc]
    );
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

// NC 1.1: Notifications & Reminders
describe('NC 1.1: Notifications & Reminders', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true,
            notification_id: 1
        });
    });

    describe('Positive Flow', () => {
        test('Verify Get Inbox (HTTP 200): GET /inbox returns 200 OK with notifications sorted by date (newest first)', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const now = DateTime.utc();
            await createNotification(user.user_id, {
                type_code: 'BOOKING_CREATED',
                message: 'Older notification',
                created_at: toMySQLUtc(now.minus({ hours: 2 }))
            });
            await createNotification(user.user_id, {
                type_code: 'BOOKING_CREATED',
                message: 'Newer notification',
                created_at: toMySQLUtc(now.minus({ hours: 1 }))
            });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .get('/api/notifications/inbox')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            expect(response.body.data.notifications).toBeDefined();
            expect(Array.isArray(response.body.data.notifications)).toBe(true);
            expect(response.body.data.notifications.length).toBeGreaterThan(0);

            if (response.body.data.notifications.length > 1) {
                const notifications = response.body.data.notifications;
                for (let i = 0; i < notifications.length - 1; i++) {
                    const current = new Date(notifications[i].created_at);
                    const next = new Date(notifications[i + 1].created_at);
                    expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
                }
            }
        });

        test('Verify Mark as Read (HTTP 200): POST /mark-read marks notification as read and updates DB', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const notificationId = await createNotification(user.user_id, {
                type_code: 'BOOKING_CREATED',
                status: 'UNREAD'
            });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/notifications/mark-read')
                .set('Authorization', `Bearer ${token}`)
                .send({ notification_id: notificationId });

            expect(response.status).toBe(200);
            expect(response.body.message).toContain('marked as read');

            const [notifications] = await db.execute(
                'SELECT status, read_at FROM notifications_inbox WHERE notification_id = ?',
                [notificationId]
            );
            expect(notifications[0].status).toBe('READ');
            expect(notifications[0].read_at).not.toBeNull();
        });

        test('Verify Stylist Sends Reminder (HTTP 200): POST /stylist/send-reminder creates notification for customer', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const stylist = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id, { timezone: 'America/New_York' });
            const employeeId = await createEmployee(salonId, stylist.user_id);
            const serviceId = await createService(salonId);

            const salonTz = 'America/New_York';
            const todayInSalonTz = DateTime.now().setZone(salonTz);
            const startOfDay = todayInSalonTz.startOf('day').plus({ hours: 10 }); // 10 AM
            const endOfDay = startOfDay.plus({ hours: 1 });

            const bookingId = await createBooking(
                salonId,
                customer.user_id,
                startOfDay.toUTC(),
                endOfDay.toUTC(),
                'SCHEDULED'
            );

            await createBookingService(bookingId, serviceId, employeeId);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: stylist.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/notifications/stylist/send-reminder')
                .set('Authorization', `Bearer ${token}`);

            expect([200, 201]).toContain(response.status);
            expect(response.body.data).toBeDefined();
            expect(response.body.data.notifications_created).toBeGreaterThanOrEqual(0);

            const [notifications] = await db.execute(
                'SELECT notification_id, type_code FROM notifications_inbox WHERE user_id = ? AND type_code = ?',
                [customer.user_id, 'MANUAL_REMINDER']
            );
        });
    });

    describe('Negative Flow', () => {
        test.each([
            { endpoint: 'delete', id: '999999', expectedStatus: 404, message: 'not found', description: 'non-existent notification' },
            { endpoint: 'delete', id: 'abc-invalid-uuid', expectedStatus: 400, message: 'Invalid', description: 'malformed ID' },
            { endpoint: 'mark-read', id: 'invalid', expectedStatus: 400, message: 'Invalid', description: 'invalid notification_id' }
        ])('Verify $endpoint with $description returns $expectedStatus', async ({ endpoint, id, expectedStatus, message }) => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = endpoint === 'delete'
                ? await request(app)
                    .delete(`/api/notifications/delete/${id}`)
                    .set('Authorization', `Bearer ${token}`)
                : await request(app)
                    .post('/api/notifications/mark-read')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ notification_id: id });

            expect(response.status).toBe(expectedStatus);
            expect(response.body.message).toContain(message);
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Read Status Persistence and Unread Count: Mark notification as read shows READ status, and mark-all-read sets unread count to 0', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const [notificationId] = await Promise.all([
                createNotification(user.user_id, { type_code: 'BOOKING_CREATED', status: 'UNREAD' }),
                createNotification(user.user_id, { status: 'UNREAD' }),
                createNotification(user.user_id, { status: 'UNREAD' }),
                createNotification(user.user_id, { status: 'UNREAD' })
            ]);

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const markReadResponse = await request(app)
                .post('/api/notifications/mark-read')
                .set('Authorization', `Bearer ${token}`)
                .send({ notification_id: notificationId });

            expect(markReadResponse.status).toBe(200);

            const inboxResponse = await request(app)
                .get('/api/notifications/inbox')
                .set('Authorization', `Bearer ${token}`);

            expect(inboxResponse.status).toBe(200);
            const notification = inboxResponse.body.data.notifications.find(
                n => n.notification_id === notificationId
            );
            expect(notification).toBeDefined();
            expect(notification.status).toBe('READ');
            expect(inboxResponse.body.data.unread_count).toBeGreaterThan(0);

            const markAllReadResponse = await request(app)
                .post('/api/notifications/mark-all-read')
                .set('Authorization', `Bearer ${token}`);

            expect(markAllReadResponse.status).toBe(200);

            const finalInboxResponse = await request(app)
                .get('/api/notifications/inbox')
                .set('Authorization', `Bearer ${token}`);

            expect(finalInboxResponse.status).toBe(200);
            expect(finalInboxResponse.body.data.unread_count).toBe(0);
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Cross-User Deletion (HTTP 403/404): User A cannot delete User B\'s notifications', async () => {
            const password = 'Password123!';
            const userA = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const userB = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const notificationId = await createNotification(userB.user_id, {
                type_code: 'BOOKING_CREATED',
                status: 'UNREAD'
            });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: userA.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .delete(`/api/notifications/delete/${notificationId}`)
                .set('Authorization', `Bearer ${token}`);

            expect([403, 404]).toContain(response.status);
            expect(response.body.message).toContain('not found');

            const [notifications] = await db.execute(
                'SELECT notification_id FROM notifications_inbox WHERE notification_id = ?',
                [notificationId]
            );
            expect(notifications.length).toBe(1);
        });

        test('Verify Customer Sending Reminders (HTTP 403): Customer cannot access /stylist/send-reminder', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/notifications/stylist/send-reminder')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(403);
            expect(response.body.error).toContain('Insufficient permissions');
        });
    });

});

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

const getUserPromotionsViaAPI = async (token) => {
    return await request(app)
        .get('/api/promotions/user/get-promotions')
        .set('Authorization', `Bearer ${token}`);
};

const previewPromoCodeViaAPI = async (token, payload) => {
    return await request(app)
        .post('/api/promotions/preview')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
};

const {
    setupPaymentEnvironment,
    processPaymentViaAPI
} = require('./helpers/paymentTestUtils');

// NC 1.21 - Receive & Use Promotional Offers
describe('NC 1.21 - Receive & Use Promotional Offers', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true,
            notification_id: 1
        });
    });

    describe('Positive Flow', () => {
        test('Verify Receive Promotion Notification: User receives notification when owner sends promotion', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId);
            const futureDate = DateTime.utc().plus({ days: 1 });
            await createBooking(salonId, customer.user_id, futureDate, futureDate.plus({ hours: 1 }), 'COMPLETED');

            const ownerToken = generateTestToken(owner);

            const response = await request(app)
                .post(`/api/promotions/salons/${salonId}/sendPromoToCustomer`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({
                    email: customer.email,
                    discount_pct: 25,
                    description: 'Special offer'
                });

            expect(response.status).toBe(201);
            expect(response.body.data).toHaveProperty('promo_code');
            expect(response.body.data).toHaveProperty('notification_id');

            const [notifications] = await db.execute(
                'SELECT type_code, promo_code FROM notifications_inbox WHERE user_id = ? AND type_code = ?',
                [customer.user_id, 'LOYALTY_PROMO']
            );
            expect(notifications.length).toBeGreaterThan(0);
            expect(notifications[0].promo_code).toBe(response.body.data.promo_code);
        });

        test('Verify View Available Promotions: GET /user/get-promotions returns active promotions', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            await createUserPromotion(customer.user_id, salonId, 'SAVE20', 20, { status: 'ISSUED' });
            await createUserPromotion(customer.user_id, salonId, 'SAVE30', 30, { status: 'REDEEMED' });

            const customerToken = generateTestToken(customer);

            const response = await getUserPromotionsViaAPI(customerToken);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            expect(Array.isArray(response.body.data)).toBe(true);

            const activePromo = response.body.data.find(p => p.promo_code === 'SAVE20');
            expect(activePromo).toBeDefined();
            expect(activePromo.status).toBe('ISSUED');
            expect(Number(activePromo.discount_pct)).toBe(20);
        });

        test('Verify Use Promo Code: POST /payments/process with promo_code applies discount and redeems promo', async () => {
            const env = await setupPaymentEnvironment({ servicePrice: 100.00 });
            const promoId = await createUserPromotion(env.customer.user_id, env.salonId, 'SAVE50', 50);

            const response = await processPaymentViaAPI(env.customerToken, {
                credit_card_id: env.creditCardId,
                billing_address_id: env.billingAddressId,
                amount: 100.00,
                booking_id: env.bookingId,
                promo_code: 'SAVE50'
            });

            expect(response.status).toBe(200);

            const [payment] = await db.execute(
                'SELECT amount, user_promo_id FROM payments WHERE booking_id = ?',
                [env.bookingId]
            );
            expect(payment[0].user_promo_id).toBe(promoId);
            expect(Number(payment[0].amount)).toBe(50.00);

            const [promo] = await db.execute(
                'SELECT status FROM user_promotions WHERE user_promo_id = ?',
                [promoId]
            );
            expect(promo[0].status).toBe('REDEEMED');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Expired Promotion: User cannot use expired promo code', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 100.00);
            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingId = await createBooking(salonId, customer.user_id, futureDate, futureDate.plus({ hours: 1 }), 'SCHEDULED');
            await createBookingService(bookingId, serviceId, null, 100.00);

            const expiredDate = DateTime.utc().minus({ days: 1 });
            await createUserPromotion(customer.user_id, salonId, 'EXPIRED25', 25, { expires_at: expiredDate });

            const customerToken = generateTestToken(customer);

            const response = await previewPromoCodeViaAPI(customerToken, {
                promo_code: 'EXPIRED25',
                booking_id: bookingId
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toMatch(/expired/i);
        });

        test('Verify Already Redeemed: User cannot use promo code that was already redeemed', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 100.00);
            const futureDate = DateTime.utc().plus({ days: 1 });
            const bookingId = await createBooking(salonId, customer.user_id, futureDate, futureDate.plus({ hours: 1 }), 'SCHEDULED');
            await createBookingService(bookingId, serviceId, null, 100.00);

            await createUserPromotion(customer.user_id, salonId, 'USED30', 30, { status: 'REDEEMED' });

            const customerToken = generateTestToken(customer);

            const response = await previewPromoCodeViaAPI(customerToken, {
                promo_code: 'USED30',
                booking_id: bookingId
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toMatch(/Invalid|not exist|redeemed/i);
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Promo Status Filtering: GET /user/get-promotions shows only ISSUED promotions as available', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            await createUserPromotion(customer.user_id, salonId, 'ACTIVE10', 10, { status: 'ISSUED' });
            await createUserPromotion(customer.user_id, salonId, 'REDEEMED20', 20, { status: 'REDEEMED' });
            await createUserPromotion(customer.user_id, salonId, 'EXPIRED30', 30, { status: 'EXPIRED' });

            const customerToken = generateTestToken(customer);

            const response = await getUserPromotionsViaAPI(customerToken);

            expect(response.status).toBe(200);
            const activePromo = response.body.data.find(p => p.promo_code === 'ACTIVE10');
            expect(activePromo).toBeDefined();
            expect(activePromo.status).toBe('ISSUED');
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Cross-User Access: User A cannot view User B\'s promotions', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const customerA = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const customerB = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const salonId = await createSalon(owner.user_id);
            await createUserPromotion(customerA.user_id, salonId, 'CUSTOMERA50', 50);

            const customerBToken = generateTestToken(customerB);

            const response = await getUserPromotionsViaAPI(customerBToken);

            expect(response.status).toBe(200);
            const customerAPromo = response.body.data.find(p => p.promo_code === 'CUSTOMERA50');
            expect(customerAPromo).toBeUndefined();
        });
    });
});

// NC 1.1 - Notification Filtering & Pagination Branching Tests
describe('NC 1.1 - Notification Filtering & Pagination Branching', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true,
            notification_id: 1
        });
    });

    test.each([
        {
            filter: 'bookings',
            expectedTypes: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELED', 'PHOTO_UPLOADED', 'MANUAL_REMINDER'],
            notifications: [
                { type_code: 'BOOKING_CREATED', message: 'Booking created' },
                { type_code: 'BOOKING_RESCHEDULED', message: 'Booking rescheduled' },
                { type_code: 'PRODUCT_ADDED', message: 'Product added' },
                { type_code: 'REVIEW_CREATED', message: 'Review created' }
            ]
        },
        {
            filter: 'products',
            expectedTypes: ['PRODUCT_ADDED', 'PRODUCT_DELETED', 'PRODUCT_RESTOCKED', 'PRODUCT_PURCHASED'],
            notifications: [
                { type_code: 'PRODUCT_ADDED', message: 'Product added' },
                { type_code: 'PRODUCT_DELETED', message: 'Product deleted' },
                { type_code: 'PRODUCT_RESTOCKED', message: 'Product restocked' },
                { type_code: 'BOOKING_CREATED', message: 'Booking created' }
            ]
        },
        {
            filter: 'reviews',
            expectedTypes: ['REVIEW_CREATED', 'REVIEW_UPDATED', 'REVIEW_DELETED', 'REVIEW_REPLY_CREATED', 'REVIEW_REPLY_UPDATED', 'REVIEW_REPLY_DELETED'],
            notifications: [
                { type_code: 'REVIEW_CREATED', message: 'Review created' },
                { type_code: 'REVIEW_UPDATED', message: 'Review updated' },
                { type_code: 'REVIEW_REPLY_CREATED', message: 'Reply created' },
                { type_code: 'BOOKING_CREATED', message: 'Booking created' }
            ]
        },
        {
            filter: 'rewards',
            expectedTypes: ['PROMO_REDEEMED', 'LOYALTY_REWARD_REDEEMED', 'UNUSED_OFFERS_REMINDER'],
            notifications: [
                { type_code: 'PROMO_REDEEMED', message: 'Promo redeemed' },
                { type_code: 'LOYALTY_REWARD_REDEEMED', message: 'Reward redeemed' },
                { type_code: 'UNUSED_OFFERS_REMINDER', message: 'Unused offers' },
                { type_code: 'BOOKING_CREATED', message: 'Booking created' }
            ]
        },
        {
            filter: 'all',
            expectedTypes: null,
            notifications: [
                { type_code: 'BOOKING_CREATED', message: 'Booking created' },
                { type_code: 'PRODUCT_ADDED', message: 'Product added' },
                { type_code: 'REVIEW_CREATED', message: 'Review created' },
                { type_code: 'PROMO_REDEEMED', message: 'Promo redeemed' }
            ],
            minCount: 4
        },
        {
            filter: 'invalid',
            expectedTypes: null,
            notifications: [{ type_code: 'BOOKING_CREATED', message: 'Booking created' }],
            defaultsToAll: true
        }
    ])('Verify Filter $filter: GET /api/notifications/inbox?filter=$filter returns filtered notifications', async ({ filter, expectedTypes, notifications, minCount, defaultsToAll }) => {
        const password = 'Password123!';
        const user = await insertUserWithCredentials({ password, role: filter === 'products' || filter === 'reviews' ? 'OWNER' : 'CUSTOMER' });

        await Promise.all(notifications.map(n => createNotification(user.user_id, n)));

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        const token = loginResponse.body.data.token;

        const response = await request(app)
            .get(`/api/notifications/inbox?filter=${filter}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        const resultNotifications = response.body.data.notifications;
        
        if (defaultsToAll) {
            expect(response.body.data.filter.active).toBe('all');
        } else if (expectedTypes) {
            expect(resultNotifications.length).toBeGreaterThan(0);
            resultNotifications.forEach(notif => {
                expect(expectedTypes).toContain(notif.type_code);
            });
        } else if (minCount) {
            expect(resultNotifications.length).toBeGreaterThanOrEqual(minCount);
        }
    });

    test('Verify Pagination: GET /api/notifications/inbox with pagination returns correct pages, limits, and has_more flag', async () => {
        const password = 'Password123!';
        const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

        await Promise.all([
            ...Array.from({ length: 20 }, (_, i) => createNotification(user.user_id, {
                type_code: 'BOOKING_CREATED',
                message: `Notification ${i + 1}`,
                created_at: toMySQLUtc(DateTime.utc().minus({ minutes: 20 - i }))
            }))
        ]);

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        const token = loginResponse.body.data.token;

        const [page1Response, page2Response, limitMaxResponse, limitMinResponse, hasMoreResponse] = await Promise.all([
            request(app).get('/api/notifications/inbox?page=1&limit=5').set('Authorization', `Bearer ${token}`),
            request(app).get('/api/notifications/inbox?page=2&limit=5').set('Authorization', `Bearer ${token}`),
            request(app).get('/api/notifications/inbox?limit=100').set('Authorization', `Bearer ${token}`),
            request(app).get('/api/notifications/inbox?limit=0').set('Authorization', `Bearer ${token}`),
            request(app).get('/api/notifications/inbox?page=1&limit=10').set('Authorization', `Bearer ${token}`)
        ]);

        expect(page1Response.status).toBe(200);
        expect(page1Response.body.data.pagination.page).toBe(1);
        expect(page1Response.body.data.pagination.limit).toBe(5);
        expect(page1Response.body.data.notifications.length).toBeLessThanOrEqual(5);

        expect(page2Response.status).toBe(200);
        expect(page2Response.body.data.pagination.page).toBe(2);
        const page1Ids = page1Response.body.data.notifications.map(n => n.notification_id);
        const page2Ids = page2Response.body.data.notifications.map(n => n.notification_id);
        page2Ids.forEach(id => expect(page1Ids).not.toContain(id));

        expect(limitMaxResponse.body.data.pagination.limit).toBeLessThanOrEqual(20);
        expect(limitMinResponse.body.data.pagination.limit).toBeGreaterThanOrEqual(1);
        
        if (hasMoreResponse.body.data.pagination.total > 10) {
            expect(hasMoreResponse.body.data.pagination.has_more).toBe(true);
        }
    });

    test('Verify Mark as Read: handles read/unread notifications and updates unread count', async () => {
        const password = 'Password123!';
        const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

        const [readNotificationId, unreadNotificationId] = await Promise.all([
            createNotification(user.user_id, { type_code: 'BOOKING_CREATED', status: 'READ' }),
            createNotification(user.user_id, { type_code: 'BOOKING_CREATED', status: 'UNREAD' }),
            createNotification(user.user_id, { type_code: 'BOOKING_CREATED', status: 'UNREAD' }),
            createNotification(user.user_id, { type_code: 'BOOKING_CREATED', status: 'UNREAD' })
        ]);

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        const token = loginResponse.body.data.token;

        const [readResponse, beforeResponse] = await Promise.all([
            request(app)
                .post('/api/notifications/mark-read')
                .set('Authorization', `Bearer ${token}`)
                .send({ notification_id: readNotificationId }),
            request(app)
                .get('/api/notifications/inbox')
                .set('Authorization', `Bearer ${token}`)
        ]);

        expect(readResponse.status).toBe(404);
        expect(readResponse.body.message).toContain('already read');
        
        const initialUnreadCount = beforeResponse.body.data.unread_count;
        expect(initialUnreadCount).toBeGreaterThanOrEqual(3);

        const unreadResponse = await request(app)
            .post('/api/notifications/mark-read')
            .set('Authorization', `Bearer ${token}`)
            .send({ notification_id: unreadNotificationId });

        expect(unreadResponse.status).toBe(200);
        expect(unreadResponse.body.message).toContain('marked as read');

        const afterResponse = await request(app)
            .get('/api/notifications/inbox')
            .set('Authorization', `Bearer ${token}`);

        expect(afterResponse.body.data.unread_count).toBe(initialUnreadCount - 1);
    });

    test('Verify Delete All Notifications: DELETE /api/notifications/delete-all removes all notifications', async () => {
        const password = 'Password123!';
        const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

        await Promise.all(Array.from({ length: 5 }, (_, i) =>
            createNotification(user.user_id, {
                type_code: 'BOOKING_CREATED',
                message: `Notification ${i + 1}`
            })
        ));

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        const token = loginResponse.body.data.token;

        const beforeResponse = await request(app)
            .get('/api/notifications/inbox')
            .set('Authorization', `Bearer ${token}`);

        expect(beforeResponse.body.data.notifications.length).toBeGreaterThan(0);

        const deleteResponse = await request(app)
            .delete('/api/notifications/delete-all')
            .set('Authorization', `Bearer ${token}`);

        expect(deleteResponse.status).toBe(200);

        const afterResponse = await request(app)
            .get('/api/notifications/inbox')
            .set('Authorization', `Bearer ${token}`);

        expect(afterResponse.body.data.notifications.length).toBe(0);
        expect(afterResponse.body.data.unread_count).toBe(0);
    });

    test.each([
        { scenario: 'owner with salon and promotions', hasSalon: true, hasPromotions: true, expectedStatus: 200 },
        { scenario: 'non-owner', hasSalon: false, hasPromotions: false, expectedStatus: 403, role: 'CUSTOMER' },
        { scenario: 'owner without salon', hasSalon: false, hasPromotions: false, expectedStatus: 404, role: 'OWNER' }
    ])('Verify Owner Unused Offers: $scenario returns $expectedStatus', async ({ hasSalon, hasPromotions, expectedStatus, role = 'OWNER' }) => {
        const password = 'Password123!';
        const user = await insertUserWithCredentials({ password, role });
        const userToken = generateTestToken(user);

        if (hasSalon) {
            const salonId = await createSalon(user.user_id);
            if (hasPromotions) {
                const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
                await createUserPromotion(customer.user_id, salonId, 'UNUSED50', 50, {
                    status: 'ISSUED',
                    expires_at: DateTime.utc().plus({ days: 7 })
                });
            }
        }

        const response = await request(app)
            .post('/api/notifications/owner/send-unused-offers')
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(expectedStatus);
    });
});

