const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials, generateTestToken, generateFakeToken } = require('./helpers/authTestUtils');
const { baseSalonPayload, setupOwnerWithoutSalon } = require('./helpers/salonTestUtils');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../src/utils/utilies');

const db = connection.promise();

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
            options.status || 'PENDING',
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const loginUser = async (email, password) => {
    const [rows] = await db.execute('SELECT user_id, role, email FROM users WHERE email = ?', [email]);
    
    if (rows.length === 0) {
        throw new Error(`User not found for test login: ${email}`);
    }
    
    const user = rows[0];
    return generateTestToken(user);
};

const insertEmployee = async (salonId, userId, title = 'Senior Stylist') => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    await db.execute(
        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, userId, title, 1, nowUtc, nowUtc]
    );
};

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

        test('fails when required fields are missing', async () => {
            const requiredFields = ['full_name', 'email', 'role', 'password'];

            const responses = await Promise.all(
                requiredFields.map(missingField => {
                    const payload = baseSignupPayload();
                    delete payload[missingField];
                    return request(app)
                        .post('/api/user/signup')
                        .send(payload);
                })
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body).toMatchObject({
                    message: 'All fields are required'
                });
            }
        });

        test('rejects invalid password length and duplicate user', async () => {
            const user = await insertUserWithCredentials();

            const [shortPasswordResponse, duplicateResponse] = await Promise.all([
                request(app)
                    .post('/api/user/signup')
                    .send({ full_name: 'Test User', email: 'test@example.com', role: 'CUSTOMER', password: 'Short' }),
                request(app)
                    .post('/api/user/signup')
                    .send({ full_name: user.full_name, email: user.email, role: user.role, password: user.password })
            ]);

            expect(shortPasswordResponse.status).toBe(400);
            expect(shortPasswordResponse.body).toMatchObject({
                message: 'Password must be at least 6 characters long'
            });

            expect(duplicateResponse.status).toBe(409);
            expect(duplicateResponse.body).toMatchObject({
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

        test('rejects invalid credentials and invalid email format', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password });

            const [wrongPasswordResponse, invalidEmailResponse] = await Promise.all([
                request(app)
                    .post('/api/user/login')
                    .send({ email: user.email, password: 'WrongPassword!' }),
                request(app)
                    .post('/api/user/login')
                    .send({ email: 'invalid-email', password: 'Password123!' })
            ]);

            expect(wrongPasswordResponse.status).toBe(401);
            expect(wrongPasswordResponse.body).toMatchObject({
                message: 'Invalid credentials'
            });

            expect(invalidEmailResponse.status).toBe(400);
            expect(invalidEmailResponse.body).toMatchObject({
                message: 'Invalid email format'
            });
        });


    });

    describe('POST /api/user/logout', () => {
        test('all roles should be able to logout when authenticated', async () => {
            const password = 'Password123!';

            const users = await Promise.all(
                ROLE_CASES.map(role => insertUserWithCredentials({ password, role }))
            );

            const loginResponses = await Promise.all(
                users.map(user => request(app)
                    .post('/api/user/login')
                    .send({ email: user.email, password }))
            );

            const tokens = loginResponses.map(res => res.body.data.token);

            const logoutResponses = await Promise.all(
                users.map((user, i) => request(app)
                    .post('/api/user/logout')
                    .set('Authorization', `Bearer ${tokens[i]}`)
                    .send())
            );

            for (let i = 0; i < logoutResponses.length; i++) {
                expect(logoutResponses[i].status).toBe(200);
                expect(logoutResponses[i].body).toMatchObject({
                    message: 'Logout successful',
                    data: {
                        user_id: users[i].user_id,
                        active: 0
                    }
                });
            }
        });

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

    describe('Edge Cases', () => {
        test('Verify Signup Errors: All signup error cases return correct status codes', async () => {
            const existing = await insertUserWithCredentials();
            
            const signupCases = [
                { scenario: 'missing full_name', payload: { email: 'test1@test.com', role: 'CUSTOMER', password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'missing email', payload: { full_name: 'Test', role: 'CUSTOMER', password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'missing role', payload: { full_name: 'Test', email: 'test2@test.com', password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'missing password', payload: { full_name: 'Test', email: 'test3@test.com', role: 'CUSTOMER' }, expectedStatus: 400 },
                { scenario: 'invalid email format', payload: { full_name: 'Test', email: 'invalid-email', role: 'CUSTOMER', password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'password too short', payload: { full_name: 'Test', email: 'test4@test.com', role: 'CUSTOMER', password: 'Short' }, expectedStatus: 400 },
                { scenario: 'invalid role', payload: { full_name: 'Test', email: 'test5@test.com', role: 'INVALID', password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'duplicate email', payload: { full_name: existing.full_name, email: existing.email, role: existing.role, password: 'Password123!' }, expectedStatus: 409 }
            ];

            const responses = await Promise.all(
                signupCases.map(({ payload }) =>
                    request(app)
                        .post('/api/user/signup')
                        .send(payload)
                )
            );

            for (let i = 0; i < responses.length; i++) {
                expect(responses[i].status).toBe(signupCases[i].expectedStatus);
            }
        });

        test('Verify Login Errors: All login error cases return correct status codes', async () => {
            const user = await insertUserWithCredentials({ password: 'Password123!' });
            
            const loginCases = [
                { scenario: 'missing email', payload: { password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'missing password', payload: { email: 'test@test.com' }, expectedStatus: 400 },
                { scenario: 'invalid email format', payload: { email: 'invalid-email', password: 'Password123!' }, expectedStatus: 400 },
                { scenario: 'non-existent user', payload: { email: 'nonexistent@test.com', password: 'Password123!' }, expectedStatus: 401 },
                { scenario: 'wrong password', payload: { email: user.email, password: 'WrongPassword!' }, expectedStatus: 401 }
            ];

            const responses = await Promise.all(
                loginCases.map(({ payload }) =>
                    request(app)
                        .post('/api/user/login')
                        .send(payload)
                )
            );

            for (let i = 0; i < responses.length; i++) {
                expect(responses[i].status).toBe(loginCases[i].expectedStatus);
                if (loginCases[i].expectedStatus === 401) {
                    expect(responses[i].body.message).toBe('Invalid credentials');
                }
            }
        });

        test('Verify Login Updates Last Login: POST /api/user/login updates last_login_at', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password });

            const [beforeLogin] = await db.execute('SELECT last_login_at FROM users WHERE user_id = ?', [user.user_id]);
            const beforeTime = beforeLogin[0].last_login_at;

            await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const [afterLogin] = await db.execute('SELECT last_login_at FROM users WHERE user_id = ?', [user.user_id]);
            const afterTime = afterLogin[0].last_login_at;

            expect(afterTime).not.toBe(beforeTime);
        });

        test('Verify Logout Errors: All logout error cases return correct status codes', async () => {
            const logoutCases = [
                { scenario: 'missing token', authHeader: '', expectedStatus: 401 },
                { scenario: 'invalid token', authHeader: 'Bearer invalid-token', expectedStatus: 403 }
            ];

            const responses = await Promise.all(
                logoutCases.map(({ authHeader }) =>
                    request(app)
                        .post('/api/user/logout')
                        .set('Authorization', authHeader)
                )
            );

            for (let i = 0; i < responses.length; i++) {
                expect(responses[i].status).toBe(logoutCases[i].expectedStatus);
            }
        });

        test('Verify Auth Test: GET /api/user/auth-test returns 200 for authenticated users', async () => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({ password });
            const token = await loginUser(user.email, password);

            const response = await request(app)
                .get('/api/user/auth-test')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toContain('Authorized');
        });

        
    });
});

// UAR 1.3 - As a salon owner, I want to register my salon so that I can list it on the platform.
describe('UAR 1.3 - Salon Registration - Owner', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('Positive Flow', () => {
        test('Successful Creation: POST request with valid payload returns 201 Created with salonId and correct database state', async () => {
            const { owner, token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload();

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                message: 'Salon registered (pending verification)'
            });
            expect(response.body.data).toBeDefined();
            expect(response.body.data.salon_id).toBeDefined();
            expect(typeof response.body.data.salon_id).toBe('number');

            const salonId = response.body.data.salon_id;

            const [salonRows] = await db.execute(
                'SELECT salon_id, owner_user_id, status, name FROM salons WHERE salon_id = ?',
                [salonId]
            );

            expect(salonRows).toHaveLength(1);
            expect(salonRows[0]).toMatchObject({
                owner_user_id: owner.user_id,
                status: 'PENDING',
                name: payload.name
            });
        });

        
    });

    describe('Negative Flow', () => {
        test('Missing/Invalid Required Fields and Empty Payload: POST request with missing, empty, or invalid fields returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const invalidCases = [
                { field: 'name', action: (p) => { delete p.name; return p; }, expectMessage: "Field 'name' is required" },
                { field: 'address', action: (p) => { delete p.address; return p; }, expectMessage: "Field 'address' is required" },
                { field: 'phone', action: (p) => { delete p.phone; return p; }, expectMessage: "Field 'phone' is required" },
                { field: 'name', action: (p) => { p.name = ''; return p; }, expectMessage: "Field 'name' is required" },
                { field: 'empty payload', action: () => ({}), expectMessage: undefined }
            ];

            const responses = await Promise.all(
                invalidCases.map(({ action }) => {
                    const payload = action(baseSalonPayload());
                    return request(app)
                        .post('/api/salons/create')
                        .set('Authorization', `Bearer ${token}`)
                        .send(payload);
                })
            );

            for (let i = 0; i < responses.length; i++) {
                expect(responses[i].status).toBe(400);
                if (invalidCases[i].expectMessage) {
                    expect(responses[i].body.message).toContain(invalidCases[i].expectMessage);
                } else {
                    expect(responses[i].body.message).toBeDefined();
                }
            }
        });
    });

    describe('Data Integrity', () => {
        test('Data Mapping: Address details are stored in correct database columns', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({
                address: '456 Oak Avenue',
                city: 'Springfield',
                state: 'IL',
                postal_code: '62701',
                country: 'USA'
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            const salonId = response.body.data.salon_id;

            const [salonRows] = await db.execute(
                'SELECT address, city, state, postal_code, country FROM salons WHERE salon_id = ?',
                [salonId]
            );

            expect(salonRows[0]).toMatchObject({
                address: '456 Oak Avenue',
                city: 'Springfield',
                state: 'IL',
                postal_code: '62701',
                country: 'USA'
            });
        });
    });

    describe('Security & Permissions', () => {
        test('Unauthenticated Access: POST request without Authorization header returns 401', async () => {
            const payload = baseSalonPayload();

            const response = await request(app)
                .post('/api/salons/create')
                .send(payload);

            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                error: 'Access token required'
            });

            const [salonRows] = await db.execute(
                'SELECT salon_id FROM salons WHERE name = ?',
                [payload.name]
            );
            expect(salonRows).toHaveLength(0);
        });

        test('Non-owner roles should not be able to create salons', async () => {
            const password = 'Password123!';
            const roles = ['CUSTOMER', 'EMPLOYEE', 'ADMIN'];
            const payload = baseSalonPayload();

            const users = await Promise.all(
                roles.map(role => insertUserWithCredentials({ password, role }))
            );

            const tokens = await Promise.all(
                users.map(user => generateTestToken(user))
            );

            const responses = await Promise.all(
                tokens.map(token => request(app)
                    .post('/api/salons/create')
                    .set('Authorization', `Bearer ${token}`)
                    .send(payload))
            );

            for (const response of responses) {
                expect(response.status).toBe(403);
                expect(response.body).toMatchObject({
                    error: 'Insufficient permissions'
                });
            }
        });
    });

    describe('Edge Cases', () => {

        //Realistically never happens, but just in case
        test('Duplicate Registration: Owner with existing salon cannot register another salon', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload();

            const firstResponse = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(firstResponse.status).toBe(201);

            const secondPayload = baseSalonPayload({ name: 'Second Salon' });
            const secondResponse = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(secondPayload);

            expect(secondResponse.status).toBe(409);
            expect(secondResponse.body).toMatchObject({
                message: 'You already have a salon registered.'
            });
        });

    });
});

// UAR 1.4 - As a salon owner, I want to select my salon type (e.g., hair, nails, eyelashes) during registration so that users can find me based on category.
describe('UAR 1.4 - Salon Type/Category Selection - Owner', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    describe('Positive Flow', () => {
        test('Verify Valid Category Selection: POST request with valid category returns 201 Created', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: 'HAIR SALON' });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                message: 'Salon registered (pending verification)'
            });
            expect(response.body.data).toBeDefined();
            expect(response.body.data.category).toBe('HAIR SALON');
        });

        test('Verify All Valid Categories: All allowed categories can be selected', async () => {
            const allowedCategories = [
                'NAIL SALON',
                'HAIR SALON',
                'EYELASH STUDIO',
                'SPA & WELLNESS',
                'BARBERSHOP',
                'FULL SERVICE BEAUTY'
            ];

            for (const category of allowedCategories) {
                const owner = await insertUserWithCredentials({
                    password: 'Password123!',
                    role: 'OWNER'
                });

                const ownerToken = generateTestToken(owner);
                const payload = baseSalonPayload({
                    name: `Test ${category}`,
                    category: category
                });

                const response = await request(app)
                    .post('/api/salons/create')
                    .set('Authorization', `Bearer ${ownerToken}`)
                    .send(payload);

                expect(response.status).toBe(201);
                expect(response.body.data.category).toBe(category);
            }
        });
    });

    describe('Negative Flow', () => {
        test('Verify Invalid Category: POST request with invalid category values returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const invalidCategories = [
                { 
                    description: 'non-existent category',
                    action: (p) => p.category = 'AUTO_REPAIR',
                    checkResponse: (response) => {
                        expect(response.body).toMatchObject({
                            message: "Invalid 'category'"
                        });
                        expect(response.body.allowed).toBeDefined();
                        expect(Array.isArray(response.body.allowed)).toBe(true);
                    }
                },
                { 
                    description: 'missing category field',
                    action: (p) => delete p.category,
                    checkResponse: (response) => {
                        expect(response.body.message).toMatch(/category|required/i);
                    }
                },
                { 
                    description: 'null category',
                    action: (p) => p.category = null,
                    checkResponse: (response) => {
                        expect(response.body.message).toBeDefined();
                    }
                },
                { 
                    description: 'empty string category',
                    action: (p) => p.category = '',
                    checkResponse: (response) => {
                        expect(response.body.message).toBeDefined();
                    }
                }
            ];

            // Check all invalid category scenarios with separate API calls
            for (const { description, action, checkResponse } of invalidCategories) {
                const payload = baseSalonPayload();
                action(payload);

                const response = await request(app)
                    .post('/api/salons/create')
                    .set('Authorization', `Bearer ${token}`)
                    .send(payload);

                expect(response.status).toBe(400);
                checkResponse(response);
            }
        });
    });

    describe('Data Integrity & Logic', () => {
        test('Verify Type Validation: Non-string category type returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: 12345 }); // number instead of string

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
        });

    });
});

// UAR 1.5 - As an admin, I want to verify salon registrations so that only legitimate businesses are listed.
describe('UAR 1.5 - Salon Registration Verification - Admin', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    const setupAdminAndPendingSalon = async () => {
        const password = 'Password123!';
        const admin = await insertUserWithCredentials({
            password,
            role: 'ADMIN'
        });

        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const salonId = await createSalon(owner.user_id, { status: 'PENDING' });

        const token = generateTestToken(admin);

        return { admin, owner, salonId, token, password };
    };

    describe('Positive Flow', () => {
        test('Successful Acceptance: Admin accepts a pending salon, status changes to APPROVED and removed from pending list', async () => {
            const { salonId, token } = await setupAdminAndPendingSalon();

            const [initialSalon] = await db.execute(
                'SELECT status FROM salons WHERE salon_id = ?',
                [salonId]
            );
            expect(initialSalon[0].status).toBe('PENDING');

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                message: `Salon ${salonId} has been approved.`
            });

            const [updatedSalon] = await db.execute(
                'SELECT status, approval_date FROM salons WHERE salon_id = ?',
                [salonId]
            );
            expect(updatedSalon[0].status).toBe('APPROVED');
            expect(updatedSalon[0].approval_date).not.toBeNull();

            const browseResponse = await request(app)
                .get('/api/salons/browse?status=PENDING')
                .set('Authorization', `Bearer ${token}`);

            expect(browseResponse.status).toBe(200);
            const pendingSalons = browseResponse.body.data.filter(s => s.salon_id === salonId);
            expect(pendingSalons).toHaveLength(0);
        });
/*doesn't work properly, need to test notifications separately
        test('Notification on Acceptance: System triggers notification to salon owner when salon is approved', async () => {
            const { salonId, token, owner } = await setupAdminAndPendingSalon();

            const createNotificationSpy = jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
                success: true
            });

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect(response.status).toBe(200);

            expect(createNotificationSpy).toHaveBeenCalled();
            const notificationCall = createNotificationSpy.mock.calls.find(call => {
                const notificationData = call[1];
                return notificationData.salon_id === salonId && 
                       notificationData.user_id === owner.user_id &&
                       notificationData.type_code === 'SALON_APPROVED';
            });
            expect(notificationCall).toBeDefined();
        });
*/
        test('Verify Public Listing: Approved salon becomes visible for customers', async () => {
            const password = 'Password123!';
            const { salonId, token } = await setupAdminAndPendingSalon();

            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerToken = generateTestToken(customer);

            const browseBeforeResponse = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(browseBeforeResponse.status).toBe(200);
            const salonBeforeApproval = browseBeforeResponse.body.data.find(s => s.salon_id === salonId);
            expect(salonBeforeApproval).toBeUndefined();

            const approveResponse = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect(approveResponse.status).toBe(200);

            const browseAfterResponse = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(browseAfterResponse.status).toBe(200);
            const salonAfterApproval = browseAfterResponse.body.data.find(s => s.salon_id === salonId);
            expect(salonAfterApproval).toBeDefined();
            expect(salonAfterApproval.status).toBe('APPROVED');
        });
    });

    describe('Negative Flow', () => {
        test('Successful Rejection: Admin rejects a pending salon, status changes to REJECTED and does not appear in public search', async () => {
            const { salonId, token } = await setupAdminAndPendingSalon();

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'REJECTED' });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                message: `Salon ${salonId} has been rejected.`
            });

            const [updatedSalon] = await db.execute(
                'SELECT status FROM salons WHERE salon_id = ?',
                [salonId]
            );
            expect(updatedSalon[0].status).toBe('REJECTED');

            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerToken = generateTestToken(customer);

            const browseResponse = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(browseResponse.status).toBe(200);
            const rejectedSalon = browseResponse.body.data.find(s => s.salon_id === salonId);
            expect(rejectedSalon).toBeUndefined();
        });
    });

    

    describe('Security & Permissions', () => {
        test('Non-admin roles should not be able to access verification endpoint', async () => {
            const password = 'Password123!';
            const roles = ['OWNER', 'CUSTOMER', 'EMPLOYEE'];
            const { salonId } = await setupAdminAndPendingSalon();

            const users = await Promise.all(
                roles.map(role => insertUserWithCredentials({ password, role }))
            );

            const tokens = await Promise.all(
                users.map(user => generateTestToken(user))
            );

            const responses = await Promise.all(
                tokens.map(token => request(app)
                    .patch('/api/salons/approve')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ salon_id: salonId, status: 'APPROVED' }))
            );

            for (const response of responses) {
                expect(response.status).toBe(403);
                expect(response.body).toMatchObject({
                    error: 'Insufficient permissions'
                });
            }
        });

       
    });

    describe('Edge Cases', () => {
        

        

        test.each([
            {
                salon_id: 'invalid',
                status: 'APPROVED',
                expectedStatus: 400,
                expectedMessage: 'Invalid salon_id',
                description: 'invalid salon_id'
            },
            {
                salon_id: 999999,
                status: 'APPROVED',
                expectedStatus: 404,
                expectedMessage: 'Salon not found',
                description: 'non-existent salon_id'
            },
            {
                salon_id: null,
                status: 'INVALID_STATUS',
                expectedStatus: 400,
                expectedMessage: 'Invalid status.',
                description: 'invalid status value',
                useSalonId: true
            }
        ])('Invalid Input: System returns $expectedStatus error for $description', async ({ salon_id, status, expectedStatus, expectedMessage, useSalonId }) => {
            const { salonId, token } = await setupAdminAndPendingSalon();
            const finalSalonId = useSalonId ? salonId : salon_id;

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: finalSalonId, status });

            expect(response.status).toBe(expectedStatus);
            expect(response.body).toMatchObject({
                message: expectedMessage
            });
        });
    });
});

// UAR 1.6 - As a user, I want to browse available salons so that I can choose where to book.
describe('UAR 1.6 - Browse Available Salons', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });


    describe('Positive Flow', () => {
        test('Verify List Retrieval: GET request returns 200 OK with array of salon objects', async () => {
            const password = 'Password123!';
            const [customer, owner] = await Promise.all([
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'OWNER' })
            ]);

            await createSalon(owner.user_id, { 
                name: 'Test Salon',
                status: 'APPROVED'
            });

            const customerToken = generateTestToken(customer);

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
            if (response.body.data.length > 0) {
                expect(response.body.data[0]).toHaveProperty('salon_id');
                expect(response.body.data[0]).toHaveProperty('name');
            }
        });

        test('Verify Pagination Logic: GET request with limit and offset returns correct pagination', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owners = await Promise.all(
                Array.from({ length: 7 }, () => insertUserWithCredentials({ password, role: 'OWNER' }))
            );

            await Promise.all(
                owners.map((owner, i) => createSalon(owner.user_id, { 
                    name: `Test Salon ${i}`,
                    status: 'APPROVED'
                }))
            );

            const customerToken = generateTestToken(customer);

            const response = await request(app)
                .get('/api/salons/browse?limit=5&offset=0')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeLessThanOrEqual(5);
            expect(response.body.meta).toHaveProperty('total');
            expect(response.body.meta).toHaveProperty('limit', 5);
            expect(response.body.meta).toHaveProperty('offset', 0);
            expect(response.body.meta).toHaveProperty('hasMore');
            expect(typeof response.body.meta.total).toBe('number');
        });
    });

    describe('Negative Flow', () => {
        // offset is negative, should return 400
        test.each([
            {
                query: '?offset=-1',
                expectedStatus: 400,
                description: 'negative offset'
            },
            {
                query: '?limit=0',
                expectedStatus: 200,
                description: 'limit=0'
            },
            {
                query: '?limit=abc',
                expectedStatus: 400,
                expectedMessage: 'Limit must be a non-negative number',
                description: 'non-numeric limit'
            }
        ])('Verify Invalid Pagination Parameters: GET request with $description returns $expectedStatus', async ({ query, expectedStatus, expectedMessage }) => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerToken = generateTestToken(customer);

            const response = await request(app)
                .get(`/api/salons/browse${query}`)
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(expectedStatus);
            if (expectedMessage) {
                expect(response.body.message).toBe(expectedMessage);
            }
        });
    });

    describe('Data Integrity & Logic', () => {
        test('Verify Status Filtering: Customer browse returns only APPROVED salons, excludes PENDING and REJECTED', async () => {
            const password = 'Password123!';
            const [customer, owner1, owner2, owner3] = await Promise.all([
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'OWNER' })
            ]);

            const [approvedSalonId, pendingSalonId, rejectedSalonId] = await Promise.all([
                createSalon(owner1.user_id, { name: 'Approved Salon', status: 'APPROVED' }),
                createSalon(owner2.user_id, { name: 'Pending Salon', status: 'PENDING' }),
                createSalon(owner3.user_id, { name: 'Rejected Salon', status: 'REJECTED' })
            ]);

            const customerToken = generateTestToken(customer);

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            const approvedSalon = response.body.data.find(s => s.salon_id === approvedSalonId);
            const pendingSalon = response.body.data.find(s => s.salon_id === pendingSalonId);
            const rejectedSalon = response.body.data.find(s => s.salon_id === rejectedSalonId);

            expect(approvedSalon).toBeDefined();
            expect(approvedSalon.status).toBe('APPROVED');
            expect(pendingSalon).toBeUndefined();
            expect(rejectedSalon).toBeUndefined();
        });
    });

    describe('Security & Permissions', () => {
    });

    describe('Edge Cases', () => {
    });
});

// UAR 1.7 - As an owner, I want to add/remove/view employees so that I can manage my salon staff.
describe('UAR 1.7 - Add/Remove/View Employees - Owner', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });

    const setupOwnerWithSalon = async () => {
        const password = 'Password123!';
        const owner = await insertUserWithCredentials({
            password,
            role: 'OWNER'
        });

        const salonId = await createSalon(owner.user_id, { status: 'APPROVED' });

        const token = generateTestToken(owner);

        return { owner, salonId, token, password };
    };

    describe('Positive Flow', () => {
        test('Add Employee - POST /addEmployee with valid email and title returns 200 OK and employee is added to database', async () => {
            const { salonId, token } = await setupOwnerWithSalon();
            const password = 'Password123!';

            const employee = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            const response = await request(app)
                .post('/api/salons/addEmployee')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: employee.email, title: 'Senior Stylist' });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                message: `Employee ${employee.email} has been added to salon.`
            });

            const [employeeRows] = await db.execute(
                `SELECT e.employee_id, e.user_id, e.title, e.active, u.email
                 FROM employees e
                 JOIN users u ON e.user_id = u.user_id
                 WHERE e.salon_id = ? AND u.email = ?`,
                [salonId, employee.email]
            );
            expect(employeeRows).toHaveLength(1);
            expect(employeeRows[0]).toMatchObject({
                user_id: employee.user_id,
                title: 'Senior Stylist',
                active: 1
            });
        });

        test('View Employees - POST /viewEmployees returns 200 OK with array containing employee details', async () => {
            const { salonId, token } = await setupOwnerWithSalon();
            const password = 'Password123!';

            const [employee1, employee2] = await Promise.all([
                insertUserWithCredentials({ password, role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password, role: 'EMPLOYEE' })
            ]);

            await Promise.all([
                insertEmployee(salonId, employee1.user_id, 'Senior Stylist'),
                insertEmployee(salonId, employee2.user_id, 'Junior Stylist')
            ]);

            const response = await request(app)
                .post('/api/salons/viewEmployees')
                .set('Authorization', `Bearer ${token}`)
                .send({ limit: 10, offset: 0 });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);
            expect(response.body).toHaveProperty('pagination');
            expect(response.body.pagination).toHaveProperty('total_employees');
            expect(response.body.pagination.total_employees).toBeGreaterThanOrEqual(2);

            const employeeEmails = response.body.data.map(e => e.email);
            expect(employeeEmails).toContain(employee1.email);
            expect(employeeEmails).toContain(employee2.email);
        });

        test('Remove Employee - DELETE /removeEmployee with valid email returns 200 OK and employee is removed from database', async () => {
            const { salonId, token } = await setupOwnerWithSalon();
            const password = 'Password123!';
            const nowUtc = toMySQLUtc(DateTime.utc());

            const employee = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            await insertEmployee(salonId, employee.user_id);

            const response = await request(app)
                .delete('/api/salons/removeEmployee')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: employee.email });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                message: `Employee ${employee.email} has been removed from salon.`
            });

            const [employeeRows] = await db.execute(
                `SELECT e.employee_id
                 FROM employees e
                 JOIN users u ON e.user_id = u.user_id
                 WHERE e.salon_id = ? AND u.email = ?`,
                [salonId, employee.email]
            );
            expect(employeeRows).toHaveLength(0);

            const viewResponse = await request(app)
                .post('/api/salons/viewEmployees')
                .set('Authorization', `Bearer ${token}`)
                .send({ limit: 10, offset: 0 });

            const employeeEmails = viewResponse.body.data.map(e => e.email);
            expect(employeeEmails).not.toContain(employee.email);
        });
    });

    describe('Negative Flow', () => {
        test('Verify Validation Errors: POST /addEmployee and DELETE /removeEmployee with missing fields or invalid data returns appropriate errors', async () => {
            const { token } = await setupOwnerWithSalon();

            const [missingEmailResponse, invalidEmailResponse, nonExistentResponse, missingEmailDeleteResponse, invalidEmailDeleteResponse] = await Promise.all([
                request(app)
                    .post('/api/salons/addEmployee')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ title: 'Stylist' }),
                request(app)
                    .post('/api/salons/addEmployee')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ email: 'invalid-email', title: 'Stylist' }),
                request(app)
                    .post('/api/salons/addEmployee')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ email: 'ghost@example.com', title: 'Stylist' }),
                request(app)
                    .delete('/api/salons/removeEmployee')
                    .set('Authorization', `Bearer ${token}`)
                    .send({}),
                request(app)
                    .delete('/api/salons/removeEmployee')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ email: 'invalid-email' })
            ]);

            expect(missingEmailResponse.status).toBe(400);
            expect(missingEmailResponse.body.message).toContain('Missing required fields');

            expect(invalidEmailResponse.status).toBe(400);
            expect(invalidEmailResponse.body.message).toContain('Invalid email format');

            expect(nonExistentResponse.status).toBe(409);
            expect(nonExistentResponse.body.message).toContain('Employee does not exist');

            expect(missingEmailDeleteResponse.status).toBe(400);
            expect(missingEmailDeleteResponse.body.message).toContain('Missing required fields');

            expect(invalidEmailDeleteResponse.status).toBe(400);
            expect(invalidEmailDeleteResponse.body.message).toContain('Invalid email format');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Pagination: POST /viewEmployees with limit and offset returns correct pagination metadata', async () => {
            const { salonId, token } = await setupOwnerWithSalon();
            const password = 'Password123!';

            const employees = await Promise.all(
                Array.from({ length: 5 }, () => insertUserWithCredentials({ password, role: 'EMPLOYEE' }))
            );

            await Promise.all(
                employees.map((employee, i) => insertEmployee(salonId, employee.user_id, `Stylist ${i}`))
            );

            const response = await request(app)
                .post('/api/salons/viewEmployees')
                .set('Authorization', `Bearer ${token}`)
                .send({ limit: 3, offset: 0 });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('pagination');
            expect(response.body.pagination).toHaveProperty('current_page');
            expect(response.body.pagination).toHaveProperty('total_pages');
            expect(response.body.pagination).toHaveProperty('total_employees');
            expect(response.body.pagination).toHaveProperty('limit', 3);
            expect(response.body.pagination).toHaveProperty('offset', 0);
            expect(response.body.pagination).toHaveProperty('has_next_page');
            expect(response.body.pagination).toHaveProperty('has_prev_page');
            expect(response.body.data.length).toBeLessThanOrEqual(3);
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Unauthorized Access: Non-OWNER roles cannot access employee management endpoints', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const customerToken = generateTestToken(customer);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });

            const addResponse = await request(app)
                .post('/api/salons/addEmployee')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({ email: employee.email, title: 'Stylist' });

            expect(addResponse.status).toBe(403);
            expect(addResponse.body.error).toBe('Insufficient permissions');

            const viewResponse = await request(app)
                .post('/api/salons/viewEmployees')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({ limit: 10, offset: 0 });

            expect(viewResponse.status).toBe(403);
            expect(viewResponse.body.error).toBe('Insufficient permissions');

            const removeResponse = await request(app)
                .delete('/api/salons/removeEmployee')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({ email: employee.email });

            expect(removeResponse.status).toBe(403);
            expect(removeResponse.body.error).toBe('Insufficient permissions');
        });
    });

});

// UAR 1.8 - Get Stylist's Assigned Salon
describe('UAR 1.8 - Get Stylist\'s Assigned Salon', () => {
    beforeEach(() => {
        jest.spyOn(notificationsController, 'createNotification').mockResolvedValue({
            success: true
        });
    });


    describe('Positive Flow', () => {
        test('Verify Successful Retrieval: GET /stylist/getSalon with valid token returns 200 OK with salon details', async () => {
            const password = 'Password123!';
            const nowUtc = toMySQLUtc(DateTime.utc());

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const stylist = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            const salonId = await createSalon(owner.user_id, {
                name: 'Salon A',
                address: '123 Main Street',
                phone: '555-1234',
                status: 'APPROVED'
            });

            await insertEmployee(salonId, stylist.user_id);

            const token = generateTestToken(stylist);

            const response = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toMatchObject({
                salon_id: salonId,
                name: 'Salon A',
                address: '123 Main Street',
                phone: '555-1234'
            });
            expect(response.body.data).toHaveProperty('description');
            expect(response.body.data).toHaveProperty('category');
            expect(response.body.data).toHaveProperty('employee_title');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Unassigned Stylist: EMPLOYEE user not hired by any salon returns 404 Not Found', async () => {
            const password = 'Password123!';
            const stylist = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            const token = generateTestToken(stylist);

            const response = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
            expect(response.body).toMatchObject({
                message: 'No salon assigned to this stylist'
            });
        });

        test('Verify Unauthenticated Access: GET request without Bearer token returns 401 Unauthorized', async () => {
            const response = await request(app)
                .get('/api/user/stylist/getSalon');

            expect(response.status).toBe(401);
            expect(response.body).toMatchObject({
                error: 'Access token required'
            });
        });

       
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Data Privacy: Response includes operational info but excludes owner-only sensitive data', async () => {
            const password = 'Password123!';
            const nowUtc = toMySQLUtc(DateTime.utc());

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const stylist = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            const salonId = await createSalon(owner.user_id, {
                name: 'Test Salon',
                address: '123 Main St',
                phone: '555-1234',
                status: 'APPROVED'
            });

            await insertEmployee(salonId, stylist.user_id);

            const token = generateTestToken(stylist);

            const response = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('salon_id');
            expect(response.body.data).toHaveProperty('name');
            expect(response.body.data).toHaveProperty('address');
            expect(response.body.data).toHaveProperty('phone');
            expect(response.body.data).toHaveProperty('email');
            expect(response.body.data).toHaveProperty('description');
            expect(response.body.data).toHaveProperty('category');
            expect(response.body.data).toHaveProperty('employee_title');
            expect(response.body.data).toHaveProperty('owner_name');
            expect(response.body.data).not.toHaveProperty('owner_user_id');
            expect(response.body.data).not.toHaveProperty('totalRevenue');
            expect(response.body.data).not.toHaveProperty('subscriptionTier');
            expect(response.body.data).not.toHaveProperty('adminNotes');
        });
    });

    describe('Security & Permissions', () => {
        test('Non-employee roles should not be able to access getSalon endpoint', async () => {
            const password = 'Password123!';
            const roles = ['OWNER', 'CUSTOMER', 'ADMIN'];

            for (const role of roles) {
                const user = await insertUserWithCredentials({
                    password,
                    role
                });

                const token = generateTestToken(user);

                const response = await request(app)
                    .get('/api/user/stylist/getSalon')
                    .set('Authorization', `Bearer ${token}`);

                expect(response.status).toBe(403);
                expect(response.body).toMatchObject({
                    error: 'Insufficient permissions'
                });
            }
        });

       
    });

    describe('Edge Cases', () => {
        test('Verify Single Assignment Constraint: Database prevents stylist from being assigned to multiple salons simultaneously', async () => {
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

            const salonAId = await createSalon(owner1.user_id, { name: 'Salon A', status: 'APPROVED' });
            const salonBId = await createSalon(owner2.user_id, { name: 'Salon B', status: 'APPROVED' });

            await insertEmployee(salonAId, stylist.user_id);

            await expect(
                insertEmployee(salonBId, stylist.user_id, 'Junior Stylist')
            ).rejects.toThrow();

            const token = generateTestToken(stylist);

            const response = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data).not.toBeInstanceOf(Array);
            expect(response.body.data).toHaveProperty('salon_id');
            expect(response.body.data.salon_id).toBe(salonAId);
            expect(response.body.data.salon_id).not.toBe(salonBId);
        });

        test('Verify Recently Removed: Owner removes stylist, stylist with old token returns 404', async () => {
            const password = 'Password123!';
            const nowUtc = toMySQLUtc(DateTime.utc());

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const stylist = await insertUserWithCredentials({
                password,
                role: 'EMPLOYEE'
            });

            const salonId = await createSalon(owner.user_id, { status: 'APPROVED' });

            await insertEmployee(salonId, stylist.user_id);

            const token = generateTestToken(stylist);

            const firstResponse = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(firstResponse.status).toBe(200);

            await db.execute(
                `DELETE FROM employees WHERE salon_id = ? AND user_id = ?`,
                [salonId, stylist.user_id]
            );

            const secondResponse = await request(app)
                .get('/api/user/stylist/getSalon')
                .set('Authorization', `Bearer ${token}`);

            expect(secondResponse.status).toBe(404);
            expect(secondResponse.body).toMatchObject({
                message: 'No salon assigned to this stylist'
            });
        });
    });
});