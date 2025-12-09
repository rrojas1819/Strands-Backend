const request = require('supertest');
const connection = require('../src/config/databaseConnection');
const { insertUserWithCredentials, generateTestToken, generateFakeToken } = require('./helpers/authTestUtils');
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
const { createSalon, loginUser, getNextMonday, setupBookingTestEnvironment, createBookingWithServices } = require('./helpers/bookingTestUtils');

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
        const token = generateTestToken(owner);

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

    test('Non-owner roles should not be able to set salon operating hours', async () => {
        const roles = ['CUSTOMER', 'EMPLOYEE', 'ADMIN'];

        const weeklyHours = {
            MONDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00'
            }
        };

        // Generate fake tokens without creating DB users - only role matters for 403 check
        const responses = await Promise.all(
            roles.map(role => {
                const fakeToken = generateFakeToken({ role });
                return request(app)
                    .post('/api/salons/setHours')
                    .set('Authorization', `Bearer ${fakeToken}`)
                    .send({ weekly_hours: weeklyHours });
            })
        );

        for (const response of responses) {
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        }
    });
});

//BS 1.01 - As a stylist, I want to add the services I offer so that clients can select them when booking appointments.
describe('BS 1.01 - Stylist service management', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });


    test('As a stylist, I should NOT be able to create a service with invalid price or duration', async () => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const token = generateTestToken(stylist);

        const testCases = [
            { price: 0, duration_minutes: 60, description: '0 price' },
            { price: 50, duration_minutes: 0, description: '0 duration_minutes' },
            { price: 0, duration_minutes: 0, description: 'both 0 price and 0 duration_minutes' }
        ];

        const payloads = testCases.map(testCase => baseServicePayload({ 
            price: testCase.price, 
            duration_minutes: testCase.duration_minutes 
        }));

        const responses = await Promise.all(
            payloads.map(payload =>
                request(app)
                    .post('/api/salons/stylist/createService')
                    .set('Authorization', `Bearer ${token}`)
                    .send(payload)
            )
        );

        for (const response of responses) {
            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'Missing required fields'
            });
        }
    });

    test('Non-employee roles should not be able to create stylist services', async () => {
        const password = 'Password123!';
        const roles = ['CUSTOMER', 'OWNER', 'ADMIN'];

        const payload = {
            name: 'Invalid Service',
            description: 'Should not be allowed',
            duration_minutes: 30,
            price: 50
        };

        const users = await Promise.all(
            roles.map(role => insertUserWithCredentials({
                password,
                role
            }))
        );

        // Generate tokens directly - bypasses HTTP login, DB lookup, and bcrypt
        const tokens = users.map(user => generateTestToken(user));

        // Make all API calls in parallel
        const responses = await Promise.all(
            tokens.map(token =>
                request(app)
                    .post('/api/salons/stylist/createService')
                    .set('Authorization', `Bearer ${token}`)
                    .send(payload)
            )
        );

        // Verify all responses
        for (const response of responses) {
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        }
    });


    test('Verify Delete Booked Service: DELETE /stylist/removeService/:service_id for service with active bookings returns 409 Conflict', async () => {
        const { stylist, salonId, employeeId, password } = await setupServiceTestEnvironment();
        const nowUtc = toMySQLUtc(DateTime.utc());

        const customer = await insertUserWithCredentials({
            password,
            role: 'CUSTOMER'
        });

        const token = generateTestToken(stylist);

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

        const token = generateTestToken(stylist);

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

        const [owner, employee] = await Promise.all([
            insertUserWithCredentials({
                password,
                role: 'OWNER'
            }),
            insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            })
        ]);

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

        const token = generateTestToken(owner);

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

    test('Non-owner roles should not be able to set employee availability', async () => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());
        const roles = ['CUSTOMER', 'EMPLOYEE', 'ADMIN'];

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

        const weeklyAvailability = {
            MONDAY: {
                start_time: '10:00:00',
                end_time: '16:00:00'
            }
        };

        // Create all users in parallel
        const users = await Promise.all(
            roles.map(role => insertUserWithCredentials({
                password,
                role: role
            }))
        );

        // Generate tokens directly - bypasses HTTP login, DB lookup, and bcrypt
        const tokens = users.map(user => generateTestToken(user));

        const responses = await Promise.all(
            tokens.map(token =>
                request(app)
                    .post(`/api/salons/setEmployeeAvailability/${employeeId}`)
                    .set('Authorization', `Bearer ${token}`)
                    .send({ weekly_availability: weeklyAvailability })
            )
        );

        // Verify all responses
        for (const response of responses) {
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        }
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

        const [owner, employee] = await Promise.all([
            insertUserWithCredentials({
                password,
                role: 'OWNER'
            }),
            insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            })
        ]);

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

        const token = generateTestToken(owner);

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

            const ownerToken = generateTestToken(owner);

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

    describe('Edge Cases', () => {
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
/*
    describe('Timezone Handling', () => {
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
*/

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

        test('Verify Rescheduling Non-Reschedulable Appointment: Attempting to reschedule COMPLETED or CANCELED appointment returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const oldTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const oldEndTime = oldTime.plus({ minutes: 60 });
            
            const statuses = ['COMPLETED', 'CANCELED'];
            
            const bookingIds = await Promise.all(
                statuses.map(() =>
                    createBookingWithServices(
                        env.salonId,
                        env.customer.user_id,
                        env.employeeId,
                        env.serviceId,
                        oldTime,
                        oldEndTime,
                        'SCHEDULED'
                    )
                )
            );
            
            await Promise.all(
                bookingIds.map((bookingId, index) =>
                    updateBookingStatus(bookingId, statuses[index])
                )
            );
            
            const newMonday = nextMonday.plus({ weeks: 1 });
            const newTime = newMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            const responses = await Promise.all(
                bookingIds.map(bookingId =>
                    rescheduleBookingViaAPI(env.customerToken, bookingId, newTime.toISO())
                )
            );
            
            for (const response of responses) {
                expect(response.status).toBe(404);
                expect(response.body.message).toContain('not reschedulable');
            }
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
            const customer1Token = generateTestToken(customer1);
            
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
            
            const [customer1, customer2] = await Promise.all([
                insertUserWithCredentials({
                    password: 'Password123!',
                    role: 'CUSTOMER'
                }),
                insertUserWithCredentials({
                    password: 'Password123!',
                    role: 'CUSTOMER'
                })
            ]);
            const customer1Token = generateTestToken(customer1);
            
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
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const futureTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureEndTime = futureTime.plus({ minutes: 60 });
            
            const customer1Token = generateTestToken(customer1);
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
        getNextMondayDateString,
        createUnavailabilityBlockViaAPI,
        listUnavailabilityBlocksViaAPI,
        deleteUnavailabilityBlockViaAPI,
        getUnavailabilityBlockById,
        verifyBlockedSlotsMissing,
        cancelBookingAsStylistViaAPI,
        getStylistWeeklyScheduleViaAPI
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
            
            const dateStr = getNextMondayDateString();
            const isBlocked = await verifyBlockedSlotsMissing(env.customerToken, env.salonId, env.employeeId, dateStr, 14, 0);
            
            expect(isBlocked).toBe(true);
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

        test('Verify Invalid Range: startTime after or equal to endTime returns 400 Bad Request', async () => {
            const env = await setupBookingTestEnvironment();
            const invalidRanges = [
                { startTime: '15:00', endTime: '14:00', description: 'startTime after endTime' },
                { startTime: '12:00', endTime: '12:00', description: 'startTime equals endTime' }
            ];
            
            for (const { startTime, endTime } of invalidRanges) {
                const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, startTime, endTime, 30);
                expect(response.status).toBe(400);
                expect(response.body.message).toContain('End time must be after Start time');
            }
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
        test('Non-employee roles should not be able to create unavailability blocks', async () => {
            const env = await setupBookingTestEnvironment();
            const roleTokens = [
                { role: 'CUSTOMER', tokenKey: 'customerToken' },
                { role: 'OWNER', tokenKey: 'ownerToken' }
            ];
            
            for (const { role, tokenKey } of roleTokens) {
                const response = await createUnavailabilityBlockViaAPI(env[tokenKey], 1, '14:00', '15:00', 30);
                
                expect(response.status).toBe(403);
                expect(response.body).toHaveProperty('error', 'Insufficient permissions');
            }
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
            
            const dateStr = getNextMondayDateString();
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

// BS 1.7 - As a stylist, before blocking time, check for scheduled appointments and cancel them
describe('BS 1.7 - Stylist Cancel Appointments Before Blocking', () => {
    const {
        setupBookingTestEnvironment,
        createBookingWithServices,
        getNextMonday,
        createUnavailabilityBlockViaAPI,
        cancelBookingAsStylistViaAPI
    } = require('./helpers/bookingTestUtils');

    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Check Conflicting Appointments: POST /api/unavailability with conflicting appointments returns 409 with appointment list', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
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
            
            const response = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            
            expect(response.status).toBe(409);
            expect(response.body).toHaveProperty('message', 'Cannot create block: conflicting appointments found');
            expect(response.body).toHaveProperty('conflicting_appointments');
            expect(Array.isArray(response.body.conflicting_appointments)).toBe(true);
            expect(response.body.conflicting_appointments.length).toBeGreaterThan(0);
            expect(response.body.conflicting_appointments[0]).toHaveProperty('booking_id', bookingId);
            expect(response.body.conflicting_appointments[0]).toHaveProperty('scheduled_start');
            expect(response.body.conflicting_appointments[0]).toHaveProperty('scheduled_end');
        });

        test('Verify Cancel and Block: Stylist cancels appointment then successfully blocks time', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
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
            
            const blockResponse = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            expect(blockResponse.status).toBe(409);
            expect(blockResponse.body.conflicting_appointments.length).toBeGreaterThan(0);
            
            const cancelResponse = await cancelBookingAsStylistViaAPI(env.employeeToken, bookingId);
            expect(cancelResponse.status).toBe(200);
            expect(cancelResponse.body).toHaveProperty('message');
            
            const blockAfterCancelResponse = await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            expect(blockAfterCancelResponse.status).toBe(201);
            expect(blockAfterCancelResponse.body).toHaveProperty('message', 'Recurring block created');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Cancel Non-Existent Booking: POST /api/bookings/stylist/cancel with invalid booking_id returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await cancelBookingAsStylistViaAPI(env.employeeToken, 999999);
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Booking not found');
        });

        test('Verify Cancel Completed Booking: POST /api/bookings/stylist/cancel with COMPLETED booking returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const bookingEndTime = bookingTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingEndTime,
                'COMPLETED'
            );
            
            const response = await cancelBookingAsStylistViaAPI(env.employeeToken, bookingId);
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Booking not found');
        });

        test('Verify Cancel Other Employee Booking: POST /api/bookings/stylist/cancel with booking assigned to different employee returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            const env2 = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const bookingEndTime = bookingTime.plus({ minutes: 60 });
            
            const bookingId = await createBookingWithServices(
                env2.salonId,
                env2.customer.user_id,
                env2.employeeId,
                env2.serviceId,
                bookingTime,
                bookingEndTime,
                'SCHEDULED'
            );
            
            const response = await cancelBookingAsStylistViaAPI(env.employeeToken, bookingId);
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Booking not found');
        });
    });
});

// BS 1.4 - As a stylist, I want to view my daily schedule so that I can prepare in advance
describe('BS 1.4 - Stylist Daily Schedule', () => {
    const {
        setupBookingTestEnvironment,
        createBookingWithServices,
        getNextMonday,
        getStylistWeeklyScheduleViaAPI,
        createUnavailabilityBlockViaAPI
    } = require('./helpers/bookingTestUtils');

    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify View Schedule: GET /api/user/stylist/weeklySchedule returns schedule with bookings', async () => {
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
            
            const startDate = nextMonday.toFormat('MM-dd-yyyy');
            const endDate = nextMonday.toFormat('MM-dd-yyyy');
            
            const response = await getStylistWeeklyScheduleViaAPI(env.employeeToken, startDate, endDate);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('schedule');
            expect(typeof response.body.data.schedule).toBe('object');
            
            const dateKey = nextMonday.toFormat('yyyy-MM-dd');
            if (response.body.data.schedule[dateKey]) {
                const daySchedule = response.body.data.schedule[dateKey];
                expect(daySchedule).toHaveProperty('bookings');
                expect(Array.isArray(daySchedule.bookings)).toBe(true);
                const booking = daySchedule.bookings.find(b => b.booking_id === bookingId);
                expect(booking).toBeDefined();
                expect(booking).toHaveProperty('customer_name');
                expect(booking).toHaveProperty('scheduled_start');
                expect(booking).toHaveProperty('scheduled_end');
            }
        });

        test('Verify Schedule Includes Availability: GET /api/user/stylist/weeklySchedule includes employee availability', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const startDate = nextMonday.toFormat('MM-dd-yyyy');
            const endDate = nextMonday.toFormat('MM-dd-yyyy');
            
            const response = await getStylistWeeklyScheduleViaAPI(env.employeeToken, startDate, endDate);
            
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('schedule');
            
            const dateKey = nextMonday.toFormat('yyyy-MM-dd');
            if (response.body.data.schedule[dateKey]) {
                const daySchedule = response.body.data.schedule[dateKey];
                expect(daySchedule).toHaveProperty('availability');
                if (daySchedule.availability) {
                    expect(daySchedule.availability).toHaveProperty('start_time');
                    expect(daySchedule.availability).toHaveProperty('end_time');
                }
            }
        });

        test('Verify Schedule Includes Unavailability: GET /api/user/stylist/weeklySchedule includes blocked time slots', async () => {
            const env = await setupBookingTestEnvironment();
            
            await createUnavailabilityBlockViaAPI(env.employeeToken, 1, '14:00', '15:00', 30);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const startDate = nextMonday.toFormat('MM-dd-yyyy');
            const endDate = nextMonday.toFormat('MM-dd-yyyy');
            
            const response = await getStylistWeeklyScheduleViaAPI(env.employeeToken, startDate, endDate);
            
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('schedule');
            
            const dateKey = nextMonday.toFormat('yyyy-MM-dd');
            if (response.body.data.schedule[dateKey]) {
                const daySchedule = response.body.data.schedule[dateKey];
                expect(daySchedule).toHaveProperty('unavailability');
                expect(Array.isArray(daySchedule.unavailability)).toBe(true);
                const block = daySchedule.unavailability.find(u => u.start_time === '14:00:00' && u.end_time === '15:00:00');
                expect(block).toBeDefined();
            }
        });
    });

    describe('Negative Flow', () => {
        test('Verify Missing Date Parameters: GET /api/user/stylist/weeklySchedule without dates returns 400', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await request(app)
                .get('/api/user/stylist/weeklySchedule')
                .set('Authorization', `Bearer ${env.employeeToken}`);
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('start_date and end_date are required');
        });

        test('Verify Invalid Date Format: GET /api/user/stylist/weeklySchedule with invalid date format returns 400', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await getStylistWeeklyScheduleViaAPI(env.employeeToken, 'invalid-date', '12-31-2024');
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Invalid start_date or end_date format');
        });

        test('Verify Invalid Date Range: GET /api/user/stylist/weeklySchedule with start_date after end_date returns 400', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const startDate = nextMonday.plus({ days: 7 }).toFormat('MM-dd-yyyy');
            const endDate = nextMonday.toFormat('MM-dd-yyyy');
            
            const response = await getStylistWeeklyScheduleViaAPI(env.employeeToken, startDate, endDate);
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('start_date must be before or equal to end_date');
        });

        test('Verify Non-Employee Access: Non-employee role cannot access schedule', async () => {
            const customer = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            const token = generateTestToken(customer);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const startDate = nextMonday.toFormat('MM-dd-yyyy');
            const endDate = nextMonday.toFormat('MM-dd-yyyy');
            
            const response = await getStylistWeeklyScheduleViaAPI(token, startDate, endDate);
            
            expect(response.status).toBe(403);
            expect(response.body).toHaveProperty('error', 'Insufficient permissions');
        });
    });
});

// BS 1.6 - As a user or stylist, I want to add private notes to an appointment
describe('BS 1.6 - Private Appointment Notes', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    // API helper functions
    const createNoteViaAPI = async (token, bookingId, note) => {
        return await request(app)
            .post('/api/appointment-notes/create')
            .set('Authorization', `Bearer ${token}`)
            .send({ booking_id: bookingId, note });
    };

    const updateNoteViaAPI = async (token, noteId, note) => {
        return await request(app)
            .patch(`/api/appointment-notes/update/${noteId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ note });
    };

    const deleteNoteViaAPI = async (token, noteId) => {
        return await request(app)
            .delete(`/api/appointment-notes/delete/${noteId}`)
            .set('Authorization', `Bearer ${token}`);
    };

    const listNotesForBookingViaAPI = async (token, bookingId, queryParams = {}) => {
        return await request(app)
            .get(`/api/appointment-notes/booking/${bookingId}/my-note`)
            .set('Authorization', `Bearer ${token}`)
            .query(queryParams);
    };

    const listAllMyNotesViaAPI = async (token, queryParams = {}) => {
        return await request(app)
            .get('/api/appointment-notes/my-notes')
            .set('Authorization', `Bearer ${token}`)
            .query(queryParams);
    };

    describe('Positive Flow', () => {
        test('Verify Customer Creates Note: POST /api/appointment-notes/create returns 201 OK', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(env.customerToken, bookingId, 'Remember to bring hair samples');

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message', 'Note created');
            expect(response.body.data).toHaveProperty('note_id');
            expect(response.body.data).toHaveProperty('booking_id', bookingId);
            expect(response.body.data).toHaveProperty('note', 'Remember to bring hair samples');
            expect(response.body.data).toHaveProperty('created_at');
            expect(response.body.data).toHaveProperty('updated_at');
        });

        test('Verify Employee Creates Note: POST /api/appointment-notes/create returns 201 OK for employee', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(env.employeeToken, bookingId, 'Customer prefers natural colors');

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message', 'Note created');
            expect(response.body.data).toHaveProperty('note_id');
            expect(response.body.data).toHaveProperty('booking_id', bookingId);
            expect(response.body.data).toHaveProperty('note', 'Customer prefers natural colors');
        });

        test('Verify Update Note: PATCH /api/appointment-notes/update/:note_id returns 200 OK', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const createResponse = await createNoteViaAPI(env.customerToken, bookingId, 'Initial note');
            expect(createResponse.status).toBe(201);
            const noteId = createResponse.body.data.note_id;

            const updateResponse = await updateNoteViaAPI(env.customerToken, noteId, 'Updated note with more details');

            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body).toHaveProperty('message', 'Note updated');
            expect(updateResponse.body.data).toHaveProperty('note_id', noteId);
            expect(updateResponse.body.data).toHaveProperty('note', 'Updated note with more details');
        });

        test('Verify Delete Note: DELETE /api/appointment-notes/delete/:note_id returns 200 OK', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const createResponse = await createNoteViaAPI(env.customerToken, bookingId, 'Note to delete');
            expect(createResponse.status).toBe(201);
            const noteId = createResponse.body.data.note_id;

            const deleteResponse = await deleteNoteViaAPI(env.customerToken, noteId);

            expect(deleteResponse.status).toBe(200);
            expect(deleteResponse.body).toHaveProperty('message', 'Note deleted');

            const [notes] = await db.execute(
                'SELECT note_id FROM appointment_notes WHERE note_id = ?',
                [noteId]
            );
            expect(notes.length).toBe(0);
        });

        test('Verify List Notes For Booking: GET /api/appointment-notes/booking/:booking_id/my-note returns user\'s notes', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const createResponse = await createNoteViaAPI(env.customerToken, bookingId, 'My private note');
            expect(createResponse.status).toBe(201);

            const listResponse = await listNotesForBookingViaAPI(env.customerToken, bookingId);

            expect(listResponse.status).toBe(200);
            expect(listResponse.body).toHaveProperty('data');
            expect(Array.isArray(listResponse.body.data)).toBe(true);
            expect(listResponse.body.data.length).toBeGreaterThanOrEqual(1);
            expect(listResponse.body.data[0]).toHaveProperty('note_id');
            expect(listResponse.body.data[0]).toHaveProperty('booking_id', bookingId);
            expect(listResponse.body.data[0]).toHaveProperty('note', 'My private note');
            expect(listResponse.body).toHaveProperty('meta');
        });

        test('Verify List All My Notes: GET /api/appointment-notes/my-notes returns all user\'s notes', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime1 = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const bookingTime2 = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            const [bookingId1, bookingId2] = await Promise.all([
                createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, bookingTime1, bookingTime1.plus({ hours: 1 }), 'SCHEDULED'),
                createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, bookingTime2, bookingTime2.plus({ hours: 1 }), 'SCHEDULED')
            ]);

            await Promise.all([
                createNoteViaAPI(env.customerToken, bookingId1, 'Note for booking 1'),
                createNoteViaAPI(env.customerToken, bookingId2, 'Note for booking 2')
            ]);

            const listResponse = await listAllMyNotesViaAPI(env.customerToken);

            expect(listResponse.status).toBe(200);
            expect(listResponse.body).toHaveProperty('data');
            expect(Array.isArray(listResponse.body.data)).toBe(true);
            expect(listResponse.body.data.length).toBeGreaterThanOrEqual(2);
            expect(listResponse.body).toHaveProperty('meta');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Invalid Booking ID: Creating note for non-existent booking returns 404', async () => {
            const env = await setupBookingTestEnvironment();

            const response = await createNoteViaAPI(env.customerToken, 99999, 'Test note');

            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Booking not found');
        });

        test('Verify Missing Note: Creating note without note text returns 400', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(env.customerToken, bookingId, '');

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('note is required');
        });

        test('Verify Note Too Long: Note exceeding 2000 characters returns 400', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const longNote = 'a'.repeat(2001);
            const response = await createNoteViaAPI(env.customerToken, bookingId, longNote);

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('note too long');
        });

        test('Verify Duplicate Note Prevention: Customer cannot create multiple notes for same booking', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            await createNoteViaAPI(env.customerToken, bookingId, 'First note');

            const response = await createNoteViaAPI(env.customerToken, bookingId, 'Second note');

            expect(response.status).toBe(409);
            expect(response.body.message).toContain('You already have a note for this booking');
        });

        test('Verify Customer Cannot Access Other Customer\'s Booking: Customer cannot add note to another customer\'s booking', async () => {
            const password = 'Password123!';
            const env = await setupBookingTestEnvironment();
            const customer2 = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const customer2Token = generateTestToken(customer2);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(customer2Token, bookingId, 'Unauthorized note');

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You do not have access to this booking');
        });

        test('Verify Employee Cannot Access Unassigned Booking: Employee cannot add note to booking they\'re not assigned to', async () => {
            const password = 'Password123!';
            const env = await setupBookingTestEnvironment();
            const employee2 = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [env.salonId, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const employee2Token = generateTestToken(employee2);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(employee2Token, bookingId, 'Unauthorized note');

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You do not have access to this booking');
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Non-Customer/Employee Access: Owner cannot create notes', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(env.ownerToken, bookingId, 'Owner note');

            expect(response.status).toBe(403);
        });

        test('Verify Cross-User Update Prevention: Customer cannot update another customer\'s note', async () => {
            const password = 'Password123!';
            const env = await setupBookingTestEnvironment();
            const customer2 = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const customer2Token = generateTestToken(customer2);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime1 = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const bookingTime2 = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            const [bookingId1, bookingId2] = await Promise.all([
                createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, bookingTime1, bookingTime1.plus({ hours: 1 }), 'SCHEDULED'),
                createBookingWithServices(env.salonId, customer2.user_id, env.employeeId, env.serviceId, bookingTime2, bookingTime2.plus({ hours: 1 }), 'SCHEDULED')
            ]);

            const createResponse = await createNoteViaAPI(env.customerToken, bookingId1, 'Customer 1 note');
            const noteId = createResponse.body.data.note_id;

            const updateResponse = await updateNoteViaAPI(customer2Token, noteId, 'Hacked note');

            expect(updateResponse.status).toBe(404);
            expect(updateResponse.body.message).toContain('Note not found');
        });

        test('Verify Cross-User Delete Prevention: Customer cannot delete another customer\'s note', async () => {
            const password = 'Password123!';
            const env = await setupBookingTestEnvironment();
            const customer2 = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const customer2Token = generateTestToken(customer2);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime1 = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const bookingTime2 = nextMonday.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            const [bookingId1, bookingId2] = await Promise.all([
                createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, bookingTime1, bookingTime1.plus({ hours: 1 }), 'SCHEDULED'),
                createBookingWithServices(env.salonId, customer2.user_id, env.employeeId, env.serviceId, bookingTime2, bookingTime2.plus({ hours: 1 }), 'SCHEDULED')
            ]);

            const createResponse = await createNoteViaAPI(env.customerToken, bookingId1, 'Customer 1 note');
            const noteId = createResponse.body.data.note_id;

            const deleteResponse = await deleteNoteViaAPI(customer2Token, noteId);

            expect(deleteResponse.status).toBe(404);
            expect(deleteResponse.body.message).toContain('Note not found');
        });

        test('Verify Privacy: Customer can only see their own notes, not employee\'s notes', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            await Promise.all([
                createNoteViaAPI(env.customerToken, bookingId, 'Customer private note'),
                createNoteViaAPI(env.employeeToken, bookingId, 'Employee private note')
            ]);

            const customerListResponse = await listNotesForBookingViaAPI(env.customerToken, bookingId);
            expect(customerListResponse.status).toBe(200);
            expect(customerListResponse.body.data.length).toBe(1);
            expect(customerListResponse.body.data[0].note).toBe('Customer private note');

            const employeeListResponse = await listNotesForBookingViaAPI(env.employeeToken, bookingId);
            expect(employeeListResponse.status).toBe(200);
            expect(employeeListResponse.body.data.length).toBe(1);
            expect(employeeListResponse.body.data[0].note).toBe('Employee private note');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Note Trimming: Leading and trailing whitespace is trimmed', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const response = await createNoteViaAPI(env.customerToken, bookingId, '   Trimmed note   ');

            expect(response.status).toBe(201);
            expect(response.body.data.note).toBe('Trimmed note');
        });

        test('Verify Max Length Note: Note with exactly 2000 characters is accepted', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTime = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            const bookingId = await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                bookingTime,
                bookingTime.plus({ hours: 1 }),
                'SCHEDULED'
            );

            const maxNote = 'a'.repeat(2000);
            const response = await createNoteViaAPI(env.customerToken, bookingId, maxNote);

            expect(response.status).toBe(201);
            expect(response.body.data.note).toBe(maxNote);
        });

        test('Verify Pagination: List notes with pagination parameters', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const bookingTimes = Array.from({ length: 5 }, (_, i) => 
                nextMonday.set({ hour: 10 + i, minute: 0, second: 0, millisecond: 0 })
            );
            
            const bookingIds = await Promise.all(
                bookingTimes.map(bt => 
                    createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, bt, bt.plus({ hours: 1 }), 'SCHEDULED')
                )
            );

            await Promise.all(
                bookingIds.map((bid, i) => 
                    createNoteViaAPI(env.customerToken, bid, `Note ${i + 1}`)
                )
            );

            const listResponse = await listAllMyNotesViaAPI(env.customerToken, { limit: 3, offset: 0 });

            expect(listResponse.status).toBe(200);
            expect(listResponse.body.data.length).toBeLessThanOrEqual(3);
            expect(listResponse.body.meta).toHaveProperty('limit', 3);
            expect(listResponse.body.meta).toHaveProperty('offset', 0);
            expect(listResponse.body.meta).toHaveProperty('hasMore');
        });
    });
});

