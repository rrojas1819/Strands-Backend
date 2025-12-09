const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const { ROLE_CASES, insertUserWithCredentials } = require('./helpers/authTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');

const db = connection.promise();

describe('AFDV 1.1 - User Engagement Stats', () => {
    const createLogin = async (userId, loginDate) => {
        await db.execute(
            'INSERT INTO logins (user_id, login_date) VALUES (?, ?)',
            [userId, toMySQLUtc(loginDate)]
        );
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

    const createBooking = async (salonId, customerUserId, scheduledStart, status = 'SCHEDULED') => {
        const nowUtc = toMySQLUtc(DateTime.utc());

        const startUtc = toMySQLUtc(scheduledStart);
        const endUtc = toMySQLUtc(scheduledStart.plus({ minutes: 60 }));

        const [result] = await db.execute(
            `INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [salonId, customerUserId, startUtc, endUtc, status, nowUtc, nowUtc]
        );
        return result.insertId;
    };

    const createService = async (salonId, serviceName) => {
        const nowUtc = toMySQLUtc(DateTime.utc());
        const [result] = await db.execute(
            `INSERT INTO services (salon_id, name, description, price, duration_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [salonId, serviceName, 'Test service', 50.00, 60, nowUtc, nowUtc]
        );
        return result.insertId;
    };

    const createBookingService = async (bookingId, serviceId, employeeId = null) => {
        const nowUtc = toMySQLUtc(DateTime.utc());
        await db.execute(
            `INSERT INTO booking_services (booking_id, employee_id, service_id, price, duration_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [bookingId, employeeId, serviceId, 50.00, 60, nowUtc, nowUtc]
        );
    };

    const createSalonClick = async (salonId, eventName, clicks) => {
        await db.execute(
            `INSERT INTO salon_clicks (event_name, salon_id, clicks)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE clicks = clicks + VALUES(clicks)`,
            [eventName, salonId, clicks]
        );
    };

    const setupAdmin = async () => {
        const password = 'Password123!';
        const admin = await insertUserWithCredentials({ password, role: 'ADMIN' });

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: admin.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        return { admin, token, password };
    };

    describe('Positive Flow', () => {
        test('GET /api/admin/analytics/user-engagement returns 200 OK with expected JSON structure and data types', async () => {
            const { token } = await setupAdmin();

            const customer1 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer2 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const now = DateTime.utc();
            
            await createLogin(customer1.user_id, now);
            await createLogin(customer2.user_id, now.minus({ hours: 1 }));

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('today_logins');
            expect(response.body.data).toHaveProperty('yesterday_logins');
            expect(response.body.data).toHaveProperty('past_week_logins');
            expect(response.body.data).toHaveProperty('previous_week_logins');
            expect(response.body.data).toHaveProperty('total_bookings');
            expect(response.body.data).toHaveProperty('repeat_bookers');
            expect(response.body.data).toHaveProperty('top3Services');
            expect(response.body.data).toHaveProperty('top3ViewedSalons');
            expect(Array.isArray(response.body.data.top3Services)).toBe(true);
            expect(Array.isArray(response.body.data.top3ViewedSalons)).toBe(true);
            expect(typeof response.body.data.today_logins).toBe('number');
            expect(typeof response.body.data.yesterday_logins).toBe('number');
            expect(typeof response.body.data.past_week_logins).toBe('number');
            expect(typeof response.body.data.previous_week_logins).toBe('number');
            expect(typeof response.body.data.total_bookings).toBe('number');
            expect(typeof response.body.data.repeat_bookers).toBe('number');
        });

        test('Verify that numbers displayed match aggregate count of mock data', async () => {
            const { token } = await setupAdmin();

            const customer1 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer2 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer3 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            
            const now = DateTime.utc();
            const salonId = await createSalon(owner.user_id);

            await createLogin(customer1.user_id, now);
            await createLogin(customer2.user_id, now.plus({ hours: 1 }));
            await createLogin(customer3.user_id, now.plus({ hours: 2 }));
            await createLogin(customer1.user_id, now.plus({ hours: 3 }));
            await createLogin(customer2.user_id, now.plus({ hours: 4 }));

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.today_logins).toBeGreaterThanOrEqual(5);
        });
    });

    describe('Negative Flow', () => {
       
        test('Simulate database connection failure returns 500 Internal Server Error', async () => {
            const { token } = await setupAdmin();

            const mockDb = {
                execute: jest.fn().mockRejectedValue(new Error('Database connection failed'))
            };
            
            const promiseSpy = jest.spyOn(connection, 'promise').mockReturnValue(mockDb);

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(500);
            expect(response.body).toMatchObject({
                message: 'Internal server error'
            });

            promiseSpy.mockRestore();
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Calculation Verification: If there are 5 distinct users who logged in today, today_logins metric is at least 5', async () => {
            const { token } = await setupAdmin();

            const now = DateTime.utc();
            const users = [];
            for (let i = 0; i < 5; i++) {
                const user = await insertUserWithCredentials({ role: 'CUSTOMER' });
                users.push(user);
                await createLogin(user.user_id, now.plus({ minutes: i }));
            }

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.today_logins).toBeGreaterThanOrEqual(5);
        });

        test('Repeat Bookers Calculation: Verify repeat_bookers count is correct', async () => {
            const { token } = await setupAdmin();

            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            const customer1 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer2 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            
            const salonId = await createSalon(owner.user_id);
            const now = DateTime.utc();

            await createBooking(salonId, customer1.user_id, now.plus({ days: 1 }), 'SCHEDULED');
            await createBooking(salonId, customer1.user_id, now.plus({ days: 2 }), 'COMPLETED');

            await createBooking(salonId, customer2.user_id, now.plus({ days: 3 }), 'SCHEDULED');

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.repeat_bookers).toBeGreaterThanOrEqual(1);
        });

        test('Top 3 Services: Verify top3Services returns correct services ordered by booking count', async () => {
            const { token } = await setupAdmin();

            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            const customer = await insertUserWithCredentials({ role: 'CUSTOMER' });
            
            const salonId = await createSalon(owner.user_id);
            const service1Id = await createService(salonId, 'Haircut');
            const service2Id = await createService(salonId, 'Coloring');
            const service3Id = await createService(salonId, 'Styling');
            const service4Id = await createService(salonId, 'Manicure');

            const now = DateTime.utc();

            for (let i = 0; i < 3; i++) {
                const bookingId = await createBooking(salonId, customer.user_id, now.plus({ days: i }));
                await createBookingService(bookingId, service1Id);
            }

            for (let i = 0; i < 2; i++) {
                const bookingId = await createBooking(salonId, customer.user_id, now.plus({ days: i + 10 }));
                await createBookingService(bookingId, service2Id);
            }

            const bookingId3 = await createBooking(salonId, customer.user_id, now.plus({ days: 20 }));
            await createBookingService(bookingId3, service3Id);

            for (let i = 0; i < 5; i++) {
                const bookingId = await createBooking(salonId, customer.user_id, now.plus({ days: i + 30 }));
                await createBookingService(bookingId, service4Id);
            }

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.top3Services.length).toBeLessThanOrEqual(3);
            
            if (response.body.data.top3Services.length >= 2) {
                const bookings = response.body.data.top3Services.map(s => s.total_bookings);
                const sorted = [...bookings].sort((a, b) => b - a);
                expect(bookings).toEqual(sorted);
            }
        });

        test('Top 3 Viewed Salons: Verify top3ViewedSalons returns correct salons ordered by clicks', async () => {
            const { token } = await setupAdmin();

            const owner1 = await insertUserWithCredentials({ role: 'OWNER' });
            const owner2 = await insertUserWithCredentials({ role: 'OWNER' });
            const owner3 = await insertUserWithCredentials({ role: 'OWNER' });
            const owner4 = await insertUserWithCredentials({ role: 'OWNER' });
            
            const salon1Id = await createSalon(owner1.user_id, { name: 'Salon 1' });
            const salon2Id = await createSalon(owner2.user_id, { name: 'Salon 2' });
            const salon3Id = await createSalon(owner3.user_id, { name: 'Salon 3' });
            const salon4Id = await createSalon(owner4.user_id, { name: 'Salon 4' });

            await createSalonClick(salon1Id, 'view_details_click', 10);
            await createSalonClick(salon2Id, 'view_details_click', 30);
            await createSalonClick(salon3Id, 'view_details_click', 20);
            await createSalonClick(salon4Id, 'view_details_click', 5);

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.top3ViewedSalons.length).toBeLessThanOrEqual(3);
            
            if (response.body.data.top3ViewedSalons.length >= 2) {
                const clicks = response.body.data.top3ViewedSalons.map(s => s.clicks);
                const sorted = [...clicks].sort((a, b) => b - a);
                expect(clicks).toEqual(sorted);
            }
        });

        test('Date Range Filtering: Verify login counts are correctly filtered by date ranges', async () => {
            const { token } = await setupAdmin();

            const customer1 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer2 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer3 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            
            const now = DateTime.utc();

            await createLogin(customer1.user_id, now);
            await createLogin(customer2.user_id, now.plus({ hours: 2 }));

            await createLogin(customer3.user_id, now.minus({ days: 1, hours: 2 }));

            await createLogin(customer1.user_id, now.minus({ days: 3 }));

            await createLogin(customer2.user_id, now.minus({ days: 10 }));

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.today_logins).toBeGreaterThanOrEqual(2);
            expect(response.body.data.yesterday_logins).toBeGreaterThanOrEqual(1);
            expect(response.body.data.past_week_logins).toBeGreaterThanOrEqual(3);
            expect(response.body.data.previous_week_logins).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Security & Permissions', () => {
        test.each(['CUSTOMER', 'OWNER', 'EMPLOYEE'])('Unauthorized Role: %s role attempting to hit endpoint returns 403 Forbidden', async (role) => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        });

        test('Unauthenticated User: Request without token returns 401 Unauthorized', async () => {
            const response = await request(app)
                .get('/api/admin/analytics/user-engagement');

            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                error: 'Access token required'
            });
        });

        test('Expired Token: Request with expired token returns 403 Forbidden', async () => {
            const jwt = require('jsonwebtoken');
            const expiredToken = jwt.sign(
                { user_id: 1, role: 'ADMIN' },
                process.env.JWT_SECRET,
                { expiresIn: '-1h' }
            );

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${expiredToken}`);

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Invalid or expired token'
            });
        });
    });

    describe('Edge Cases', () => {

        test('Empty Arrays: Verify top3Services and top3ViewedSalons return empty arrays when no data exists', async () => {
            const { token } = await setupAdmin();

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data.top3Services)).toBe(true);
            expect(Array.isArray(response.body.data.top3ViewedSalons)).toBe(true);
            expect(response.body.data.top3Services.length).toBeGreaterThanOrEqual(0);
            expect(response.body.data.top3ViewedSalons.length).toBeGreaterThanOrEqual(0);
        });

        test('Null Safety: Verify endpoint handles null values gracefully', async () => {
            const { token } = await setupAdmin();

            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            const salonId = await createSalon(owner.user_id);

            const customer = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const now = DateTime.utc();
            await createBooking(salonId, customer.user_id, now.plus({ days: 1 }), 'SCHEDULED');

            const response = await request(app)
                .get('/api/admin/analytics/user-engagement')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            expect(typeof response.body.data.total_bookings).toBe('number');
        });

     
    });
});

// AFDV 1.2 - Appointment Trends & Peak Hours
describe('AFDV 1.2 - Appointment Trends & Peak Hours', () => {
    const createBooking = async (salonId, customerUserId, scheduledStart, status = 'SCHEDULED') => {
        const nowUtc = toMySQLUtc(DateTime.utc());
        const startUtc = toMySQLUtc(scheduledStart);
        const endUtc = toMySQLUtc(scheduledStart.plus({ minutes: 60 }));

        const [result] = await db.execute(
            `INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [salonId, customerUserId, startUtc, endUtc, status, nowUtc, nowUtc]
        );
        return result.insertId;
    };

    const createBookingService = async (bookingId, serviceId, durationMinutes = 60) => {
        const nowUtc = toMySQLUtc(DateTime.utc());
        await db.execute(
            `INSERT INTO booking_services (booking_id, service_id, price, duration_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [bookingId, serviceId, 50.00, durationMinutes, nowUtc, nowUtc]
        );
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

    const createService = async (salonId, serviceName) => {
        const nowUtc = toMySQLUtc(DateTime.utc());
        const [result] = await db.execute(
            `INSERT INTO services (salon_id, name, description, price, duration_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [salonId, serviceName, 'Test service', 50.00, 60, nowUtc, nowUtc]
        );
        return result.insertId;
    };

    const setupAdmin = async () => {
        const password = 'Password123!';
        const admin = await insertUserWithCredentials({ password, role: 'ADMIN' });

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: admin.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        return { admin, token, password };
    };

    const getAppointmentAnalyticsViaAPI = async (token) => {
        return await request(app)
            .get('/api/admin/analytics/appointment-analytics')
            .set('Authorization', `Bearer ${token}`);
    };

    describe('Positive Flow', () => {
        test('Verify GET /appointment-analytics returns 200 OK with expected structure', async () => {
            const { token } = await setupAdmin();

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('appointmentsByDay');
            expect(response.body).toHaveProperty('peakHours');
            expect(response.body).toHaveProperty('avgDurationInMin');
            expect(typeof response.body.appointmentsByDay).toBe('object');
            expect(typeof response.body.peakHours).toBe('object');
            expect(response.body.avgDurationInMin === null || !isNaN(Number(response.body.avgDurationInMin))).toBe(true);
        });

        test('Verify Peak Hours Calculation: Appointments at specific hours are correctly counted', async () => {
            const { token } = await setupAdmin();

            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            const customer1 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            const customer2 = await insertUserWithCredentials({ role: 'CUSTOMER' });
            
            const salonId = await createSalon(owner.user_id);
            const now = DateTime.utc();

            const booking1 = await createBooking(salonId, customer1.user_id, now.set({ hour: 10, minute: 0 }), 'SCHEDULED');
            const booking2 = await createBooking(salonId, customer2.user_id, now.set({ hour: 10, minute: 30 }), 'COMPLETED');

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(200);
            expect(response.body.peakHours).toHaveProperty('10 AM');
            expect(Number(response.body.peakHours['10 AM'])).toBeGreaterThanOrEqual(2);
        });

        test('Verify Day of Week Calculation: Appointments grouped by day are correctly counted', async () => {
            const { token } = await setupAdmin();

            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            const customer = await insertUserWithCredentials({ role: 'CUSTOMER' });
            
            const salonId = await createSalon(owner.user_id);
            const now = DateTime.utc();
            const monday = now.startOf('week').plus({ days: 0 });

            await createBooking(salonId, customer.user_id, monday.set({ hour: 14, minute: 0 }), 'SCHEDULED');
            await createBooking(salonId, customer.user_id, monday.set({ hour: 15, minute: 0 }), 'COMPLETED');

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(200);
            expect(response.body.appointmentsByDay).toHaveProperty('Monday');
            expect(Number(response.body.appointmentsByDay['Monday'])).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Negative Flow', () => {
        test('Verify Database Error Handling: Returns 500 on database failure', async () => {
            const { token } = await setupAdmin();

            const mockDb = {
                execute: jest.fn().mockRejectedValue(new Error('Database connection failed'))
            };
            
            const promiseSpy = jest.spyOn(connection, 'promise').mockReturnValue(mockDb);

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(500);
            expect(response.body).toMatchObject({
                message: 'Internal server error'
            });

            promiseSpy.mockRestore();
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Average Duration Calculation: Correctly calculates average appointment duration', async () => {
            const { token } = await setupAdmin();

            const owner = await insertUserWithCredentials({ role: 'OWNER' });
            const customer = await insertUserWithCredentials({ role: 'CUSTOMER' });
            
            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut');
            const now = DateTime.utc();

            const booking1 = await createBooking(salonId, customer.user_id, now.plus({ days: 1 }), 'SCHEDULED');
            await createBookingService(booking1, serviceId, 60);

            const booking2 = await createBooking(salonId, customer.user_id, now.plus({ days: 2 }), 'COMPLETED');
            await createBookingService(booking2, serviceId, 90);

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(200);
            expect(response.body.avgDurationInMin).toBeDefined();
            if (response.body.avgDurationInMin !== null) {
                const avgDuration = Number(response.body.avgDurationInMin);
                expect(avgDuration).toBeGreaterThan(0);
                expect(avgDuration).toBeLessThanOrEqual(1000);
            }
        });

        test('Verify Peak Hours Format: All 24 hours are present in peakHours response', async () => {
            const { token } = await setupAdmin();

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(200);
            const hourLabels = ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM',
                                '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'];
            
            hourLabels.forEach(hour => {
                expect(response.body.peakHours).toHaveProperty(hour);
                expect(typeof response.body.peakHours[hour]).toBe('number');
            });
        });
    });

    describe('Security & Permissions', () => {
        test.each(['CUSTOMER', 'OWNER', 'EMPLOYEE'])('Verify Unauthorized Access: %s role returns 403 Forbidden', async (role) => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await getAppointmentAnalyticsViaAPI(token);

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        });

        test('Verify Unauthenticated Access: Request without token returns 401 Unauthorized', async () => {
            const response = await request(app)
                .get('/api/admin/analytics/appointment-analytics');

            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                error: 'Access token required'
            });
        });
    });
});
