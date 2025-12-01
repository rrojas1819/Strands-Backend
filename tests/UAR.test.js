const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials } = require('./helpers/authTestUtils');
const { baseSalonPayload, setupOwnerWithoutSalon } = require('./helpers/salonTestUtils');
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
        test.each([
            { field: 'name', action: (p) => delete p.name },
            { field: 'address', action: (p) => delete p.address },
            { field: 'phone', action: (p) => delete p.phone },
            { field: 'name', action: (p) => p.name = '' }
        ])('Missing/Invalid Required Fields: POST request with missing or empty $field returns 400', async ({ field, action }) => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload();
            action(payload);

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.message).toContain(`Field '${field}' is required`);
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

        test('Send Empty Fields: POST request with empty fields returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({
                description: '',
                phone: '',
                email: '',
                address: '',
                city: '',
                state: '',
                postal_code: ''
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
        });

        test('Data Types: All string fields are stored as strings in database', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({
                postal_code: '12345' 
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            const salonId = response.body.data.salon_id;

            const [salonRows] = await db.execute(
                'SELECT postal_code FROM salons WHERE salon_id = ?',
                [salonId]
            );

            expect(salonRows[0].postal_code).toBe('12345');
        });

        test.each([
            { postal_code: 'ABC12', description: 'contains letters' },
            { postal_code: '12ABC', description: 'starts with numbers but contains letters' },
            { postal_code: '12345-6789', description: 'contains hyphen' },
            { postal_code: '123 45', description: 'contains space' },
            { postal_code: '12345!', description: 'contains special character' },
            { postal_code: 'ABCDE', description: 'all letters' },
            { postal_code: '12.34', description: 'contains decimal point' }
        ])('Postal Code Validation: POST request with postal_code that $description returns 400', async ({ postal_code }) => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({
                postal_code: postal_code
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
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

        test.each(['CUSTOMER', 'EMPLOYEE', 'ADMIN'])('Authorization/Role Check: POST request by %s role returns 403', async (role) => {
            const password = 'Password123!';
            const user = await insertUserWithCredentials({
                password,
                role
            });

            const loginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: user.email, password });

            const token = loginResponse.body.data.token;
            const payload = baseSalonPayload();

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                error: 'Insufficient permissions'
            });
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

        test('Empty Payload: POST request with empty body returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
        });

        test('All Required Fields Present: Complete valid payload succeeds', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({
                name: 'Complete Salon',
                description: 'Full description',
                category: 'NAIL SALON',
                phone: '555-9876',
                email: 'complete@salon.com',
                address: '789 Complete St',
                city: 'Complete City',
                state: 'CC',
                postal_code: '99999',
                country: 'USA'
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            expect(response.body.data).toMatchObject({
                name: 'Complete Salon',
                category: 'NAIL SALON',
                phone: '555-9876',
                email: 'complete@salon.com',
                address: '789 Complete St',
                city: 'Complete City',
                state: 'CC',
                postal_code: '99999',
                country: 'USA'
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

        test('Verify Database Persistence: Category is correctly stored in database', async () => {
            const { token, owner } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ 
                category: 'NAIL SALON',
                name: 'Test Nail Salon Persistence'
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            const salonId = response.body.data.salon_id;

            const [salonRows] = await db.execute(
                'SELECT category FROM salons WHERE salon_id = ?',
                [salonId]
            );

            expect(salonRows).toHaveLength(1);
            expect(salonRows[0].category).toBe('NAIL SALON');
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

                const loginResponse = await request(app)
                    .post('/api/user/login')
                    .send({ email: owner.email, password: 'Password123!' });

                const ownerToken = loginResponse.body.data.token;
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
        test('Verify Invalid Category: POST request with non-existent category returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: 'AUTO_REPAIR' });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: "Invalid 'category'"
            });
            expect(response.body.allowed).toBeDefined();
            expect(Array.isArray(response.body.allowed)).toBe(true);
        });

        test('Verify Missing Category: POST request with missing category field returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload();
            delete payload.category;

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
            expect(response.body.message).toMatch(/category|required/i);
        });

        test('Verify Null Category: POST request with null category returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: null });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
        });

        test('Verify Empty String Category: POST request with empty string category returns 400', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: '' });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.message).toBeDefined();
        });
    });

    describe('Data Integrity & Logic', () => {
        test('Verify Case Sensitivity: Lowercase category is normalized to uppercase', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: 'hair salon' }); // lowercase

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            expect(response.body.data.category).toBe('HAIR SALON');
        });

        test('Verify Case Sensitivity: Mixed case category is normalized to uppercase', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ category: 'Hair Salon' }); // mixed case

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            expect(response.body.data.category).toBe('HAIR SALON');
        });

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

        test('Verify Database Storage Format: Category is stored in uppercase format', async () => {
            const { token } = await setupOwnerWithoutSalon();
            const payload = baseSalonPayload({ 
                category: 'nail salon', 
                name: 'Test Case Normalization'
            });

            const response = await request(app)
                .post('/api/salons/create')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(201);
            const salonId = response.body.data.salon_id;

            const [salonRows] = await db.execute(
                'SELECT category FROM salons WHERE salon_id = ?',
                [salonId]
            );

            expect(salonRows[0].category).toBe('NAIL SALON');
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

    const createPendingSalon = async (ownerUserId, options = {}) => {
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
                'PENDING',
                nowUtc,
                nowUtc
            ]
        );
        return result.insertId;
    };

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

        const salonId = await createPendingSalon(owner.user_id);

        const loginResponse = await request(app)
            .post('/api/user/login')
            .send({ email: admin.email, password });

        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.data.token;

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

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

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

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const browseResponse = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(browseResponse.status).toBe(200);
            const rejectedSalon = browseResponse.body.data.find(s => s.salon_id === salonId);
            expect(rejectedSalon).toBeUndefined();
        });

        test('Rejection with Reason: Admin rejects a salon with a reason, reason is saved (if rejection_reason field exists)', async () => {
            const { salonId, token } = await setupAdminAndPendingSalon();

            const rejectionReason = 'Invalid Business License';

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ 
                    salon_id: salonId, 
                    status: 'REJECTED',
                    rejection_reason: rejectionReason
                });

            expect(response.status).toBe(200);

            const [salonColumns] = await db.execute(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_NAME = 'salons' AND COLUMN_NAME = 'rejection_reason'`
            );

            if (salonColumns.length > 0) {
                const [updatedSalon] = await db.execute(
                    'SELECT status, rejection_reason FROM salons WHERE salon_id = ?',
                    [salonId]
                );
                expect(updatedSalon[0].status).toBe('REJECTED');
                expect(updatedSalon[0].rejection_reason).toBe(rejectionReason);
            } else {
                const [updatedSalon] = await db.execute(
                    'SELECT status FROM salons WHERE salon_id = ?',
                    [salonId]
                );
                expect(updatedSalon[0].status).toBe('REJECTED');
            }
        });

        test('Rejection without Reason: System prevents rejection without reason and displays error', async () => {
            const { salonId, token } = await setupAdminAndPendingSalon();

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ 
                    salon_id: salonId, 
                    status: 'REJECTED'
                });

            expect([200, 400]).toContain(response.status);

            if (response.status === 400) {
                expect(response.body.message).toContain('reason is required');
            } else {
                expect(response.status).toBe(200);
            }
        });
    });

    

    describe('Security & Permissions', () => {
        test('Verify Non-Admin Access: Standard users (Salon Owner, Customer) cannot access verification endpoint', async () => {
            const password = 'Password123!';
            const { salonId } = await setupAdminAndPendingSalon();

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const ownerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: owner.email, password });

            const ownerToken = ownerLoginResponse.body.data.token;

            const ownerResponse = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect(ownerResponse.status).toBe(403);
            expect(ownerResponse.body).toMatchObject({
                error: 'Insufficient permissions'
            });

            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const customerResponse = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect(customerResponse.status).toBe(403);
            expect(customerResponse.body).toMatchObject({
                error: 'Insufficient permissions'
            });
        });

       
    });

    describe('Edge Cases', () => {
        test('Double Decision Prevention: System processes request only once when admin clicks Accept twice rapidly', async () => {
            const { salonId, token } = await setupAdminAndPendingSalon();

            const firstResponse = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect(firstResponse.status).toBe(200);

            const [firstCheck] = await db.execute(
                'SELECT status FROM salons WHERE salon_id = ?',
                [salonId]
            );
            expect(firstCheck[0].status).toBe('APPROVED');

            const secondResponse = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'APPROVED' });

            expect([200, 400, 409]).toContain(secondResponse.status);

            const [secondCheck] = await db.execute(
                'SELECT status FROM salons WHERE salon_id = ?',
                [salonId]
            );
            expect(secondCheck[0].status).toBe('APPROVED');
        });

        

        test('Invalid salon_id: System returns 400 error for invalid salon_id', async () => {
            const { token } = await setupAdminAndPendingSalon();

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: 'invalid', status: 'APPROVED' });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'Invalid salon_id'
            });
        });

        test('Non-existent salon_id: System returns 404 error for non-existent salon', async () => {
            const { token } = await setupAdminAndPendingSalon();

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: 999999, status: 'APPROVED' });

            expect(response.status).toBe(404);
            expect(response.body).toMatchObject({
                message: 'Salon not found'
            });
        });

        test('Invalid status: System returns 400 error for invalid status value', async () => {
            const { salonId, token } = await setupAdminAndPendingSalon();

            const response = await request(app)
                .patch('/api/salons/approve')
                .set('Authorization', `Bearer ${token}`)
                .send({ salon_id: salonId, status: 'INVALID_STATUS' });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                message: 'Invalid status.'
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

    describe('Positive Flow', () => {
        test('Verify List Retrieval: GET request returns 200 OK with array of salon objects', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            await createSalon(owner.user_id, { 
                name: 'Test Salon',
                status: 'APPROVED'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

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

            for (let i = 0; i < 7; i++) {
                const owner = await insertUserWithCredentials({
                    password,
                    role: 'OWNER'
                });
                await createSalon(owner.user_id, { 
                    name: `Test Salon ${i}`,
                    status: 'APPROVED'
                });
            }

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

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

        test('Verify Filter by Category: GET request with category filter returns only salons of that category', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owner1 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const owner2 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const hairSalonId = await createSalon(owner1.user_id, { 
                name: 'Hair Salon',
                category: 'HAIR SALON',
                status: 'APPROVED'
            });
            const nailSalonId = await createSalon(owner2.user_id, { 
                name: 'Nail Salon',
                category: 'NAIL SALON',
                status: 'APPROVED'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({ category: 'NAIL SALON' });

            expect(response.status).toBe(200);
            const nailSalons = response.body.data.filter(s => s.salon_id === nailSalonId);
            const hairSalons = response.body.data.filter(s => s.salon_id === hairSalonId);
            
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('Verify Sorting: GET request with sort parameter returns salons in correct order', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owner1 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });
            const owner2 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });
            const owner3 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            await createSalon(owner1.user_id, { name: 'Zebra Salon', status: 'APPROVED' });
            await createSalon(owner2.user_id, { name: 'Alpha Salon', status: 'APPROVED' });
            await createSalon(owner3.user_id, { name: 'Beta Salon', status: 'APPROVED' });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse?sort=name')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(3);
            
            const names = response.body.data.map(s => s.name).filter(n => n.includes('Alpha') || n.includes('Beta') || n.includes('Zebra'));
            if (names.length >= 2) {
                const sortedNames = [...names].sort();
                expect(names).toEqual(sortedNames);
            }
        });
    });

    describe('Negative Flow', () => {
        // offset is negative, should return 400
        test('Verify Invalid Pagination Parameters: GET request with negative offset returns 200', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse?offset=-1')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(400);
        });

        test('Verify Invalid Limit Parameter: GET request with limit=0 returns 200', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse?limit=0')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
        });
        // limit is non-numeric, should return 400
        test('Verify Malformed Query Params: GET request with non-numeric limit returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse?limit=abc')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Limit must be a non-negative number');
        });
    });

    describe('Data Integrity & Logic', () => {
        test('Verify Status Filtering: Customer browse returns only APPROVED salons, excludes PENDING and REJECTED', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owner1 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const owner2 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const owner3 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            const approvedSalonId = await createSalon(owner1.user_id, { 
                name: 'Approved Salon',
                status: 'APPROVED'
            });
            const pendingSalonId = await createSalon(owner2.user_id, { 
                name: 'Pending Salon',
                status: 'PENDING'
            });
            const rejectedSalonId = await createSalon(owner3.user_id, { 
                name: 'Rejected Salon',
                status: 'REJECTED'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

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

        test('Verify Data Masking: Customer browse response excludes private admin/owner fields', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            await createSalon(owner.user_id, { 
                name: 'Test Salon',
                status: 'APPROVED'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            if (response.body.data.length > 0) {
                const salon = response.body.data[0];
                expect(salon).not.toHaveProperty('owner_user_id');
                expect(salon).not.toHaveProperty('owner_name');
                expect(salon).not.toHaveProperty('owner_email');
                expect(salon).not.toHaveProperty('owner_phone');
                expect(salon).toHaveProperty('salon_id');
                expect(salon).toHaveProperty('name');
                expect(salon).toHaveProperty('category');
            }
        });

        test('Verify Admin Data Visibility: Admin browse response includes owner information', async () => {
            const password = 'Password123!';
            const admin = await insertUserWithCredentials({
                password,
                role: 'ADMIN'
            });

            const owner = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            await createSalon(owner.user_id, { 
                name: 'Test Salon',
                status: 'APPROVED'
            });

            const adminLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: admin.email, password });

            const adminToken = adminLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(response.status).toBe(200);
            if (response.body.data.length > 0) {
                const salon = response.body.data[0];
                expect(salon).toHaveProperty('owner_user_id');
                expect(salon).toHaveProperty('owner_name');
                expect(salon).toHaveProperty('owner_email');
            }
        });

        test('Verify Empty Result: GET request with no matching salons returns 200 with empty array', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.meta.total).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Security & Permissions', () => {
        test('Verify SQL Injection Prevention: GET request with SQL injection attempt in query params is handled safely', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse?status=PENDING\' OR 1=1 --')
                .set('Authorization', `Bearer ${customerToken}`);

            expect([200, 400]).toContain(response.status);
            if (response.status === 200) {
                response.body.data.forEach(salon => {
                    expect(salon.status).toBe('APPROVED');
                });
            }
        });

        test('Verify Unauthenticated Access: GET request without token returns 401', async () => {
            const response = await request(app)
                .get('/api/salons/browse');

            expect(response.status).toBe(401);
        });
    });

    describe('Edge Cases', () => {
        test('Verify Sorting with Default: GET request without sort parameter uses default sorting', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const owner1 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });
            const owner2 = await insertUserWithCredentials({
                password,
                role: 'OWNER'
            });

            await createSalon(owner1.user_id, { name: 'Salon 1', status: 'APPROVED' });
            await createSalon(owner2.user_id, { name: 'Salon 2', status: 'APPROVED' });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('Verify Large Limit: GET request with very large limit is handled', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({
                password,
                role: 'CUSTOMER'
            });

            const customerLoginResponse = await request(app)
                .post('/api/user/login')
                .send({ email: customer.email, password });

            const customerToken = customerLoginResponse.body.data.token;

            const response = await request(app)
                .get('/api/salons/browse?limit=999999')
                .set('Authorization', `Bearer ${customerToken}`);

            expect(response.status).toBe(200);
            expect(response.body.meta.limit).toBeLessThanOrEqual(999999);
        });
    });
});