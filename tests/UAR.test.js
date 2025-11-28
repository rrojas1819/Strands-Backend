const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials } = require('./helpers/authTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');

const db = connection.promise();

// User Authentication & Roles unit tests


//UAR 1.1/ 1.2 - Login, Signup, Logout, authentication test
describe('UAR 1.1/ 1.2 login, signup, logout, authentication test', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('POST /api/user/signup', () => {
        test.each(ROLE_CASES)(
            'creates a %s when payload is valid',
            async (role) => {
                const payload = baseSignupPayload({ role });

                const response = await request(app)
                    .post('/api/user/signup')
                    .send(payload);

                expect(response.status).toBe(201);
                expect(response.body).toMatchObject({
                    message: 'User signed up successfully'
                });

                const [users] = await db.execute(
                    'SELECT user_id, role FROM users WHERE email = ?',
                    [payload.email]
                );
                expect(users).toHaveLength(1);
                expect(users[0].role).toBe(role);
            }
        );

        test.each([
            'full_name',
            'email',
            'role',
            'password'
        ])('fails when %s is missing', async (missingField) => {
            const payload = baseSignupPayload();
            delete payload[missingField];

            const response = await request(app)
                .post('/api/user/signup')
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'All fields are required'
            });
        });

        test('rejects invalid password length', async () => {
            const response = await request(app)
                .post('/api/user/signup')
                .send({ full_name: 'Test User', email: 'test@example.com', role: 'CUSTOMER', password: 'Short' });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'Password must be at least 6 characters long'
            });
        });

        test('rejects user who already exists', async () => {
            const user = await insertUserWithCredentials();
            const response = await request(app)
                .post('/api/user/signup')
                .send({ full_name: user.full_name, email: user.email, role: user.role, password: user.password });

            expect(response.status).toBe(409);
            expect(response.body).toMatchObject({
                message: 'Invalid credentials or account cannot be created'
            });
        });
    });

    describe('POST /api/user/login', () => {
        test.each(ROLE_CASES)(
            'returns token for %s credentials',
            async (role) => {
                const password = 'Password123!';
                const user = await insertUserWithCredentials({ password, role });

                const response = await request(app)
                    .post('/api/user/login')
                    .send({ email: user.email, password });

                expect(response.status).toBe(200);
                expect(response.body).toMatchObject({
                    message: 'Login successful'
                });
                expect(response.body.data).toMatchObject({
                    user_id: user.user_id,
                    role: role
                });
                expect(response.body.data.token).toBeDefined();
            }
        );

        test('rejects invalid credentials', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password });

            const response = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password: 'WrongPassword!' });

            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                message: 'Invalid credentials'
            });
        });

        test('rejects invalid email format', async () => {
            const response = await request(app)
                .post('/api/user/login')
                .send({ email: 'invalid-email', password: 'Password123!' });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'Invalid email format'
            });
        });


    });

    describe('POST /api/user/logout', () => {
        test.each(ROLE_CASES)(
            'logs out an authenticated %s',
            async (role) => {
                const password = 'Password123!';
                const user = await insertUserWithCredentials({ password, role });

                const loginResponse = await request(app)
                    .post('/api/user/login')
                    .send({ email: user.email, password });

                const token = loginResponse.body.data.token;

                const response = await request(app)
                    .post('/api/user/logout')
                    .set('Authorization', `Bearer ${token}`)
                    .send();

                expect(response.status).toBe(200);
                expect(response.body).toMatchObject({
                    message: 'Logout successful',
                    data: {
                        user_id: user.user_id,
                        active: 0
                    }
                });
            }
        );

        test('fails when token is missing', async () => {
            const response = await request(app)
                .post('/api/user/logout')
                .send();

            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                error: 'Access token required'
            });
        });


    });

    // UAR 1.8 - Stylist should see only their assigned salon when they login
    describe('UAR 1.8 - Stylist salon visibility', () => {
        beforeEach(() => {
            jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
                success: true
            });
        });

        test('As a stylist when they login they should see the salon they work for and no other salon', async () => {
            const password = 'Password123!';
            const nowUtc = toMySQLUtc(DateTime.utc());

            const owner1 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const owner2 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const stylist = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            const [salon1Result] = await db.execute(
                `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
                 address, city, state, postal_code, country, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    owner1.user_id,
                    'Stylist Salon',
                    'Test salon for stylist',
                    'HAIR SALON',
                    '555-0100',
                    'stylist-salon@test.com',
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
            const salon1Id = salon1Result.insertId;

            const [salon2Result] = await db.execute(
                `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
                 address, city, state, postal_code, country, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    owner2.user_id,
                    'Other Salon',
                    'Another salon',
                    'HAIR SALON',
                    '555-0200',
                    'other-salon@test.com',
                    '456 Other St',
                    'Test City',
                    'TS',
                    '12345',
                    'USA',
                    'APPROVED',
                    nowUtc,
                    nowUtc
                ]
            );
            const salon2Id = salon2Result.insertId;

            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salon1Id, stylist.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
            );

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: stylist.email, password });

            expect(loginResponse.status).toBe(200);
            const token = loginResponse.body.data.token;

            const salonResponse = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(salonResponse.status).toBe(200);
            expect(salonResponse.body.data).toBeDefined();

            expect(salonResponse.body.data.salon_id).toBe(salon1Id);
            expect(salonResponse.body.data.name).toBe('Stylist Salon');

            expect(salonResponse.body.data.salon_id).not.toBe(salon2Id);
            expect(salonResponse.body.data.name).not.toBe('Other Salon');

            expect(salonResponse.body.data).toHaveProperty('salon_id');
            expect(salonResponse.body.data).toHaveProperty('name');
            expect(salonResponse.body.data).toHaveProperty('description');
            expect(salonResponse.body.data).toHaveProperty('category');
            expect(salonResponse.body.data).toHaveProperty('employee_title');
        });
        //Every other role should not be able to access this route
        test.each([...ROLE_CASES.filter(role => role !== 'EMPLOYEE')])('As a %s when they try to access this route they should be rejected', async (role) => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        });
        //Test for when the stylist is not assigned to any salon
        test('As a stylist when they are not assigned to any salon they should be rejected', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;

            const response = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
            expect(response.body).toMatchObject({
                message: 'No salon assigned to this stylist'
            });
        });

    });
});

