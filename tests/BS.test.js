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

    test('As a stylist, I should NOT be able to create a service with 0 price', async () => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = baseServicePayload({ price: 0 });

        const response = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            message: 'Missing required fields'
        });
    });

    test('As a stylist, I should NOT be able to create a service with 0 duration_minutes', async () => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = baseServicePayload({ duration_minutes: 0 });

        const response = await request(app)
            .post('/api/salons/stylist/createService')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            message: 'Missing required fields'
        });
    });

    test('As a stylist, I should NOT be able to create a service with both 0 price and 0 duration_minutes', async () => {
        const { stylist, password } = await setupServiceTestEnvironment();

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: stylist.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

        const payload = baseServicePayload({ price: 0, duration_minutes: 0 });

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