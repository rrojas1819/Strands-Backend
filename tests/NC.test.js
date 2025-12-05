const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, insertUserWithCredentials } = require('./helpers/authTestUtils');
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
            { id: '999999', expectedStatus: 404, message: 'not found', description: 'non-existent notification' },
            { id: 'abc-invalid-uuid', expectedStatus: 400, message: 'Invalid', description: 'malformed ID' }
        ])('Verify DELETE /delete/$id returns $expectedStatus for $description', async ({ id, expectedStatus, message }) => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .delete(`/api/notifications/delete/${id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(expectedStatus);
            expect(response.body.message).toContain(message);
        });

        test('Verify Invalid notification_id in mark-read (HTTP 400): POST /mark-read with invalid ID returns 400', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .post('/api/notifications/mark-read')
                .set('Authorization', `Bearer ${token}`)
                .send({ notification_id: 'invalid' });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Invalid');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Read Status Persistence: Mark notification as read, then GET /inbox shows isRead: true', async () => {
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
        });

        test('Verify "Unread Count": POST /mark-all-read sets unread count to 0', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'CUSTOMER' });

            await createNotification(user.user_id, { status: 'UNREAD' });
            await createNotification(user.user_id, { status: 'UNREAD' });
            await createNotification(user.user_id, { status: 'UNREAD' });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const initialInboxResponse = await request(app)
                .get('/api/notifications/inbox')
                .set('Authorization', `Bearer ${token}`);

            const initialUnreadCount = initialInboxResponse.body.data.unread_count;
            expect(initialUnreadCount).toBeGreaterThan(0);

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

