const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials } = require('./helpers/authTestUtils');
const { setupServiceTestEnvironment, baseServicePayload } = require('./helpers/serviceTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');

const db = connection.promise();

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

        await db.execute(
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

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: owner.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

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
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const user = await insertUserWithCredentials({
            password,
            role: role
        });

        await db.execute(
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

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: user.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

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

    test('As an owner, I should be able to modify existing salon operating hours', async () => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
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
            `INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [salonId, 1, '09:00:00', '17:00:00', nowUtc, nowUtc]
        );

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: owner.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const weeklyHours = {
            MONDAY: {
                start_time: '10:00:00',
                end_time: '18:00:00'
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

        const mondayResult = response.body.data.results.find(r => r.weekday === 'MONDAY');
        expect(mondayResult).toBeDefined();
        expect(mondayResult.action).toBe('updated');
        expect(mondayResult.start_time).toBe('10:00:00');
        expect(mondayResult.end_time).toBe('18:00:00');
        expect(mondayResult.old_start_time).toBe('09:00:00');
        expect(mondayResult.old_end_time).toBe('17:00:00');

        const [updatedHours] = await db.execute(
            `SELECT start_time, end_time FROM salon_availability 
             WHERE salon_id = ? AND weekday = ?`,
            [salonId, 1]
        );
        expect(updatedHours).toHaveLength(1);
        expect(updatedHours[0].start_time).toBe('10:00:00');
        expect(updatedHours[0].end_time).toBe('18:00:00');
    });

    

    test('Verify Invalid Time Logic: POST /setHours with end_time before start_time returns 400 Bad Request', async () => {
        const password = 'Password123!';
        const nowUtc = toMySQLUtc(DateTime.utc());

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        await db.execute(
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

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: owner.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const weeklyHours = {
            MONDAY: {
                start_time: '17:00:00',
                end_time: '09:00:00'
            }
        };

        const response = await request(app)
            .post('/api/salons/setHours')
            .set('Authorization', `Bearer ${token}`)
            .send({ weekly_hours: weeklyHours });

        expect([400, 500]).toContain(response.status);
        if (response.status === 400) {
            expect(response.body.message).toBeDefined();
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

    test('As a stylist, I should be able to create a service and add it to my profile', async () => {
        const { stylist, salonId, employeeId, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = baseServicePayload();

        const response = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
            message: 'Service created and added to profile successfully'
        });
        expect(response.body.data).toBeDefined();
        expect(response.body.data.service).toMatchObject({
            salon_id: salonId,
            name: payload.name,
            description: payload.description,
            duration_minutes: payload.duration_minutes,
            price: payload.price,
            active: true
        });
        expect(response.body.data.employee).toMatchObject({
            employee_id: employeeId
        });

        const serviceId = response.body.data.service.service_id;

        const [serviceRows] = await db.execute(
            `SELECT salon_id, name, description, duration_minutes, price, active 
             FROM services WHERE service_id = ?`,
            [serviceId]
        );
        expect(serviceRows).toHaveLength(1);
        expect(serviceRows[0]).toMatchObject({
            salon_id: salonId,
            name: payload.name,
            description: payload.description,
            duration_minutes: payload.duration_minutes,
            active: 1
        });

        const [linkRows] = await db.execute(
            `SELECT employee_id, service_id FROM employee_services WHERE employee_id = ? AND service_id = ?`,
            [employeeId, serviceId]
        );
        expect(linkRows).toHaveLength(1);
        expect(linkRows[0]).toMatchObject({
            employee_id: employeeId,
            service_id: serviceId
        });
    });

    test('As a stylist, I should NOT be able to create a duplicate service', async () => {
        const { stylist, employeeId, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = baseServicePayload();

        const firstResponse = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        expect(firstResponse.status).toBe(201);

        const duplicatePayload = {
            ...payload,
            name: '  haircut & STYLE  '
        };

        const secondResponse = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(duplicatePayload);

        expect(secondResponse.status).toBe(409);
        expect(secondResponse.body).toMatchObject({
            message: 'You already have a service with this name in your profile'
        });
        expect(secondResponse.body.data).toBeDefined();
        expect(secondResponse.body.data.existing_service).toBe(payload.name);

        const [services] = await db.execute(
            `SELECT s.service_id, s.name 
             FROM employee_services es
             JOIN services s ON es.service_id = s.service_id
             WHERE es.employee_id = ?`,
            [employeeId]
        );
        const normalizedNames = services.map(row => row.name.toLowerCase().replace(/\s+/g, ' ').trim());
        const targetNormalized = payload.name.toLowerCase().replace(/\s+/g, ' ').trim();
        const occurrences = normalizedNames.filter(n => n === targetNormalized).length;
        expect(occurrences).toBe(1);
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

    test('Verify Update Service: PATCH /stylist/updateService/:service_id changing price returns 200 OK', async () => {
        const { stylist, employeeId, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
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
            .send({ price: 160.00 });

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body).toMatchObject({
            message: 'Service updated successfully'
        });
        expect(Number(updateResponse.body.data.service.price)).toBe(160.00);

        const [serviceRows] = await db.execute(
            'SELECT price FROM services WHERE service_id = ?',
            [serviceId]
        );
        expect(Number(serviceRows[0].price)).toBe(160.00);
    });

    test('Verify Delete Service: DELETE /stylist/removeService/:service_id returns 200 OK and service is removed', async () => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const createPayload = baseServicePayload();
        const createResponse = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(createPayload);

        expect(createResponse.status).toBe(201);
        const serviceId = createResponse.body.data.service.service_id;

        const deleteResponse = await request(app)
            .delete(`/api/salons/stylist/removeService/${serviceId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(deleteResponse.status).toBe(200);
        expect(deleteResponse.body).toMatchObject({
            message: 'Service removed from profile successfully'
        });

        const myServicesResponse = await request(app)
            .get('/api/salons/stylist/myServices')
            .set('Authorization', `Bearer ${token}`);

        expect(myServicesResponse.status).toBe(200);
        const serviceIds = myServicesResponse.body.data.services.map(s => s.service_id);
        expect(serviceIds).not.toContain(serviceId);
    });

    test('Verify Get My Services: GET /stylist/myServices returns only services created by logged-in stylist', async () => {
        const { stylist: stylist1, password: password1 } = await setupServiceTestEnvironment();
        const { stylist: stylist2, password: password2 } = await setupServiceTestEnvironment();

        const loginResponse1 = await request(app)
            .post('/api/user/login')
            .send({ email: stylist1.email, password: password1 });

        const token1 = loginResponse1.body.data.token;

        const loginResponse2 = await request(app)
            .post('/api/user/login')
            .send({ email: stylist2.email, password: password2 });

        const token2 = loginResponse2.body.data.token;

        const payload1 = baseServicePayload({ name: 'Stylist 1 Service' });
        const payload2 = baseServicePayload({ name: 'Stylist 2 Service' });

        const createResponse1 = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token1}`)
            .send(payload1);

        const createResponse2 = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token2}`)
            .send(payload2);

        expect(createResponse1.status).toBe(201);
        expect(createResponse2.status).toBe(201);

        const serviceId1 = createResponse1.body.data.service.service_id;
        const serviceId2 = createResponse2.body.data.service.service_id;

        const myServicesResponse = await request(app)
            .get('/api/salons/stylist/myServices')
            .set('Authorization', `Bearer ${token1}`);

        expect(myServicesResponse.status).toBe(200);
        expect(myServicesResponse.body.data).toHaveProperty('services');
        const serviceIds = myServicesResponse.body.data.services.map(s => s.service_id);
        expect(serviceIds).toContain(serviceId1);
        expect(serviceIds).not.toContain(serviceId2);
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

    test('Verify IDOR on Update: Stylist A cannot PATCH /stylist/updateService/:service_id for Stylist B\'s service', async () => {
        const { stylist: stylist1, password: password1 } = await setupServiceTestEnvironment();
        const { stylist: stylist2, password: password2 } = await setupServiceTestEnvironment();

        const loginResponse1 = await request(app)
            .post('/api/user/login')
            .send({ email: stylist1.email, password: password1 });

        const token1 = loginResponse1.body.data.token;

        const loginResponse2 = await request(app)
            .post('/api/user/login')
            .send({ email: stylist2.email, password: password2 });

        const token2 = loginResponse2.body.data.token;

        const payload2 = baseServicePayload({ name: 'Stylist 2 Service' });
        const createResponse2 = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token2}`)
            .send(payload2);

        expect(createResponse2.status).toBe(201);
        const serviceId2 = createResponse2.body.data.service.service_id;

        const updateResponse = await request(app)
            .patch(`/api/salons/stylist/updateService/${serviceId2}`)
            .set('Authorization', `Bearer ${token1}`)
            .send({ price: 200 });

        expect([403, 404]).toContain(updateResponse.status);
        if (updateResponse.status === 404) {
            expect(updateResponse.body.message).toContain('Service not found in your profile');
        }
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

    test('As an owner, I should not be able to set employee availability outside salon operating hours - hours', async () => {
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
                start_time: '08:00:00',
                end_time: '18:00:00',
                slot_interval_minutes: 30
            },
            SUNDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00',
                slot_interval_minutes: 30
            }
        };

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
        expect(response.body.errors[0]).toContain('Employee availability must be within salon operating hours');
    });
    test('As an owner, I should not be able to set employee availability outside salon operating hours - day of week', async () => {
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

            SUNDAY: {
                start_time: '09:00:00',
                end_time: '17:00:00',
                slot_interval_minutes: 30
            }
        };

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
        expect(response.body.errors[0]).toContain('SUNDAY: Salon is not open on this day');
    });

    test('As an owner, I should be able to modify existing employee availability operating hours', async () => {
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

        await db.execute(
            `INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [employeeId, 1, '10:00:00', '16:00:00', 30, nowUtc, nowUtc]
        );

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: owner.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const weeklyAvailability = {
            MONDAY: {
                start_time: '11:00:00',
                end_time: '17:00:00',
                slot_interval_minutes: 45
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

        const mondayResult = response.body.data.results.find(r => r.weekday === 'MONDAY');
        expect(mondayResult).toBeDefined();
        expect(mondayResult.action).toBe('updated');
        expect(mondayResult.start_time).toBe('11:00:00');
        expect(mondayResult.end_time).toBe('17:00:00');
        expect(mondayResult.old_start_time).toBe('10:00:00');
        expect(mondayResult.old_end_time).toBe('16:00:00');
        expect(mondayResult.slot_interval_minutes).toBe(45);

        const [updatedAvailability] = await db.execute(
            `SELECT start_time, end_time, slot_interval_minutes FROM employee_availability 
             WHERE employee_id = ? AND weekday = ?`,
            [employeeId, 1]
        );
        expect(updatedAvailability).toHaveLength(1);
        expect(updatedAvailability[0].start_time).toBe('11:00:00');
        expect(updatedAvailability[0].end_time).toBe('17:00:00');
        expect(updatedAvailability[0].slot_interval_minutes).toBe(45);
    });
});

// BS 1.1 - Customer Booking Flow
describe('BS 1.1 - Customer Booking Flow', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    const setupBookingTestEnvironment = async () => {
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

        const customer = await insertUserWithCredentials({
            password,
            role: 'CUSTOMER'
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
            `UPDATE salons SET timezone = 'UTC' WHERE salon_id = ?`,
            [salonId]
        );

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

        await db.execute(
            `INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [employeeId, 1, '09:00:00', '17:00:00', 30, nowUtc, nowUtc]
        );

        const servicePayload = {
            name: 'Haircut',
            description: 'Basic haircut',
            duration_minutes: 60,
            price: 50
        };

        const [serviceResult] = await db.execute(
            `INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [salonId, servicePayload.name, servicePayload.description, servicePayload.duration_minutes, servicePayload.price, 1, nowUtc, nowUtc]
        );
        const serviceId = serviceResult.insertId;

        await db.execute(
            `INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
            [employeeId, serviceId, nowUtc, nowUtc]
        );

        const customerLoginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: customer.email, password });

        const customerToken = customerLoginResponse.body.data.token;

        return {
            owner,
            employee,
            customer,
            salonId,
            employeeId,
            serviceId,
            customerToken,
            password,
            nowUtc
        };
    };

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

        test('Verify Successful Booking: POST /:salon_id/stylists/:employee_id/book with valid data returns 201 Created', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const now = DateTime.utc();
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
            const futureDate = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const scheduledStart = futureDate.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }],
                    notes: 'Test booking'
                });

            expect([200, 201]).toContain(response.status);
            expect(response.body).toHaveProperty('message');
            expect(response.body.data).toHaveProperty('booking_id');
            expect(response.body.data).toHaveProperty('appointment');
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
        test('Verify Duration Calculation: Booking service that exceeds remaining operating hours returns 400 Bad Request', async () => {
            const { salonId, employeeId, customerToken } = await setupBookingTestEnvironment();
            const nowUtc = toMySQLUtc(DateTime.utc());

            const longServicePayload = {
                name: 'Long Service',
                description: 'Service that takes 3 hours',
                duration_minutes: 180,
                price: 150
            };

            const [serviceResult] = await db.execute(
                `INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [salonId, longServicePayload.name, longServicePayload.description, longServicePayload.duration_minutes, longServicePayload.price, 1, nowUtc, nowUtc]
            );
            const longServiceId = serviceResult.insertId;

            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE salon_id = ? LIMIT 1`,
                [salonId]
            );
            const employeeIdFromDb = employeeResult[0].employee_id;

            await db.execute(
                `INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?)`,
                [employeeIdFromDb, longServiceId, nowUtc, nowUtc]
            );

            const futureDate = DateTime.utc().plus({ days: 7 }).set({ hour: 16, minute: 0, second: 0 });
            const scheduledStart = futureDate.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: longServiceId }]
                });

            expect([400, 409]).toContain(response.status);
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Booking as Owner: User with OWNER role trying to book via customer endpoint returns 403 Forbidden', async () => {
            const { salonId, employeeId, serviceId, password } = await setupBookingTestEnvironment();

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const ownerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: owner.email, password });

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
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
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
            expect(response.body.data).toHaveProperty('booking_id');
        });

        test.each([
            { hour: 17, minute: 0, description: 'starting at closing time (17:00:00)' },
            { hour: 16, minute: 1, description: 'that would end after closing (16:01:00 for 60min service)' }
        ])('Verify Booking Outside Hours: POST /book $description returns 400 Bad Request', async ({ hour, minute }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();

            const now = DateTime.utc();
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
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
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
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
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
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
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }

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
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
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
        test('Verify Booking with EST Timezone: POST /book with EST-formatted time and EST salon timezone returns 201 Created', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            // Set salon timezone to EST
            await db.execute(
                `UPDATE salons SET timezone = 'America/New_York' WHERE salon_id = ?`,
                [salonId]
            );

            const estTimezone = 'America/New_York';
            const now = DateTime.now().setZone(estTimezone);
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
            const bookingTimeEST = nextMonday.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const scheduledStart = bookingTimeEST.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect([200, 201]).toContain(response.status);
            expect(response.body.data).toHaveProperty('booking_id');
        });

        test.each([
            { hour: 9, minute: 0, description: 'at opening time (09:00 EST)' },
            { hour: 16, minute: 0, description: 'ending at closing time (16:00 EST for 60min service)' }
        ])('Verify EST Booking at Boundary Times: POST /book $description with EST salon timezone returns 201 Created', async ({ hour, minute }) => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            await db.execute(
                `UPDATE salons SET timezone = 'America/New_York' WHERE salon_id = ?`,
                [salonId]
            );

            const estTimezone = 'America/New_York';
            const now = DateTime.now().setZone(estTimezone);
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
            const bookingTimeEST = nextMonday.set({ hour, minute, second: 0, millisecond: 0 });
            const scheduledStart = bookingTimeEST.toISO();

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect([200, 201]).toContain(response.status);
        });

        test('Verify EST Booking That Would End After Closing: POST /book at 16:01 EST (60min) returns 400 Bad Request', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            await db.execute(
                `UPDATE salons SET timezone = 'America/New_York' WHERE salon_id = ?`,
                [salonId]
            );

            const estTimezone = 'America/New_York';
            const now = DateTime.now().setZone(estTimezone);
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
            const bookingTimeEST = nextMonday.set({ hour: 16, minute: 1, second: 0, millisecond: 0 });
            const scheduledStart = bookingTimeEST.toISO();

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

        test('Verify EST Browser Sending UTC Time: POST /book with UTC time but EST salon timezone works correctly', async () => {
            const { salonId, employeeId, serviceId, customerToken } = await setupBookingTestEnvironment();
            
            await db.execute(
                `UPDATE salons SET timezone = 'America/New_York' WHERE salon_id = ?`,
                [salonId]
            );

            const now = DateTime.utc();
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
            const bookingTimeUTC = nextMonday.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
            const scheduledStart = bookingTimeUTC.toISO(); // Will have 'Z' suffix

            const response = await request(app)
                .post(`/api/salons/${salonId}/stylists/${employeeId}/book`)
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    scheduled_start: scheduledStart,
                    services: [{ service_id: serviceId }]
                });

            expect([200, 201]).toContain(response.status);
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
            let nextMonday = now.plus({ days: 1 });
            while (nextMonday.weekday !== 1) {
                nextMonday = nextMonday.plus({ days: 1 });
            }
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