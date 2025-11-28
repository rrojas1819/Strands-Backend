const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials } = require('./helpers/authTestUtils');
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
});