const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const { insertUserWithCredentials, generateTestToken } = require('./helpers/authTestUtils');


const loginUser = async (email, password) => {
    const loginResponse = await request(app)
        .post('/api/user/login')
        .send({ email, password });
    expect(loginResponse.status).toBe(200);
    return loginResponse.body.data.token;
};

describe('File Upload - Negative Tests', () => {
    describe('UPH 1.6 - Upload Before Photo', () => {
        test('Verify Missing Booking ID: POST /api/file/upload-before-photo without booking_id returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .post('/api/file/upload-before-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Booking ID is required');
        });

        test('Verify Missing File: POST /api/file/upload-before-photo without file returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .post('/api/file/upload-before-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 1 });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('No file uploaded');
        });

        

        test('Verify Unauthorized Access: POST /api/file/upload-before-photo without token returns 401', async () => {
            const response = await request(app)
                .post('/api/file/upload-before-photo')
                .send({ booking_id: 1 });

            expect(response.status).toBe(401);
        });

        test('Verify Wrong Role: POST /api/file/upload-before-photo as CUSTOMER returns 403', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .post('/api/file/upload-before-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 1 });

            expect(response.status).toBe(403);
        });
    });

    describe('UPH 1.6 - Upload After Photo', () => {
        test('Verify Missing Booking ID: POST /api/file/upload-after-photo without booking_id returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .post('/api/file/upload-after-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Booking ID is required');
        });

        test('Verify Missing File: POST /api/file/upload-after-photo without file returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .post('/api/file/upload-after-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 1 });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('No file uploaded');
        });

        

        test('Verify Unauthorized Access: POST /api/file/upload-after-photo without token returns 401', async () => {
            const response = await request(app)
                .post('/api/file/upload-after-photo')
                .send({ booking_id: 1 });

            expect(response.status).toBe(401);
        });

        
    });

    describe('UPH 1.6 - Delete Photo', () => {
        test('Verify Missing Booking ID: DELETE /api/file/delete-photo without booking_id returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .delete('/api/file/delete-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ type: 'BEFORE' });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('required');
        });

        test('Verify Missing Type: DELETE /api/file/delete-photo without type returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .delete('/api/file/delete-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 1 });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('required');
        });

        test('Verify Invalid Type: DELETE /api/file/delete-photo with invalid type returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .delete('/api/file/delete-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 1, type: 'INVALID' });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Invalid type');
        });

        test('Verify Unauthorized Access: DELETE /api/file/delete-photo without token returns 401', async () => {
            const response = await request(app)
                .delete('/api/file/delete-photo')
                .send({ booking_id: 1, type: 'BEFORE' });

            expect(response.status).toBe(401);
        });

        test('Verify Wrong Role: DELETE /api/file/delete-photo as CUSTOMER returns 403', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .delete('/api/file/delete-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 1, type: 'BEFORE' });

            expect(response.status).toBe(403);
        });

        test('Verify Non-existent Photo: DELETE /api/file/delete-photo with non-existent booking_id returns 404', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .delete('/api/file/delete-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({ booking_id: 999999, type: 'BEFORE' });

            expect(response.status).toBe(404);
        });
    });

    describe('UPH 1.6 - Get Photo', () => {
        test('Verify Missing Booking ID: GET /api/file/get-photo without booking_id returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-photo')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Booking ID');
        });

        test('Verify Unauthorized Access: GET /api/file/get-photo without token returns 401', async () => {
            const response = await request(app)
                .get('/api/file/get-photo?booking_id=1');

            expect(response.status).toBe(401);
        });

        
    });

    describe('UPH 1.6 - Check If Photo Attached', () => {
        test('Verify Missing Booking ID: GET /api/file/check-if-photo-attached without booking_id returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/check-if-photo-attached')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Booking ID');
        });

        

        
    });

    describe('UPH 1.6 - Get Salon Gallery', () => {
        test('Verify Missing Salon ID: GET /api/file/get-salon-gallery without salon_id returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-gallery?employee_id=1&limit=10&offset=0')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Fields missing');
        });

        test('Verify Missing Employee ID: GET /api/file/get-salon-gallery without employee_id returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-gallery?salon_id=1&limit=10&offset=0')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Fields missing');
        });

        test('Verify Missing Limit: GET /api/file/get-salon-gallery without limit returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-gallery?salon_id=1&employee_id=1&offset=0')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Fields missing');
        });

        test('Verify Missing Offset: GET /api/file/get-salon-gallery without offset returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-gallery?salon_id=1&employee_id=1&limit=10')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Fields missing');
        });

        test('Verify Invalid Limit: GET /api/file/get-salon-gallery with invalid limit returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-gallery?salon_id=1&employee_id=1&limit=invalid&offset=0')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Fields missing');
        });

        test('Verify Invalid Offset: GET /api/file/get-salon-gallery with invalid offset returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-gallery?salon_id=1&employee_id=1&limit=10&offset=invalid')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Fields missing');
        });

        test('Verify Unauthorized Access: GET /api/file/get-salon-gallery without token returns 401', async () => {
            const response = await request(app)
                .get('/api/file/get-salon-gallery?salon_id=1&employee_id=1&limit=10&offset=0');

            expect(response.status).toBe(401);
        });
    });

    describe('UAR 1.3 - Upload Salon Photo', () => {
        test('Verify Missing File: POST /api/file/upload-salon-photo without file returns 400', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .post('/api/file/upload-salon-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('No file uploaded');
        });

        

        test('Verify Unauthorized Access: POST /api/file/upload-salon-photo without token returns 401', async () => {
            const response = await request(app)
                .post('/api/file/upload-salon-photo')
                .send({});

            expect(response.status).toBe(401);
        });

        test('Verify Wrong Role: POST /api/file/upload-salon-photo as CUSTOMER returns 403', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .post('/api/file/upload-salon-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(403);
        });
    });

    describe('UAR 1.3 - Get Salon Photo', () => {
        test('Verify Missing Salon ID: GET /api/file/get-salon-photo without salon_id returns 400', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-photo')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('required');
        });

        test('Verify Unauthorized Access: GET /api/file/get-salon-photo without token returns 401', async () => {
            const response = await request(app)
                .get('/api/file/get-salon-photo?salon_id=1');

            expect(response.status).toBe(401);
        });

        test('Verify Non-existent Photo: GET /api/file/get-salon-photo with non-existent salon_id returns 404', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .get('/api/file/get-salon-photo?salon_id=999999')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
        });
    });

    describe('UAR 1.3 - Delete Salon Photo', () => {
        test('Verify Unauthorized Access: DELETE /api/file/delete-salon-photo without token returns 401', async () => {
            const response = await request(app)
                .delete('/api/file/delete-salon-photo')
                .send({});

            expect(response.status).toBe(401);
        });

        test('Verify Wrong Role: DELETE /api/file/delete-salon-photo as CUSTOMER returns 403', async () => {
            const password = 'Password123!';
            const customer = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            const token = generateTestToken(customer);

            const response = await request(app)
                .delete('/api/file/delete-salon-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(403);
        });

        test('Verify Non-existent Photo: DELETE /api/file/delete-salon-photo with owner without salon photo returns 404', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const token = generateTestToken(owner);

            const response = await request(app)
                .delete('/api/file/delete-salon-photo')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(404);
        });
    });
});

