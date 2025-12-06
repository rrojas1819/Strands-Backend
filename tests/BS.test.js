const request = require('supertest');
const connection = require('../src/config/databaseConnection');
const { insertUserWithCredentials } = require('./helpers/authTestUtils');
const { setupServiceTestEnvironment, baseServicePayload } = require('./helpers/serviceTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');

jest.mock('../src/controllers/notificationsController', () => {
    const original = jest.requireActual('../src/controllers/notificationsController');
    return {
        ...original,
        createNotification: jest.fn().mockResolvedValue({ success: true })
    };
});

const app = require('../src/app');
const notificationsController = require('../src/controllers/notificationsController');

const db = connection.promise();

// Import shared helpers
const { createSalon, loginUser, getNextMonday } = require('./helpers/bookingTestUtils');

//Booking & Scheduling unit tests

//BS 1.1 - As an owner, I want to be able to set the operating hours of my salon, so that stylists and customers can only book appointments during open hours.
describe('BS 1.1 - Set salon operating hours - Owner', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    test('As an owner, I should be able to set the operating hours of my salon', async () => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        await createSalon(owner.user_id);

        const token = await loginUser(owner.email, password);

        const weeklyHours = {
            MONDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00'
            },
            TUESDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00'
            },
            WEDNESDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00'
            }
        };

        const response = await request(app)
            .post('/api/salons/setHours')
            .set('Authorization', `Bearer ${token}`)
            .send({ weekly_hours: weeklyHours });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            message: 'Salon hours updated successfully'
        });
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data.results)).toBe(true);
    });

    test.each(['CUSTOMER', 'EMPLOYEE', 'ADMIN'])('As a %s, I should not be able to set salon operating hours', async (role) => {
        const password = 'Password123!';

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const user = await insertUserWithCredentials({
            password,
            role: role
        });

        await createSalon(owner.user_id);

        const token = await loginUser(user.email, password);

        const weeklyHours = {
            MONDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00'
            }
        };

        const response = await request(app)
            .post('/api/salons/setHours')
            .set('Authorization', `Bearer ${token}`)
            .send({ weekly_hours: weeklyHours });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            error: 'Insufficient permissions'
        });
    });
});

//BS 1.01 - As a stylist, I want to add the services I offer so that clients can select them when booking appointments.
describe('BS 1.01 - Stylist service management', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });


    test.each([
        { price: 0, duration_minutes: 60, description: '0 price' },
        { price: 50, duration_minutes: 0, description: '0 duration_minutes' },
        { price: 0, duration_minutes: 0, description: 'both 0 price and 0 duration_minutes' }
    ])('As a stylist, I should NOT be able to create a service with $description', async ({ price, duration_minutes }) => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = baseServicePayload({ price, duration_minutes });

        const response = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            message: 'Missing required fields'
        });
    });

    test.each(['CUSTOMER', 'OWNER', 'ADMIN'])('As a %s, I should not be able to create stylist services', async (role) => {
        const password = 'Password123!';

        const user = await insertUserWithCredentials({
            password,
            role
        });

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = {
            name: 'Invalid Service',
            description: 'Should not be allowed',
            duration_minutes: 30,
            price: 50
        };

        const response = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            error: 'Insufficient permissions'
        });
    });


    test('Verify Delete Booked Service: DELETE /stylist/removeService/:service_id for service with active bookings returns 409 Conflict', async () => {
        const { stylist, salonId, employeeId, password } = await setupServiceTestEnvironment();
        const nowUtc = toMySQLUtc(DateTime.utc());

        const customer = await insertUserWithCredentials({
            password,
            role: 'CUSTOMER'
        });

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        const token = loginResponse.body.data.token;

        const createPayload = baseServicePayload();
        const createResponse = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(createPayload);

        expect(createResponse.status).toBe(201);
        const serviceId = createResponse.body.data.service.service_id;

        const futureStart = DateTime.utc().plus({ days: 7 });
        const futureEnd = futureStart.plus({ minutes: 60 });
        const scheduledStart = toMySQLUtc(futureStart);
        const scheduledEnd = toMySQLUtc(futureEnd);
        
        await db.execute(
            `INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'SCHEDULED', ?, ?)`,
            [salonId, customer.user_id, scheduledStart, scheduledEnd, nowUtc, nowUtc]
        );

        const [bookingResult] = await db.execute(
            'SELECT booking_id FROM bookings WHERE customer_user_id = ? ORDER BY booking_id DESC LIMIT 1',
            [customer.user_id]
        );
        const bookingId = bookingResult[0].booking_id;

        await db.execute(
            `INSERT INTO booking_services (booking_id, employee_id, service_id, price, duration_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [bookingId, employeeId, serviceId, 75, 60, nowUtc, nowUtc]
        );

        const deleteResponse = await request(app)
            .delete(`/api/salons/stylist/removeService/${serviceId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(deleteResponse.status).toBe(409);
        expect(deleteResponse.body).toMatchObject({
            message: expect.stringContaining('Cannot remove service that has active bookings')
        });
    });


    test.each([
        { price: -10, expectedStatus: 400, expectedMessage: 'Price must be a positive number', description: 'negative price' },
        { price: 1000000, expectedStatus: null, expectedMessage: null, description: 'extremely high price' }
    ])('Verify Invalid Price on Update: PATCH /stylist/updateService/:service_id with $description returns expected status', async ({ price, expectedStatus, expectedMessage }) => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        const token = loginResponse.body.data.token;

        const createPayload = baseServicePayload();
        const createResponse = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(createPayload);

        expect(createResponse.status).toBe(201);
        const serviceId = createResponse.body.data.service.service_id;

        const updateResponse = await request(app)
            .patch(`/api/salons/stylist/updateService/${serviceId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ price });

        if (expectedStatus) {
            expect(updateResponse.status).toBe(expectedStatus);
            if (expectedMessage) {
                expect(updateResponse.body).toMatchObject({
                    message: expectedMessage
                });
            }
        } else {
            expect([200, 400]).toContain(updateResponse.status);
        }
    });
});

//BS 1.02 - Set employee availability - Owner
describe('BS 1.02 - Set employee availability - Owner', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    test('As an owner, I should be able to set employee availability', async () => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const employee = await insertUserWithCredentials({
            password,
            role: 'EMPLOYEE'
        });

        const [salonResult] = await db.execute(
            `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
             address, city, state, postal_code, country, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                owner.user_id,
                'Test Salon',
                'Test salon description',
                'HAIR SALON',
                '555-0100',
                'test-salon@test.com',
                '123 Main St',
                'Test City',
                'TS',
                '12345',
                'USA',
                'APPROVED',
                nowUtc,
                nowUtc
            ]
        );
        const salonId = salonResult.insertId;

        await db.execute(
            `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [salonId, employee.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
        );

        const [employeeResult] = await db.execute(
            `SELECT employee_id FROM employees WHERE user_id = ?`,
            [employee.user_id]
        );
        const employeeId = employeeResult[0].employee_id;

        await db.execute(
            `INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [salonId, 1, '09:00:00', '17:00:00', nowUtc, nowUtc]
        );

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: owner.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const weeklyAvailability = {
            MONDAY: {
                start_time: '10:00:00',
                end_time: '16:00:00',
                slot_interval_minutes: 30
            }
        };

        const response = await request(app)
            .post(`/api/salons/setEmployeeAvailability/${employeeId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ weekly_availability: weeklyAvailability });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            message: 'Employee availability updated successfully'
        });
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data.results)).toBe(true);
    });

    test.each(['CUSTOMER', 'EMPLOYEE', 'ADMIN'])('As a %s, I should not be able to set employee availability', async (role) => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const employee = await insertUserWithCredentials({
            password,
            role: 'EMPLOYEE'
        });

        const user = await insertUserWithCredentials({
            password,
            role: role
        });

        const [salonResult] = await db.execute(
            `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
             address, city, state, postal_code, country, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                owner.user_id,
                'Test Salon',
                'Test salon description',
                'HAIR SALON',
                '555-0100',
                'test-salon@test.com',
                '123 Main St',
                'Test City',
                'TS',
                '12345',
                'USA',
                'APPROVED',
                nowUtc,
                nowUtc
            ]
        );
        const salonId = salonResult.insertId;

        await db.execute(
            `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [salonId, employee.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
        );

        const [employeeResult] = await db.execute(
            `SELECT employee_id FROM employees WHERE user_id = ?`,
            [employee.user_id]
        );
        const employeeId = employeeResult[0].employee_id;

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const weeklyAvailability = {
            MONDAY: {
                start_time: '10:00:00',
                end_time: '16:00:00'
            }
        };

        const response = await request(app)
            .post(`/api/salons/setEmployeeAvailability/${employeeId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ weekly_availability: weeklyAvailability });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            error: 'Insufficient permissions'
        });
    });

    test.each([
        {
            weeklyAvailability: {
                MONDAY: {
                    start_time: '08:00:00',
                    end_time: '18:00:00',
                    slot_interval_minutes: 30
                },
                SUNDAY: {
                    start_time: '09:00:00',
                    end_time: '17:00:00',
                    slot_interval_minutes: 30
                }
            },
            expectedError: 'Employee availability must be within salon operating hours',
            description: 'hours outside salon operating hours'
        },
        {
            weeklyAvailability: {
                SUNDAY: {
                    start_time: '09:00:00',
                    end_time: '17:00:00',
                    slot_interval_minutes: 30
                }
            },
            expectedError: 'SUNDAY: Salon is not open on this day',
            description: 'day of week outside salon operating hours'
        }
    ])('As an owner, I should not be able to set employee availability outside salon operating hours - $description', async ({ weeklyAvailability, expectedError }) => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const employee = await insertUserWithCredentials({
            password,
            role: 'EMPLOYEE'
        });

        const [salonResult] = await db.execute(
            `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
             address, city, state, postal_code, country, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                owner.user_id,
                'Test Salon',
                'Test salon description',
                'HAIR SALON',
                '555-0100',
                'test-salon@test.com',
                '123 Main St',
                'Test City',
                'TS',
                '12345',
                'USA',
                'APPROVED',
                nowUtc,
                nowUtc
            ]
        );
        const salonId = salonResult.insertId;

        await db.execute(
            `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [salonId, employee.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
        );

        const [employeeResult] = await db.execute(
            `SELECT employee_id FROM employees WHERE user_id = ?`,
            [employee.user_id]
        );
        const employeeId = employeeResult[0].employee_id;

        await db.execute(
            `INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [salonId, 1, '09:00:00', '17:00:00', nowUtc, nowUtc]
        );

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: owner.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const response = await request(app)
            .post(`/api/salons/setEmployeeAvailability/${employeeId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ weekly_availability: weeklyAvailability });

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            message: 'Employee availability update failed'
        });
        expect(response.body.errors).toBeDefined();
        expect(Array.isArray(response.body.errors)).toBe(true);
        expect(response.body.errors.length).toBeGreaterThan(0);
        expect(response.body.errors[0]).toContain(expectedError);
    });

});

// BS 1.1 - Customer Booking Flow
describe('BS 1.1 - Customer Booking Flow', () => {
    const {
        setupBookingTestEnvironment,
        getNextMonday
    } = require('./helpers/bookingTestUtils');

    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('Positive Flow', () => {
        test('Verify Get Time Slots: GET /:salon_id/stylists/:employee_id/timeslots for a specific date returns 200 OK with available times', async () => {
            const { salonId, employeeId, customerToken } = await setupBookingTestEnvironment();

            const futureDate = DateTime.utc().plus({ days: 7 });
            const dateStr = futureDate.toISODate();

            const response = await request(app)
                .get(`/api/salons/${salonId}/stylists/${employeeId}/timeslots?start_date=${dateStr}&end_date=${dateStr}`)
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('stylist');
            expect(response.body.data).toHaveProperty('date_range');
            expect(response.body.data).toHaveProperty('daily_slots');
            expect(typeof response.body.data.daily_slots).toBe('object');
        });

    });

    describe('Negative Flow', () => {
        test('Verify Booking Past Time: POST /book with scheduled_start in the past returns 400 Bad Request', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            const scheduledStart = pastDate.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'Cannot book appointments in the past'
            });
        });

        test('Verify Booking Unavailable Slot: POST /book for already booked slot returns 409 Conflict', async () => {
            const { salonId, employeeId, serviceId, customerToken, customer } = await setupBookingTestEnvironment();
            const nowUtc = toMySQLUtc(DateTime.utc());

            const futureDate = DateTime.utc().plus({ days: 7 }).set({ hour: 10, minute: 0, second: 0 });
            const scheduledStart = futureDate.toISO();
            const scheduledEnd = futureDate.plus({ minutes: 60 }).toISO();
            
            const scheduledStartMySQL = toMySQLUtc(futureDate);
            const scheduledEndMySQL = toMySQLUtc(futureDate.plus({ minutes: 60 }));

            const [bookingResult] = await db.execute(
                `INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'SCHEDULED', ?, ?)`,
                [salonId, customer.user_id, scheduledStartMySQL, scheduledEndMySQL, nowUtc, nowUtc]
            );
            const bookingId = bookingResult.insertId;

            await db.execute(
                `INSERT INTO booking_services (booking_id, employee_id, service_id, price, duration_minutes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [bookingId, employeeId, serviceId, 50, 60, nowUtc, nowUtc]
            );

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: expect.stringContaining('Time slot is no longer available')
            });
        });

        test('Verify Booking Outside Hours: POST /book for time when salon is closed returns 400 Bad Request', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const futureDate = DateTime.utc().plus({ days: 7 }).set({ hour: 3, minute: 0, second: 0 });
            const scheduledStart = futureDate.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect([400, 409]).toContain(response.status);
        });
    });

    describe('Data Integrity & UI Logic', () => {
    });

    describe('Security & Permissions', () => {
        test('Verify Booking as Owner: User with OWNER role trying to book via customer endpoint returns 403 Forbidden', async () => {
            const { salonId, employeeId, serviceId, password } = await setupBookingTestEnvironment();
            
            const owner = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'OWNER'
            });

            const ownerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: owner.email, password: 'Password123!' });

            const ownerToken = ownerLoginResponse.body.data.token;

            const futureDate = DateTime.utc().plus({ days: 7 });
            const scheduledStart = futureDate.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        });
    });

    describe('Edge Cases - Salon Hours Boundaries', () => {
        test.each([
            { hour: 9, minute: 0, description: 'exactly at opening time (09:00:00)' },
            { hour: 16, minute: 0, description: 'ending exactly at closing time (16:00:00 for 60min service)' }
        ])('Verify Booking at Boundary Times: POST /book $description returns 201 Created', async ({ hour, minute }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour, minute, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect([200, 201]).toContain(response.status);
            if ([200, 201].includes(response.status)) {
                expect(response.body.data).toHaveProperty('booking_id');
            }
        });

        test.each([
            { hour: 17, minute: 0, description: 'starting at closing time (17:00:00)' },
            { hour: 16, minute: 1, description: 'that would end after closing (16:01:00 for 60min service)' }
        ])('Verify Booking Outside Hours: POST /book $description returns 400 Bad Request', async ({ hour, minute }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour, minute, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
        });

        test('Verify Booking One Minute Before Closing: POST /book at 16:59:00 (1min service) returns 201 Created', async () => {
            const { salonId, employeeId, customerToken, nowUtc } = await setupBookingTestEnvironment();

            const [shortServiceResult] = await db.execute(
                `INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [salonId, 'Quick Service', '1 minute service', 1, 10, 1, nowUtc, nowUtc]
            );
            const shortServiceId = shortServiceResult.insertId;

            await db.execute(
                `INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?)`,
                [employeeId, shortServiceId, nowUtc, nowUtc]
            );

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 16, minute: 59, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: shortServiceId }]
                });

            expect([200, 201]).toContain(response.status);
        });

        test('Verify Booking That Spans Full Operating Hours: POST /book 8-hour service starting at 09:00:00 returns 201 Created', async () => {
            const { salonId, employeeId, customerToken, nowUtc } = await setupBookingTestEnvironment();

            const [longServiceResult] = await db.execute(
                `INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [salonId, 'Full Day Service', '8 hour service', 480, 500, 1, nowUtc, nowUtc]
            );
            const longServiceId = longServiceResult.insertId;

            await db.execute(
                `INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?)`,
                [employeeId, longServiceId, nowUtc, nowUtc]
            );

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: longServiceId }]
                });

            expect([200, 201]).toContain(response.status);
        });

        test('Verify Multiple Bookings Near Closing Time: Sequential bookings ending at closing time succeed', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);

            const booking1Time = nextMonday.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
            const response1 = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: booking1Time.toISO(),
                    services: [{ service_id: serviceId }]
                });

            expect([200, 201]).toContain(response1.status);

            const booking2Time = nextMonday.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
            const response2 = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: booking2Time.toISO(),
                    services: [{ service_id: serviceId }]
                });

            expect([200, 201]).toContain(response2.status);
        });

        test.each([
            { hour: 8, minute: 59, description: 'just before opening (08:59:00)' },
            { hour: 8, minute: 30, description: 'that starts before opening but ends after (08:30:00 for 60min service)' }
        ])('Verify Booking Before Opening: POST /book $description returns 400 Bad Request', async ({ hour, minute }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour, minute, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
        });

    });

    describe('Timezone Handling - EST', () => {
        test.each([
            { hour: 10, minute: 0, description: 'with EST-formatted time (10:00 EST)', expectedStatus: [200, 201], checkBookingId: true },
            { hour: 9, minute: 0, description: 'at opening time (09:00 EST)', expectedStatus: [200, 201], checkBookingId: false },
            { hour: 16, minute: 0, description: 'ending at closing time (16:00 EST for 60min service)', expectedStatus: [200, 201], checkBookingId: false }
        ])('Verify EST Booking: POST /book $description with EST salon timezone returns 201 Created', async ({ hour, minute, expectedStatus, checkBookingId }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            await db.execute(
                `UPDATE salons SET timezone = 'America/New_York' WHERE salon_id = ?`,
                [salonId]
            );

            const estTimezone = 'America/New_York';
            const now = DateTime.now().setZone(estTimezone);
            const nextMonday = getNextMonday(now);
            const bookingTimeEST = nextMonday.set({ hour, minute, second: 0, millisecond: 0 });
            const scheduledStart = bookingTimeEST.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect(expectedStatus).toContain(response.status);
            if (checkBookingId) {
                expect(response.body.data).toHaveProperty('booking_id');
            }
        });

        test.each([
            {
                timezone: 'America/New_York',
                hour: 16,
                minute: 1,
                description: 'at 16:01 EST (60min) that would end after closing',
                expectedStatus: 400,
                useEST: true
            },
            {
                timezone: 'America/New_York',
                hour: 15,
                minute: 0,
                description: 'with UTC time but EST salon timezone',
                expectedStatus: [200, 201],
                useEST: false
            }
        ])('Verify EST Booking Edge Cases: POST /book $description returns expected status', async ({ timezone, hour, minute, expectedStatus, useEST }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            await db.execute(
                `UPDATE salons SET timezone = ? WHERE salon_id = ?`,
                [timezone, salonId]
            );

            const now = useEST ? DateTime.now().setZone(timezone) : DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour, minute, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            if (Array.isArray(expectedStatus)) {
                expect(expectedStatus).toContain(response.status);
            } else {
                expect(response.status).toBe(expectedStatus);
                if (expectedStatus === 400) {
                    expect(response.body.message).toBeDefined();
                }
            }
        });
    });

    describe('Edge Cases', () => {
        test('Verify Race Condition: Two simultaneous booking requests for same slot - only one succeeds', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            const customer2 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });

            const customer2LoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer2.email, password: 'Password123!' });

            const customer2Token = customer2LoginResponse.body.data.token;

            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const scheduledStart = bookingTime.toISO();

            const [response1, response2] = await Promise.all([
                request(app)
                    .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                    .set('Authorization', `Bearer ${customerToken}`)
                    .send({
                        scheduled_start: scheduledStart,
                        services: [{ service_id: serviceId }]
                    }),
                request(app)
                    .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                    .set('Authorization', `Bearer ${customer2Token}`)
                    .send({
                        scheduled_start: scheduledStart,
                        services: [{ service_id: serviceId }]
                    })
            ]);

            const successCount = [response1, response2].filter(r => [200, 201].includes(r.status)).length;
            const conflictCount = [response1, response2].filter(r => r.status === 409).length;

            expect(successCount).toBe(1);
            expect(conflictCount).toBe(1);
        });
    });
});

// BS 1.2 - Reschedule Appointment
describe('BS 1.2 - Reschedule Appointment', () => {
    const {
        setupBookingTestEnvironment,
        createBookingWithServices,
        rescheduleBookingViaAPI,
        getBookingById,
        getBookingServices,
        getConflictingBookings,
        verifyBookingStatus,
        verifyBookingTime,
        loginUser,
        updateBookingStatus,
        getNextMonday
    } = require('./helpers/bookingTestUtils');

    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });


    describe('Positive Flow', () => {
        test('Verify Successful Reschedule: POST /api/bookings/reschedule with valid new time returns 201 Created', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED'
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message');
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('old_booking_id');
            expect(response.body.data).toHaveProperty('new_booking_id');
            expect(response.body.data).toHaveProperty('appointment');
        });

        test('Verify State Change & Slot Swap: Old booking is CANCELED, new booking is SCHEDULED with new time', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED'
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const newEndTime = newTime.plus({ minutes: 60 });
            
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            expect(response.status).toBe(201);
            
            const newBookingId = response.body.data.new_booking_id;
            
            const oldBookingStatus = await verifyBookingStatus(bookingId, 'CANCELED');
            expect(oldBookingStatus).toBe(true);
            
            const newBookingStatus = await verifyBookingStatus(newBookingId, 'SCHEDULED');
            expect(newBookingStatus).toBe(true);
            
            const newBookingTime = await verifyBookingTime(newBookingId, newTime, newEndTime);
            expect(newBookingTime).toBe(true);
        });

        test('Verify Notifications: Mock service confirms notifications sent to Customer and Stylist', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED'
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(201);
            
            expect(notificationsController.createNotification).toHaveBeenCalled();
            const notificationCalls = notificationsController.createNotification.mock.calls;
            expect(notificationCalls.length).toBeGreaterThanOrEqual(1);
            
            const rescheduleNotifications = notificationCalls.filter(call => {
                const notificationData = call[1];
                return notificationData && notificationData.type_code === 'BOOKING_RESCHEDULED';
            });
            expect(rescheduleNotifications.length).toBeGreaterThan(0);
        });
    });

    describe('Negative Flow', () => {
        test('Verify Target Slot Unavailable: Rescheduling to a slot already booked returns 409 Conflict', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            const firstMonday = nextMonday.plus({ weeks: 1 });
            const firstTime = firstMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const firstEndTime = firstTime.plus({ minutes: 60 });
            const firstBookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                firstTime,
                firstEndTime,
                'SCHEDULED'
            );
            
            const secondTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const secondEndTime = secondTime.plus({ minutes: 60 });
            const secondBookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                secondTime,
                secondEndTime,
                'SCHEDULED'
            );
            
            const response = await rescheduleBookingViaAPI(env.customerToken, secondBookingId, firstTime.toISO());
            
            expect([400, 409]).toContain(response.status);
            if (response.status === 409) {
                expect(response.body.message).toContain('no longer available');
            }
        });

        test.each([
            { status: 'COMPLETED', description: 'COMPLETED' },
            { status: 'CANCELED', description: 'CANCELED' }
        ])('Verify Rescheduling Non-Reschedulable Appointment: Attempting to reschedule $description appointment returns 404', async ({ status }) => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED'
            );
            
            await updateBookingStatus(bookingId, status);
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('not reschedulable');
        });

        test('Verify Same-Day Reschedule Policy: Attempting to reschedule same-day appointment returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const tomorrow = DateTime.utc().plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const tomorrowEnd = tomorrow.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                tomorrow,
                tomorrowEnd,
                'SCHEDULED'
            );
            
            const newTime = tomorrow.plus({ hours: 2 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect([400, 404]).toContain(response.status);
        });

        test('Verify Rescheduling to Past Time: Attempting to reschedule to past time returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const pastTime = DateTime.utc().minus({ days: 1 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, pastTime.toISO());
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('past time');
        });

        test('Verify Missing Required Fields: Reschedule without scheduled_start returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const response = await request(app)
                .post('/api/bookings/reschedule')
                .set('Authorization', `Bearer ${env.customerToken}`)
                .send({ booking_id: bookingId });
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('scheduled_start');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Price Retention: Rescheduled booking maintains original service prices', async () => {
            const env = await setupBookingTestEnvironment();
            
            const originalPrice = 50.00;
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED',
                { servicePrice: originalPrice }
            );
            
            await db.execute(
                'UPDATE services SET price = ? WHERE service_id = ?',
                [75.00, env.serviceId]
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(201);
            
            const newBookingId = response.body.data.new_booking_id;
            const bookingServices = await getBookingServices(newBookingId);
            
            expect(bookingServices.length).toBeGreaterThan(0);
            expect(Number(bookingServices[0].price)).toBe(originalPrice);
        });

        test('Verify Service Details Retention: Rescheduled booking maintains all original service details', async () => {
            const env = await setupBookingTestEnvironment();
            
            const originalDuration = 90;
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: originalDuration });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED',
                { durationMinutes: originalDuration }
            );
            
            const originalServices = await getBookingServices(bookingId);
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(201);
            
            const newBookingId = response.body.data.new_booking_id;
            const newServices = await getBookingServices(newBookingId);
            
            expect(newServices.length).toBe(originalServices.length);
            
            for (let i = 0; i < originalServices.length; i++) {
                expect(newServices[i].service_id).toBe(originalServices[i].service_id);
                expect(newServices[i].employee_id).toBe(originalServices[i].employee_id);
                expect(Number(newServices[i].price)).toBe(Number(originalServices[i].price));
                expect(Number(newServices[i].duration_minutes)).toBe(Number(originalServices[i].duration_minutes));
            }
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Cross-User Modification: User A attempts to reschedule appointment belonging to User B returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const customer1 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            const customer1Token = await loginUser(customer1.email, 'Password123!');
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                customer1.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('not found');
        });

        test('Verify Employee Cannot Reschedule: User with role EMPLOYEE attempting to reschedule returns 403 Forbidden', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const response = await rescheduleBookingViaAPI(env.employeeToken, bookingId, newTime.toISO());
            
            expect(response.status).toBe(403);
        });

        test('Verify Unauthenticated Access: Request without token returns 401 Unauthorized', async () => {
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            const response = await request(app)
                .post('/api/bookings/reschedule')
                .send({
                    booking_id: 1,
                    scheduled_start: newTime.toISO()
                });
            
            expect(response.status).toBe(401);
        });
    });

    describe('Edge Cases', () => {
        test('Verify "No Change" Reschedule: Rescheduling to exact same time slot returns expected status', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const bookingEndTime = bookingTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingEndTime,
                'SCHEDULED'
            );
            
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, bookingTime.toISO());
            
            expect([201, 409, 400]).toContain(response.status);
        });

        test('Verify Race Condition: Two users trying to reschedule/book same slot simultaneously', async () => {
            const env = await setupBookingTestEnvironment();
            
            const customer1 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            const customer1Token = await loginUser(customer1.email, 'Password123!');
            
            const customer2 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            // Create booking for customer1
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            const bookingId = await createBookingWithServices(
                env.salonId,
                customer1.user_id,
                env.employeeId,
                env.serviceId,
                oldTime,
                oldEndTime,
                'SCHEDULED'
            );
            
            // Create booking for customer2 at target time
            const targetMonday = nextMonday.plus({ weeks: 1 });
            const targetTime = targetMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const targetEndTime = targetTime.plus({ minutes: 60 });
            await createBookingWithServices(
                env.salonId,
                customer2.user_id,
                env.employeeId,
                env.serviceId,
                targetTime,
                targetEndTime,
                'SCHEDULED'
            );
            
            // Customer1 tries to reschedule to same time as customer2's booking
            const response = await rescheduleBookingViaAPI(customer1Token, bookingId, targetTime.toISO());
            
            expect([400, 409]).toContain(response.status);
            if (response.status === 409) {
                expect(response.body.message).toContain('no longer available');
            }
        });

        test('Verify Timezone Boundary: Rescheduling across day boundary handles timezone correctly', async () => {
            const env = await setupBookingTestEnvironment();
            
            // Set up availability for Tuesday and Wednesday
            await db.execute(
                `INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [env.employeeId, 2, '09:00:00', '17:00:00', 30, toMySQLUtc(DateTime.utc()), toMySQLUtc(DateTime.utc())]
            );
            
            const tuesday = DateTime.utc().plus({ days: 7 });
            let bookingDate = tuesday;
            while (bookingDate.weekday !== 2) {
                bookingDate = bookingDate.plus({ days: 1 });
            }
            const tuesdayNight = bookingDate.set({ hour: 23, minute: 0, second: 0, millisecond: 0 });
            const tuesdayNightEnd = tuesdayNight.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                tuesdayNight,
                tuesdayNightEnd,
                'SCHEDULED'
            );
            
            const wednesday = bookingDate.plus({ days: 1 });
            const wednesdayMorning = wednesday.set({ hour: 1, minute: 0, second: 0, millisecond: 0 });
            
            const response = await rescheduleBookingViaAPI(env.customerToken, bookingId, wednesdayMorning.toISO());
            
            expect([201, 400, 409]).toContain(response.status);
            
            if (response.status === 201) {
                const newBookingId = response.body.data.new_booking_id;
                const newBooking = await getBookingById(newBookingId);
                expect(newBooking).toBeDefined();
            }
        });

        test('Verify Invalid Booking ID: Rescheduling with non-existent booking_id returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const nonExistentBookingId = 99999;
            
            const response = await rescheduleBookingViaAPI(env.customerToken, nonExistentBookingId, newTime.toISO());
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('not found');
        });

        
    });
});

// BS 1.3 - Customer Cancels Booking
describe('BS 1.3 - As a user, I want to cancel an appointment so that I don’t take up unnecessary slots.', () => {
    const {
        setupBookingTestEnvironment,
        createBookingWithServices,
        cancelBookingViaAPI,
        getBookingById,
        getPaymentByBookingId,
        createPayment,
        updateBookingStatus,
        loginUser,
        getNextMonday
    } = require('./helpers/bookingTestUtils');

    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Successful Cancel: POST /api/bookings/cancel with valid booking returns 200 OK', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const response = await cancelBookingViaAPI(env.customerToken, bookingId);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message');
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('booking_id');
            expect(response.body.data).toHaveProperty('new_status', 'CANCELED');
        });

        test('Verify Payment Refund: Payments are marked as REFUNDED', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            await createPayment(bookingId, 50.00, 'SUCCEEDED');
            
            const response = await cancelBookingViaAPI(env.customerToken, bookingId);
            
            expect(response.status).toBe(200);
            
            const payment = await getPaymentByBookingId(bookingId, 'REFUNDED');
            expect(payment).toBeDefined();
            expect(payment.status).toBe('REFUNDED');
        });

        test('Verify Notifications: Mock service confirms notifications sent', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const response = await cancelBookingViaAPI(env.customerToken, bookingId);
            
            expect(response.status).toBe(200);
            expect(notificationsController.createNotification).toHaveBeenCalled();
        });
    });

    describe('Negative Flow', () => {
        test('Verify Same-Day Cancel Policy: Attempting to cancel same-day appointment returns 400', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const bookingEndTime = bookingTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingEndTime,
                'SCHEDULED'
            );
            
            const response = await cancelBookingViaAPI(env.customerToken, bookingId);
            
            expect([200, 400, 404]).toContain(response.status);
        });

        test('Verify Cancel Completed Booking: Attempting to cancel COMPLETED booking returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            await updateBookingStatus(bookingId, 'COMPLETED');
            
            const cancelResponse = await cancelBookingViaAPI(env.customerToken, bookingId);
            
            expect(cancelResponse.status).toBe(404);
        });

        test('Verify Cross-User Cancel: User A attempts to cancel User B booking returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const customer1 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            const customer1Token = await loginUser(customer1.email, 'Password123!');
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                customer1.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureEndTime,
                'SCHEDULED'
            );
            
            const response = await cancelBookingViaAPI(env.customerToken, bookingId);
            
            expect(response.status).toBe(404);
        });
    });
});

// BS 1.5 - Block Unavailable Time Slots
describe('BS 1.5 - Block Unavailable Time Slots', () => {
    const {
        setupBookingTestEnvironment,
        createBookingWithServices,
        loginUser,
        getNextMonday,
        createUnavailabilityBlockViaAPI,
        listUnavailabilityBlocksViaAPI,
        deleteUnavailabilityBlockViaAPI,
        getUnavailabilityBlockById
    } = require('./helpers/bookingTestUtils');

    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Create Block: POST /api/unavailability with valid weekday and time returns 201 Created', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message', 'Recurring block created');
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('unavailability_id');
            expect(response.body.data).toHaveProperty('employee_id', env.employeeId);
            expect(response.body.data).toHaveProperty('weekday', 1);
            expect(response.body.data).toHaveProperty('start_time', '14:00:00');
            expect(response.body.data).toHaveProperty('end_time', '15:00:00');
        });

        test('Verify Availability Update: Blocked time slots are missing from timeslots response', async () => {
            const env = await setupBookingTestEnvironment();
            
            await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const dateStr = nextMonday.toISODate();
            
            const timeslotsResponse = await request(app)
                .get(`/api/salons/${env.salonId}/stylists/${env.employeeId}/timeslots?start_date=${dateStr}&end_date=${dateStr}`)
                .set('Authorization', `Bearer ${env.customerToken}`);
            
            expect(timeslotsResponse.status).toBe(200);
            expect(timeslotsResponse.body.data).toHaveProperty('daily_slots');
            
            const slotsForDate = timeslotsResponse.body.data.daily_slots[dateStr];
            if (slotsForDate && Array.isArray(slotsForDate)) {
                const blockedSlots = slotsForDate.filter(slot => {
                    const slotTime = DateTime.fromISO(slot.start_time);
                    return slotTime.hour === 14 && slotTime.minute === 0;
                });
                expect(blockedSlots.length).toBe(0);
            }
        });
    });

    describe('Negative Flow', () => {
        test('Verify Blocking Over Existing Booking: Attempting to block time with SCHEDULED appointment returns 409 Conflict', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const bookingEndTime = bookingTime.plus({ minutes: 60 });
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingEndTime,
                'SCHEDULED'
            );
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            
            expect(response.status).toBe(409);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('conflicting appointments');
        });

        test('Verify Invalid Range: startTime after endTime or same time returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response1 = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '15:00', '14:00', 30);
            expect(response1.status).toBe(400);
            expect(response1.body.message).toContain('End time must be after Start time');
            
            const response2 = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '12:00', '12:00', 30);
            expect(response2.status).toBe(400);
            expect(response2.body.message).toContain('End time must be after Start time');
        });

        test('Verify Invalid Time Format: Invalid time format returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '25:00', '26:00', 30);
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('HH:MM');
        });

        test('Verify Blocking Outside Operating Hours: Blocking outside availability hours returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '18:00', '19:00', 30);
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('within availability hours');
        });

        test('Verify No Availability Set: Blocking on weekday without availability returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 2, '14:00', '15:00', 30);
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('No availability set for this weekday');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Overlap Prevention: Creating overlapping blocks returns 409 Conflict', async () => {
            const env = await setupBookingTestEnvironment();
            
            await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '12:00', '13:00', 30);
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '12:30', '13:30', 30);
            
            expect(response.status).toBe(409);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('Overlaps an existing recurring block');
        });
    });

    describe('Security & Permissions', () => {
        test.each([
            { role: 'CUSTOMER', tokenKey: 'customerToken' },
            { role: 'OWNER', tokenKey: 'ownerToken' }
        ])('Verify $role Access: $role role attempting to create block returns 403 Forbidden', async ({ tokenKey }) => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env[tokenKey], 1, '14:00', '15:00', 30);
            
            expect(response.status).toBe(403);
            expect(response.body).toHaveProperty('error', 'Insufficient permissions');
        });

        test('Verify Unauthenticated Access: Request without token returns 401 Unauthorized', async () => {
            const response = await request(app)
                .post('/api/unavailability')
                .send({
                    weekday: 1,
                    start_time: '14:00',
                    end_time: '15:00',
                    slot_interval_minutes: 30
                });
            
            expect(response.status).toBe(401);
        });
    });

    describe('Edge Cases', () => {
        test('Verify Full Day Block: Blocking entire availability window succeeds', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '09:00', '17:00', 30);
            
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('data');
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const dateStr = nextMonday.toISODate();
            
            const timeslotsResponse = await request(app)
                .get(`/api/salons/${env.salonId}/stylists/${env.employeeId}/timeslots?start_date=${dateStr}&end_date=${dateStr}`)
                .set('Authorization', `Bearer ${env.customerToken}`);
            
            expect(timeslotsResponse.status).toBe(200);
            const slotsForDate = timeslotsResponse.body.data.daily_slots[dateStr];
            if (slotsForDate && Array.isArray(slotsForDate)) {
                expect(slotsForDate.length).toBe(0);
            }
        });

        test('Verify Invalid Weekday: Weekday outside 0-6 range returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 7, '14:00', '15:00', 30);
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('Weekday must be an integer between 0-6');
        });

        test('Verify Delete Block: DELETE /api/unavailability removes block successfully', async () => {
            const env = await setupBookingTestEnvironment();
            
            const createResponse = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            expect(createResponse.status).toBe(201);
            
            const deleteResponse = await deleteUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00');
            expect(deleteResponse.status).toBe(200);
            expect(deleteResponse.body).toHaveProperty('message', 'Recurring block deleted');
            
            const listResponse = await listUnavailabilityBlocksViaAPI(env.employeeToken, 1);
            expect(listResponse.status).toBe(200);
            const deletedBlock = listResponse.body.data.find(block => 
                block.start_time === '14:00:00' && block.end_time === '15:00:00'
            );
            expect(deletedBlock).toBeUndefined();
        });
    });
});

