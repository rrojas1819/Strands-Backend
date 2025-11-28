const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials } = require('./helpers/authTestUtils');

const db = connection.promise();

// User Authentication & Roles unit tests


//UAR 1.1/ 1.2 - Login, Signup, Logout, authentication test
describe('Auth Routes', () => {
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
});

