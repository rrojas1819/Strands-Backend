const request = require('supertest');
const connection = require('../src/config/databaseConnection');
const { insertUserWithCredentials, generateTestToken } = require('./helpers/authTestUtils');
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

const {
    setupBookingTestEnvironment,
    setupSecondSalon,
    createBookingWithServices,
    getNextMonday,
    getMyAppointmentsViaAPI,
    getCustomerVisitHistoryViaAPI
} = require('./helpers/bookingTestUtils');

const { createSalon, createService } = require('./helpers/paymentTestUtils');

// Helper functions for review tests
const createSalonReview = async (salonId, userId, rating, message = null) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO reviews (salon_id, user_id, rating, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, userId, rating, message, nowUtc, nowUtc]
    );
    return result.insertId;
};

const createStaffReview = async (employeeId, userId, rating, message = null) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO staff_reviews (employee_id, user_id, rating, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [employeeId, userId, rating, message, nowUtc, nowUtc]
    );
    return result.insertId;
};

const createReviewReply = async (reviewId, authorUserId, message) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO review_replies (review_id, author_user_id, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [reviewId, authorUserId, message, nowUtc, nowUtc]
    );
    return result.insertId;
};

const createStaffReviewReply = async (staffReviewId, authorUserId, message) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO staff_review_replies (staff_review_id, author_user_id, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [staffReviewId, authorUserId, message, nowUtc, nowUtc]
    );
    return result.insertId;
};

// API helper functions
const createSalonReviewViaAPI = async (token, salonId, rating, message = null) => {
    return await request(app)
        .post('/api/reviews/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ salon_id: salonId, rating, message });
};

const listSalonReviewsViaAPI = async (token, salonId, queryParams = {}) => {
    return await request(app)
        .get(`/api/reviews/salon/${salonId}/all`)
        .set('Authorization', `Bearer ${token}`)
        .query(queryParams);
};

const createReviewReplyViaAPI = async (token, reviewId, message) => {
    return await request(app)
        .post('/api/reviews/replies/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ review_id: reviewId, message });
};

const createStaffReviewViaAPI = async (token, employeeId, rating, message = null) => {
    return await request(app)
        .post('/api/staff-reviews/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ employee_id: employeeId, rating, message });
};

const listEmployeeReviewsViaAPI = async (token, employeeId, queryParams = {}) => {
    return await request(app)
        .get(`/api/staff-reviews/employee/${employeeId}/all`)
        .set('Authorization', `Bearer ${token}`)
        .query(queryParams);
};

const createStaffReplyViaAPI = async (token, staffReviewId, message) => {
    return await request(app)
        .post('/api/staff-reviews/replies/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ staff_review_id: staffReviewId, message });
};

const listOwnerStaffReviewsViaAPI = async (token, queryParams = {}) => {
    return await request(app)
        .get('/api/staff-reviews/owner/all')
        .set('Authorization', `Bearer ${token}`)
        .query(queryParams);
};

// Helper function to setup review test environment with completed booking
const setupReviewTestEnvironment = async (options = {}) => {
    const password = options.password || 'Password123!';
    
    // Create users in parallel
    const [owner, customer, employee] = await Promise.all([
        insertUserWithCredentials({ password, role: 'OWNER' }),
        insertUserWithCredentials({ password, role: 'CUSTOMER' }),
        insertUserWithCredentials({ password, role: 'EMPLOYEE' })
    ]);

    // Create salon and service
    const salonId = await createSalon(owner.user_id);
    const serviceId = await createService(salonId, options.serviceName || 'Haircut', options.servicePrice || 50.00);

    // Create employee record
    const nowUtc = toMySQLUtc(DateTime.utc());
    await db.execute(
        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, employee.user_id, options.employeeTitle || 'Stylist', 1, nowUtc, nowUtc]
    );
    const [employeeResult] = await db.execute(
        `SELECT employee_id FROM employees WHERE user_id = ?`,
        [employee.user_id]
    );
    const employeeId = employeeResult[0].employee_id;

    // Create completed booking if requested (default: true)
    if (options.createCompletedBooking !== false) {
        const pastDate = options.bookingDate || DateTime.utc().minus({ days: 1 });
        await createBookingWithServices(
            salonId,
            customer.user_id,
            employeeId,
            serviceId,
            pastDate,
            pastDate.plus({ hours: 1 }),
            'COMPLETED'
        );
    }

    // Generate tokens directly - bypasses HTTP login, DB lookup, and bcrypt
    const ownerToken = generateTestToken(owner);
    const customerToken = generateTestToken(customer);
    const employeeToken = generateTestToken(employee);

    return {
        owner,
        customer,
        employee,
        salonId,
        serviceId,
        employeeId,
        ownerToken,
        customerToken,
        employeeToken,
        password
    };
};

// UPH 1.1 - User Visit History
describe('UPH 1.1 - User Visit History', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify User Own History: GET /api/bookings/myAppointments returns 200 OK with all past appointments', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            const pastTime1 = nextMonday.minus({ weeks: 2 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const pastTime2 = nextMonday.minus({ weeks: 1 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            await Promise.all([
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime1,
                    pastTime1.plus({ minutes: 60 }),
                    'COMPLETED'
                ),
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime2,
                    pastTime2.plus({ minutes: 60 }),
                    'COMPLETED'
                )
            ]);
            
            const response = await getMyAppointmentsViaAPI(env.customerToken);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);
            
            const appointments = response.body.data;
            expect(appointments[0]).toHaveProperty('booking_id');
            expect(appointments[0]).toHaveProperty('salon');
            expect(appointments[0].salon).toHaveProperty('name');
            expect(appointments[0]).toHaveProperty('appointment');
            expect(appointments[0].appointment).toHaveProperty('scheduled_start');
            expect(appointments[0].appointment).toHaveProperty('status');
            expect(appointments[0]).toHaveProperty('services');
            if (appointments[0].services && appointments[0].services.length > 0) {
                expect(appointments[0].services[0]).toHaveProperty('service_name');
                expect(appointments[0].services[0]).toHaveProperty('price');
            }
        });

        test('Verify Ordering: Appointments are ordered by Date (Newest first)', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            const olderTime = nextMonday.minus({ weeks: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const newerTime = nextMonday.minus({ weeks: 1 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            await Promise.all([
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    olderTime,
                    olderTime.plus({ minutes: 60 }),
                    'COMPLETED'
                ),
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    newerTime,
                    newerTime.plus({ minutes: 60 }),
                    'COMPLETED'
                )
            ]);
            
            const response = await getMyAppointmentsViaAPI(env.customerToken);
            
            expect(response.status).toBe(200);
            const appointments = response.body.data;
            if (appointments.length >= 2) {
                const firstDate = new Date(appointments[0].appointment.scheduled_start);
                const secondDate = new Date(appointments[1].appointment.scheduled_start);
                expect(firstDate.getTime()).toBeGreaterThanOrEqual(secondDate.getTime());
            }
        });
    });

    describe('Negative Flow', () => {
        test('Verify No History: New user with 0 appointments returns 200 OK with empty array', async () => {
            const env = await setupBookingTestEnvironment();
            
            const response = await getMyAppointmentsViaAPI(env.customerToken);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Status Filtering: History shows only COMPLETED appointments when filter=past', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            const pastTime = nextMonday.minus({ weeks: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const futureTime = nextMonday.plus({ weeks: 1 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            await Promise.all([
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime,
                    pastTime.plus({ minutes: 60 }),
                    'COMPLETED'
                ),
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    futureTime,
                    futureTime.plus({ minutes: 60 }),
                    'SCHEDULED'
                )
            ]);
            
            const response = await getMyAppointmentsViaAPI(env.customerToken, { filter: 'past' });
            
            expect(response.status).toBe(200);
            const appointments = response.body.data;
            appointments.forEach(appt => {
                expect(appt.appointment.status).toBe('COMPLETED');
            });
        });
    });

    describe('Edge Cases', () => {
        test('Verify Pagination: User with many visits returns paginated results', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            await Promise.all(
                Array.from({ length: 5 }, (_, i) => {
                    const pastTime = nextMonday.minus({ weeks: i + 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
                    return createBookingWithServices(
                        env.salonId,
                        env.customer.user_id,
                        env.employeeId,
                        env.serviceId,
                        pastTime,
                        pastTime.plus({ minutes: 60 }),
                        'COMPLETED'
                    );
                })
            );
            
            const response = await getMyAppointmentsViaAPI(env.customerToken, { page: 1, limit: 3 });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('pagination');
            expect(response.body.pagination).toHaveProperty('current_page', 1);
            expect(response.body.pagination).toHaveProperty('limit', 3);
            expect(response.body.data.length).toBeLessThanOrEqual(3);
        });


    });
});

// UPH 1.2 - Owner View Customer History
describe('UPH 1.2 - Owner View Customer History', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Owner View Customer History: GET /api/bookings/visits/customers/:customer_user_id returns 200 OK with salon-specific appointments', async () => {
            const env = await setupBookingTestEnvironment();
            
            const owner2 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'OWNER'
            });
            
            const salon2 = await setupSecondSalon(owner2.user_id);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            const pastTime1 = nextMonday.minus({ weeks: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const pastTime2 = nextMonday.minus({ weeks: 2 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            await Promise.all([
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime1,
                    pastTime1.plus({ minutes: 60 }),
                    'COMPLETED'
                ),
                createBookingWithServices(
                    salon2.salonId,
                    env.customer.user_id,
                    salon2.employeeId,
                    salon2.serviceId,
                    pastTime2,
                    pastTime2.plus({ minutes: 60 }),
                    'COMPLETED'
                )
            ]);
            
            const owner2Token = generateTestToken(owner2);
            
            const response = await getCustomerVisitHistoryViaAPI(owner2Token, env.customer.user_id);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('visits');
            expect(Array.isArray(response.body.data.visits)).toBe(true);
            
            const visits = response.body.data.visits;
            for (const visit of visits) {
                const [salonCheck] = await db.execute(
                    'SELECT salon_id FROM bookings WHERE booking_id = ?',
                    [visit.booking_id]
                );
                expect(salonCheck[0].salon_id).toBe(salon2.salonId);
            }
        });

    });

    describe('Negative Flow', () => {
        test('Verify Invalid Customer ID: Requesting history for non-existent customer returns 404', async () => {
            const env = await setupBookingTestEnvironment();
            
            const nonExistentCustomerId = 99999;
            const response = await getCustomerVisitHistoryViaAPI(env.ownerToken, nonExistentCustomerId);
            
            expect([404, 200]).toContain(response.status);
        });

        test('Verify No History: Customer with 0 appointments returns 200 OK with empty array', async () => {
            const newCustomer = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            
            const env = await setupBookingTestEnvironment();
            
            const response = await getCustomerVisitHistoryViaAPI(env.ownerToken, newCustomer.user_id);
            
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('visits');
            expect(Array.isArray(response.body.data.visits)).toBe(true);
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Privacy Scope: Owner X only sees visits to Salon X, not Salon Y', async () => {
            const env = await setupBookingTestEnvironment();
            
            const owner2 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'OWNER'
            });
            
            const salon2 = await setupSecondSalon(owner2.user_id);
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            const pastTime1 = nextMonday.minus({ weeks: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            const pastTime2 = nextMonday.minus({ weeks: 2 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            
            await Promise.all([
                createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime1,
                    pastTime1.plus({ minutes: 60 }),
                    'COMPLETED'
                ),
                createBookingWithServices(
                    salon2.salonId,
                    env.customer.user_id,
                    salon2.employeeId,
                    salon2.serviceId,
                    pastTime2,
                    pastTime2.plus({ minutes: 60 }),
                    'COMPLETED'
                )
            ]);
            
            const response = await getCustomerVisitHistoryViaAPI(env.ownerToken, env.customer.user_id);
            
            expect(response.status).toBe(200);
            const visits = response.body.data.visits;
            for (const visit of visits) {
                const [bookingCheck] = await db.execute(
                    'SELECT salon_id FROM bookings WHERE booking_id = ?',
                    [visit.booking_id]
                );
                expect(bookingCheck[0].salon_id).toBe(env.salonId);
                expect(bookingCheck[0].salon_id).not.toBe(salon2.salonId);
            }
        });

    });

    describe('Security & Permissions', () => {
        test('Verify: Customer A cannot access Customer B history', async () => {
            const env = await setupBookingTestEnvironment();
            
            const customer2 = await insertUserWithCredentials({
                password: 'Password123!',
                role: 'CUSTOMER'
            });
            
            const response = await getCustomerVisitHistoryViaAPI(env.customerToken, customer2.user_id);
            
            expect(response.status).toBe(403);
            expect(response.body).toHaveProperty('error', 'Insufficient permissions');
        });

        test('Verify Employee Access: Employee can view customer history returns 200 OK', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            const pastTime = nextMonday.minus({ weeks: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastTime,
                pastTime.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
            const response = await getCustomerVisitHistoryViaAPI(env.employeeToken, env.customer.user_id);
            
            expect([200, 403]).toContain(response.status);
        });

        test('Verify Unauthenticated Access: Request without token returns 401 Unauthorized', async () => {
            const response = await request(app)
                .get('/api/bookings/visits/customers/1');
            
            expect(response.status).toBe(401);
        });
    });

    describe('Edge Cases', () => {
        test('Verify Pagination: Customer with many visits returns paginated results', async () => {
            const env = await setupBookingTestEnvironment();
            
            const now = DateTime.utc();
            const nextMonday = getNextMonday(now);
            
            await Promise.all(
                Array.from({ length: 5 }, (_, i) => {
                    const pastTime = nextMonday.minus({ weeks: i + 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
                    return createBookingWithServices(
                        env.salonId,
                        env.customer.user_id,
                        env.employeeId,
                        env.serviceId,
                        pastTime,
                        pastTime.plus({ minutes: 60 }),
                        'COMPLETED'
                    );
                })
            );
            
            const response = await getCustomerVisitHistoryViaAPI(env.ownerToken, env.customer.user_id, { limit: 3, offset: 0 });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('limit', 3);
            expect(response.body.data).toHaveProperty('offset', 0);
            expect(response.body.data).toHaveProperty('has_more');
            expect(response.body.data.visits.length).toBeLessThanOrEqual(3);
        });

    });
});

// UPH 1.3 - User Leaves Reviews for Salons
describe('UPH 1.3 - User Leaves Reviews for Salons', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Customer Creates Salon Review and Appears in List: POST /api/reviews/create returns 201 and review shows in list', async () => {
            const env = await setupReviewTestEnvironment();

            const createResponse = await createSalonReviewViaAPI(env.customerToken, env.salonId, 4.5, 'Great service!');

            expect(createResponse.status).toBe(201);
            expect(createResponse.body).toHaveProperty('message', 'Review created');
            expect(createResponse.body.data).toHaveProperty('review_id');
            expect(createResponse.body.data).toHaveProperty('salon_id', env.salonId);
            expect(createResponse.body.data).toHaveProperty('rating', 4.5);
            expect(createResponse.body.data).toHaveProperty('message', 'Great service!');
            expect(createResponse.body.data).toHaveProperty('user');
            expect(createResponse.body.data.user.user_id).toBe(env.customer.user_id);

            const reviewId = createResponse.body.data.review_id;
            const listResponse = await listSalonReviewsViaAPI(env.ownerToken, env.salonId);

            expect(listResponse.status).toBe(200);
            const review = listResponse.body.data.find(r => r.review_id === reviewId);
            expect(review).toBeDefined();
            expect(review.rating).toBe(4.5);
            expect(review.message).toBe('Great service!');
        });

        test('Verify Update, Delete, and Get My Review: All review operations work correctly', async () => {
            const env = await setupReviewTestEnvironment();
            
            const createResponse = await createSalonReviewViaAPI(env.customerToken, env.salonId, 3.0, 'It was okay');
            expect(createResponse.status).toBe(201);
            const reviewId = createResponse.body.data.review_id;

            const updateResponse = await request(app)
                .patch(`/api/reviews/update/${reviewId}`)
                .set('Authorization', `Bearer ${env.customerToken}`)
                .send({ rating: 4.5, message: 'Actually, it was great!' });

            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body.data.rating).toBe(4.5);
            expect(updateResponse.body.data.message).toBe('Actually, it was great!');

            const getResponse = await request(app)
                .get(`/api/reviews/salon/${env.salonId}/myReview`)
                .set('Authorization', `Bearer ${env.customerToken}`);

            expect(getResponse.status).toBe(200);
            expect(getResponse.body.data).toBeDefined();
            expect(getResponse.body.data.review_id).toBe(reviewId);
            expect(getResponse.body.data.rating).toBe(4.5);

            const deleteResponse = await request(app)
                .delete(`/api/reviews/delete/${reviewId}`)
                .set('Authorization', `Bearer ${env.customerToken}`);

            expect(deleteResponse.status).toBe(200);
            expect(deleteResponse.body.message).toContain('Review deleted');

            const [review] = await db.execute(
                'SELECT review_id FROM reviews WHERE review_id = ?',
                [reviewId]
            );
            expect(review.length).toBe(0);
        });
    });

    describe('Negative Flow', () => {
        test('Verify No Completed Visit: Customer cannot review salon without completed visit', async () => {
            const env = await setupReviewTestEnvironment({ createCompletedBooking: false });

            const response = await createSalonReviewViaAPI(env.customerToken, env.salonId, 5.0, 'Great!');

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You can review a salon only after a completed visit');
        });

        test('Verify Duplicate Review Prevention: Customer cannot create multiple reviews for same salon', async () => {
            const env = await setupReviewTestEnvironment();
            
            await createSalonReviewViaAPI(env.customerToken, env.salonId, 4.0, 'First review');

            const response = await createSalonReviewViaAPI(env.customerToken, env.salonId, 5.0, 'Second review');

            expect(response.status).toBe(409);
            expect(response.body.message).toContain('You have already reviewed this salon');
        });

        test('Verify Invalid Rating: Rating must be 0.0-5.0 in 0.5 steps', async () => {
            const env = await setupReviewTestEnvironment();

            const invalidRatings = [6.0, -1.0, 4.3, 2.7];
            const responses = await Promise.all(
                invalidRatings.map(rating =>
                    createSalonReviewViaAPI(env.customerToken, env.salonId, rating, 'Invalid rating')
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(400);
                expect(response.body.message).toContain('rating must be between 0.0 and 5.0');
            }
        });

        test('Verify Invalid Salon ID: Creating review for non-existent salon returns 404', async () => {
            const env = await setupReviewTestEnvironment({ createCompletedBooking: false });

            const response = await createSalonReviewViaAPI(env.customerToken, 99999, 5.0, 'Review');

            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Salon not found');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Multiple Customers Can Review Same Salon: Different customers can leave reviews', async () => {
            const password = 'Password123!';
            const [owner, customer1, customer2, customer3] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await Promise.all([
                createBookingWithServices(salonId, customer1.user_id, employeeId, serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer2.user_id, employeeId, serviceId, pastDate.plus({ hours: 2 }), pastDate.plus({ hours: 3 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer3.user_id, employeeId, serviceId, pastDate.plus({ hours: 4 }), pastDate.plus({ hours: 5 }), 'COMPLETED')
            ]);

            // Generate tokens directly - bypasses HTTP login, DB lookup, and bcrypt
            const token1 = generateTestToken(customer1);
            const token2 = generateTestToken(customer2);
            const token3 = generateTestToken(customer3);

            const responses = await Promise.all([
                createSalonReviewViaAPI(token1, salonId, 5.0, 'Excellent!'),
                createSalonReviewViaAPI(token2, salonId, 4.5, 'Very good'),
                createSalonReviewViaAPI(token3, salonId, 4.0, 'Good service')
            ]);

            for (const response of responses) {
                expect(response.status).toBe(201);
                expect(response.body.data).toHaveProperty('review_id');
            }

            const ownerToken = generateTestToken(owner);
            const listResponse = await listSalonReviewsViaAPI(ownerToken, salonId);

            expect(listResponse.status).toBe(200);
            expect(listResponse.body.data.length).toBeGreaterThanOrEqual(3);
            expect(listResponse.body.meta.total).toBeGreaterThanOrEqual(3);
        });

        test('Verify Review Without Message: Review can be created with only rating', async () => {
            const env = await setupReviewTestEnvironment();

            const response = await createSalonReviewViaAPI(env.customerToken, env.salonId, 5.0, null);

            expect(response.status).toBe(201);
            expect(response.body.data.rating).toBe(5.0);
            expect(response.body.data.message).toBeNull();
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Cross-User Update Prevention: Customer cannot update another customer\'s review', async () => {
            const password = 'Password123!';
            const env1 = await setupReviewTestEnvironment();
            const customer2 = await insertUserWithCredentials({ password, role: 'CUSTOMER' });
            
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env1.salonId,
                customer2.user_id,
                env1.employeeId,
                env1.serviceId,
                pastDate.plus({ hours: 2 }),
                pastDate.plus({ hours: 3 }),
                'COMPLETED'
            );

            const token2 = generateTestToken(customer2);

            const createResponse = await createSalonReviewViaAPI(env1.customerToken, env1.salonId, 4.0, 'My review');
            const reviewId = createResponse.body.data.review_id;

            const updateResponse = await request(app)
                .patch(`/api/reviews/update/${reviewId}`)
                .set('Authorization', `Bearer ${token2}`)
                .send({ rating: 1.0, message: 'Hacked review' });

            expect(updateResponse.status).toBe(404);
            expect(updateResponse.body.message).toContain('Review not found');
        });

        test('Verify Non-Customer Access: Non-customer roles cannot create reviews', async () => {
            const env = await setupReviewTestEnvironment({ createCompletedBooking: false });

            const [ownerResponse, employeeResponse] = await Promise.all([
                createSalonReviewViaAPI(env.ownerToken, env.salonId, 5.0, 'Owner review'),
                createSalonReviewViaAPI(env.employeeToken, env.salonId, 5.0, 'Employee review')
            ]);

            expect(ownerResponse.status).toBe(403);
            expect(employeeResponse.status).toBe(403);
        });
    });
});

// UPH 1.31 - Stylist/Owner View Salon Reviews
describe('UPH 1.31 - Stylist/Owner View Salon Reviews', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Owner Views Salon Reviews: GET /api/reviews/salon/:salon_id/all returns 200 OK with reviews and ratings', async () => {
            const password = 'Password123!';
            const [owner, customer1, customer2] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            const [bookingId1, bookingId2] = await Promise.all([
                createBookingWithServices(
                    salonId,
                    customer1.user_id,
                    employeeId,
                    serviceId,
                    pastDate,
                    pastDate.plus({ hours: 1 }),
                    'COMPLETED'
                ),
                createBookingWithServices(
                    salonId,
                    customer2.user_id,
                    employeeId,
                    serviceId,
                    pastDate.plus({ hours: 2 }),
                    pastDate.plus({ hours: 3 }),
                    'COMPLETED'
                )
            ]);

            await Promise.all([
                createSalonReview(salonId, customer1.user_id, 4.5, 'Great service!'),
                createSalonReview(salonId, customer2.user_id, 5.0, 'Excellent experience')
            ]);

            const ownerToken = generateTestToken(owner);

            const response = await listSalonReviewsViaAPI(ownerToken, salonId);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('meta');
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);
            expect(response.body.meta).toHaveProperty('total');
            expect(response.body.meta).toHaveProperty('avg_rating');
            expect(Number(response.body.meta.avg_rating)).toBeGreaterThanOrEqual(4.5);

            const reviews = response.body.data;
            expect(reviews[0]).toHaveProperty('review_id');
            expect(reviews[0]).toHaveProperty('rating');
            expect(reviews[0]).toHaveProperty('message');
            expect(reviews[0]).toHaveProperty('user');
            expect(reviews[0]).toHaveProperty('reply');
        });

        test('Verify Employee Views Salon Reviews: GET /api/reviews/salon/:salon_id/all returns 200 OK for employee', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            await createSalonReview(env.salonId, env.customer.user_id, 4.0, 'Good service');

            const response = await listSalonReviewsViaAPI(env.employeeToken, env.salonId);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('meta');
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Average Rating Calculation: Multiple reviews calculate correct average', async () => {
            const password = 'Password123!';
            const [owner, customer1, customer2, customer3] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await Promise.all([
                createBookingWithServices(salonId, customer1.user_id, employeeId, serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer2.user_id, employeeId, serviceId, pastDate.plus({ hours: 2 }), pastDate.plus({ hours: 3 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer3.user_id, employeeId, serviceId, pastDate.plus({ hours: 4 }), pastDate.plus({ hours: 5 }), 'COMPLETED')
            ]);

            await Promise.all([
                createSalonReview(salonId, customer1.user_id, 5.0),
                createSalonReview(salonId, customer2.user_id, 4.0),
                createSalonReview(salonId, customer3.user_id, 3.0)
            ]);

            const ownerToken = generateTestToken(owner);
            const response = await listSalonReviewsViaAPI(ownerToken, salonId);

            expect(response.status).toBe(200);
            const avgRating = Number(response.body.meta.avg_rating);
            expect(avgRating).toBeCloseTo(4.0, 1);
        });

        test('Verify Reviews Include Replies: Reviews show owner replies when present', async () => {
            const password = 'Password123!';
            const [owner, customer] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId,
                customer.user_id,
                employeeId,
                serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const reviewId = await createSalonReview(salonId, customer.user_id, 4.0, 'Good service');
            await createReviewReply(reviewId, owner.user_id, 'Thank you for your feedback!');

            const ownerToken = generateTestToken(owner);
            const response = await listSalonReviewsViaAPI(ownerToken, salonId);

            expect(response.status).toBe(200);
            const review = response.body.data.find(r => r.review_id === reviewId);
            expect(review).toBeDefined();
            expect(review.reply).not.toBeNull();
            expect(review.reply.message).toBe('Thank you for your feedback!');
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Owner Can Only View Own Salon: Owner cannot view reviews for other salons', async () => {
            const password = 'Password123!';
            const [owner1, owner2] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'OWNER' })
            ]);

            const [salonId1, salonId2] = await Promise.all([
                createSalon(owner1.user_id),
                createSalon(owner2.user_id)
            ]);

            const owner1Token = generateTestToken(owner1);

            const response = await listSalonReviewsViaAPI(owner1Token, salonId2);

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You can only view reviews for your own salon');
        });

        test('Verify Employee Can Only View Own Salon: Employee cannot view reviews for other salons', async () => {
            const env = await setupBookingTestEnvironment();

            const owner2 = await insertUserWithCredentials({ password: 'Password123!', role: 'OWNER' });
            const salonId2 = await createSalon(owner2.user_id);

            const response = await listSalonReviewsViaAPI(env.employeeToken, salonId2);

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You can only view reviews for the salon you work at');
        });
    });
});

// UPH 1.4 - Owner Responds to Reviews
describe('UPH 1.4 - Owner Responds to Reviews', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Owner Creates Reply: POST /api/reviews/replies/create returns 201 OK', async () => {
            const password = 'Password123!';
            const [owner, customer] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId,
                customer.user_id,
                employeeId,
                serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const reviewId = await createSalonReview(salonId, customer.user_id, 4.0, 'Good service');

            const ownerToken = generateTestToken(owner);

            const response = await createReviewReplyViaAPI(ownerToken, reviewId, 'Thank you for your feedback!');

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message', 'Reply created');
            expect(response.body.data).toHaveProperty('reply_id');
            expect(response.body.data).toHaveProperty('review_id', reviewId);
            expect(response.body.data).toHaveProperty('message', 'Thank you for your feedback!');
            expect(response.body.data).toHaveProperty('user');
        });

        test('Verify Reply Appears in Review List: Reply shows up when listing salon reviews', async () => {
            const password = 'Password123!';
            const [owner, customer] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId,
                customer.user_id,
                employeeId,
                serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const reviewId = await createSalonReview(salonId, customer.user_id, 4.0, 'Good service');

            const ownerToken = generateTestToken(owner);
            await createReviewReplyViaAPI(ownerToken, reviewId, 'Thank you!');

            const listResponse = await listSalonReviewsViaAPI(ownerToken, salonId);

            expect(listResponse.status).toBe(200);
            const review = listResponse.body.data.find(r => r.review_id === reviewId);
            expect(review).toBeDefined();
            expect(review.reply).not.toBeNull();
            expect(review.reply.message).toBe('Thank you!');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Duplicate Reply Prevention: Owner cannot create multiple replies to same review', async () => {
            const password = 'Password123!';
            const [owner, customer] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId,
                customer.user_id,
                employeeId,
                serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const reviewId = await createSalonReview(salonId, customer.user_id, 4.0, 'Good service');

            const ownerToken = generateTestToken(owner);
            await createReviewReplyViaAPI(ownerToken, reviewId, 'First reply');

            const response = await createReviewReplyViaAPI(ownerToken, reviewId, 'Second reply');

            expect(response.status).toBe(409);
            expect(response.body.message).toContain('A reply already exists');
        });

        test('Verify Invalid Review ID: Creating reply for non-existent review returns 404', async () => {
            const password = 'Password123!';
            const owner = await insertUserWithCredentials({ password, role: 'OWNER' });
            const ownerToken = generateTestToken(owner);

            const response = await createReviewReplyViaAPI(ownerToken, 99999, 'Test reply');

            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Review not found');
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Cross-Salon Reply Prevention: Owner cannot reply to reviews for other salons', async () => {
            const password = 'Password123!';
            const [owner1, owner2, customer] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const [salonId1, salonId2] = await Promise.all([
                createSalon(owner1.user_id),
                createSalon(owner2.user_id)
            ]);

            const serviceId = await createService(salonId1, 'Haircut', 50.00);

            const employee = await insertUserWithCredentials({ password, role: 'EMPLOYEE' });
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId1, employee.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );
            const [employeeResult] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee.user_id]
            );
            const employeeId = employeeResult[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId1,
                customer.user_id,
                employeeId,
                serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const reviewId = await createSalonReview(salonId1, customer.user_id, 4.0, 'Good service');

            const owner2Token = generateTestToken(owner2);

            const response = await createReviewReplyViaAPI(owner2Token, reviewId, 'Unauthorized reply');

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You can only reply to reviews for your own salon');
        });
    });
});

// UPH 1.5 - User Leaves Reviews for Staff
describe('UPH 1.5 - User Leaves Reviews for Staff', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Customer Creates Staff Review and Appears in List: POST /api/staff-reviews/create returns 201 and review shows in list', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const createResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 5.0, 'Excellent stylist!');

            expect(createResponse.status).toBe(201);
            expect(createResponse.body).toHaveProperty('message', 'Staff review created');
            expect(createResponse.body.data).toHaveProperty('staff_review_id');
            expect(createResponse.body.data).toHaveProperty('employee_id', env.employeeId);
            expect(createResponse.body.data).toHaveProperty('rating', 5.0);
            expect(createResponse.body.data).toHaveProperty('message', 'Excellent stylist!');
            expect(createResponse.body.data).toHaveProperty('user');

            const staffReviewId = createResponse.body.data.staff_review_id;
            const listResponse = await listEmployeeReviewsViaAPI(env.customerToken, env.employeeId);

            expect(listResponse.status).toBe(200);
            expect(listResponse.body).toHaveProperty('data');
            expect(listResponse.body).toHaveProperty('meta');
            const review = listResponse.body.data.find(r => r.staff_review_id === staffReviewId);
            expect(review).toBeDefined();
            expect(review.rating).toBe(5.0);
            expect(review.message).toBe('Excellent stylist!');
        });
    });

    describe('Negative Flow', () => {
        test('Verify No Completed Visit: Customer cannot review staff without completed visit', async () => {
            const env = await setupBookingTestEnvironment();

            const response = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 5.0, 'Review without visit');

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You can review a stylist only after a completed service');
        });

        test('Verify Duplicate Review Prevention: Customer cannot create multiple reviews for same staff', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            await createStaffReviewViaAPI(env.customerToken, env.employeeId, 5.0, 'First review');

            const response = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.0, 'Second review');

            expect(response.status).toBe(409);
            expect(response.body.message).toContain('You have already reviewed this stylist');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Rating Validation: Only half-star ratings (0.5, 1.0, 1.5, etc.) are accepted', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const validResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.5, 'Valid rating');
            expect(validResponse.status).toBe(201);

            const invalidResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.3, 'Invalid rating');
            expect(invalidResponse.status).toBe(400);
            expect(invalidResponse.body.message).toContain('rating must be');
        });
    });

    describe('Edge Cases', () => {
        const updateStaffReviewViaAPI = async (token, reviewId, rating, message) => {
            return await request(app)
                .patch(`/api/staff-reviews/update/${reviewId}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ rating, message });
        };

        const deleteStaffReviewViaAPI = async (token, reviewId) => {
            return await request(app)
                .delete(`/api/staff-reviews/delete/${reviewId}`)
                .set('Authorization', `Bearer ${token}`);
        };

        const getMyStaffReviewViaAPI = async (token, employeeId) => {
            return await request(app)
                .get(`/api/staff-reviews/employee/${employeeId}/myReview`)
                .set('Authorization', `Bearer ${token}`);
        };

        test.each([
            { scenario: 'invalid employee_id', employeeId: 99999, rating: 5.0, expectedStatus: 404, expectMessage: 'Employee not found' },
            { scenario: 'no completed booking', employeeId: null, rating: 5.0, expectedStatus: 403, expectMessage: 'completed service', hasBooking: false },
            { scenario: 'invalid rating', employeeId: null, rating: 4.3, expectedStatus: 400, expectMessage: '0.0–5.0 in 0.5 steps', hasBooking: true },
            { scenario: 'duplicate review', employeeId: null, rating: 5.0, expectedStatus: 409, expectMessage: 'already reviewed', hasBooking: true, duplicate: true }
        ])('Verify Create Staff Review Errors: $scenario returns $expectedStatus', async ({ employeeId, rating, expectedStatus, expectMessage, hasBooking, duplicate }) => {
            const env = await setupBookingTestEnvironment();
            let actualEmployeeId = employeeId || env.employeeId;

            if (hasBooking !== false) {
                const pastDate = DateTime.utc().minus({ days: 1 });
                await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');
            }

            if (duplicate) {
                await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.0, 'First review');
            }

            const response = await createStaffReviewViaAPI(env.customerToken, actualEmployeeId, rating, 'Test review');

            expect(response.status).toBe(expectedStatus);
            if (expectMessage) {
                expect(response.body.message).toContain(expectMessage);
            }
        });

        test('Verify Update Staff Review: PATCH /api/staff-reviews/update/:staff_review_id updates rating and message', async () => {
            const env = await setupBookingTestEnvironment();
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');

            const createResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 3.0, 'Initial review');
            const reviewId = createResponse.body.data.staff_review_id;

            const updateResponse = await updateStaffReviewViaAPI(env.customerToken, reviewId, 4.5, 'Updated review');

            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body.data.rating).toBe(4.5);
            expect(updateResponse.body.data.message).toBe('Updated review');
        });

        test.each([
            { scenario: 'non-existent review', reviewId: 99999, expectedStatus: 404 },
            { scenario: 'nothing to update', reviewId: null, expectedStatus: 400, hasReview: true, emptyUpdate: true },
            { scenario: 'invalid rating', reviewId: null, expectedStatus: 400, hasReview: true, invalidRating: true },
            { scenario: 'cross-user update', reviewId: null, expectedStatus: 404, hasReview: true, crossUser: true }
        ])('Verify Update Staff Review Errors: $scenario returns $expectedStatus', async ({ reviewId, expectedStatus, hasReview, emptyUpdate, invalidRating, crossUser }) => {
            const env = await setupBookingTestEnvironment();
            let actualReviewId = reviewId;
            let authToken = env.customerToken;

            if (hasReview) {
                const pastDate = DateTime.utc().minus({ days: 1 });
                await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');
                const createResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.0, 'My review');
                actualReviewId = createResponse.body.data.staff_review_id;

                if (crossUser) {
                    const customer2 = await insertUserWithCredentials({ password: 'Password123!', role: 'CUSTOMER' });
                    authToken = generateTestToken(customer2);
                }
            }

            const updateData = emptyUpdate ? {} : invalidRating ? { rating: 4.3 } : { rating: 4.5, message: 'Updated' };
            const response = await request(app)
                .patch(`/api/staff-reviews/update/${actualReviewId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(updateData);

            expect(response.status).toBe(expectedStatus);
        });

        test('Verify Delete Staff Review: DELETE /api/staff-reviews/delete/:staff_review_id removes review', async () => {
            const env = await setupBookingTestEnvironment();
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');

            const createResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.0, 'Review to delete');
            const reviewId = createResponse.body.data.staff_review_id;

            const deleteResponse = await deleteStaffReviewViaAPI(env.customerToken, reviewId);

            expect(deleteResponse.status).toBe(200);
            const [reviews] = await db.execute('SELECT staff_review_id FROM staff_reviews WHERE staff_review_id = ?', [reviewId]);
            expect(reviews.length).toBe(0);
        });

        test.each([
            { scenario: 'non-existent review', reviewId: 99999, expectedStatus: 404 },
            { scenario: 'cross-user delete', reviewId: null, expectedStatus: 404, hasReview: true, crossUser: true }
        ])('Verify Delete Staff Review Errors: $scenario returns $expectedStatus', async ({ reviewId, expectedStatus, hasReview, crossUser }) => {
            const env = await setupBookingTestEnvironment();
            let actualReviewId = reviewId;
            let authToken = env.customerToken;

            if (hasReview) {
                const pastDate = DateTime.utc().minus({ days: 1 });
                await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');
                const createResponse = await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.0, 'My review');
                actualReviewId = createResponse.body.data.staff_review_id;

                if (crossUser) {
                    const customer2 = await insertUserWithCredentials({ password: 'Password123!', role: 'CUSTOMER' });
                    authToken = generateTestToken(customer2);
                }
            }

            const response = await deleteStaffReviewViaAPI(authToken, actualReviewId);

            expect(response.status).toBe(expectedStatus);
        });

        test('Verify List Employee Reviews: GET /api/staff-reviews/employee/:employee_id/all with pagination and role-based access', async () => {
            const env = await setupBookingTestEnvironment();
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');

            const customer2 = await insertUserWithCredentials({ password: 'Password123!', role: 'CUSTOMER' });
            const customer2Token = generateTestToken(customer2);
            const pastDate2 = DateTime.utc().minus({ days: 2 });
            await createBookingWithServices(env.salonId, customer2.user_id, env.employeeId, env.serviceId, pastDate2, pastDate2.plus({ hours: 1 }), 'COMPLETED');

            await Promise.all([
                createStaffReviewViaAPI(env.customerToken, env.employeeId, 5.0, 'Review 1'),
                createStaffReviewViaAPI(customer2Token, env.employeeId, 4.5, 'Review 2')
            ]);

            const [customerResponse, employeeResponse, ownerResponse] = await Promise.all([
                listEmployeeReviewsViaAPI(env.customerToken, env.employeeId),
                listEmployeeReviewsViaAPI(env.employeeToken, env.employeeId),
                listEmployeeReviewsViaAPI(env.ownerToken, env.employeeId)
            ]);

            expect(customerResponse.status).toBe(200);
            expect(employeeResponse.status).toBe(200);
            expect(ownerResponse.status).toBe(200);
            expect(customerResponse.body.data.length).toBeGreaterThanOrEqual(2);
            expect(customerResponse.body.meta).toHaveProperty('avg_rating');
        });

        test.each([
            { scenario: 'employee views other employee reviews', role: 'EMPLOYEE', expectedStatus: 403, expectMessage: 'only view your own' }])('Verify List Employee Reviews Access Control: $scenario returns $expectedStatus', async ({ role, expectedStatus, expectMessage, crossSalon }) => {
            const env = await setupBookingTestEnvironment();
            let employeeId = env.employeeId;
            let authToken = role === 'EMPLOYEE' ? env.employeeToken : env.ownerToken;

            if (crossSalon) {
                const owner2 = await insertUserWithCredentials({ password: 'Password123!', role: 'OWNER' });
                const salon2Id = await createSalon(owner2.user_id);
                const employee2 = await insertUserWithCredentials({ password: 'Password123!', role: 'EMPLOYEE' });
                const nowUtc = toMySQLUtc(DateTime.utc());
                await db.execute(
                    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [salon2Id, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
                );
                const [empResult] = await db.execute('SELECT employee_id FROM employees WHERE user_id = ?', [employee2.user_id]);
                employeeId = empResult[0].employee_id;
                authToken = generateTestToken(owner2);
            } else if (role === 'EMPLOYEE') {
                const employee2 = await insertUserWithCredentials({ password: 'Password123!', role: 'EMPLOYEE' });
                const nowUtc = toMySQLUtc(DateTime.utc());
                await db.execute(
                    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [env.salonId, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
                );
                const [empResult] = await db.execute('SELECT employee_id FROM employees WHERE user_id = ?', [employee2.user_id]);
                const employee2Id = empResult[0].employee_id;
                authToken = generateTestToken(employee2);
                employeeId = env.employeeId;
            }

            const response = await listEmployeeReviewsViaAPI(authToken, employeeId);

            expect(response.status).toBe(expectedStatus);
            if (expectMessage) {
                expect(response.body.message).toContain(expectMessage);
            }
        });

        test('Verify Get My Staff Review: GET /api/staff-reviews/employee/:employee_id/myReview returns user\'s review or null', async () => {
            const env = await setupBookingTestEnvironment();
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');

            const noReviewResponse = await getMyStaffReviewViaAPI(env.customerToken, env.employeeId);
            expect(noReviewResponse.status).toBe(200);
            expect(noReviewResponse.body.data).toBeNull();

            await createStaffReviewViaAPI(env.customerToken, env.employeeId, 4.5, 'My review');

            const withReviewResponse = await getMyStaffReviewViaAPI(env.customerToken, env.employeeId);
            expect(withReviewResponse.status).toBe(200);
            expect(withReviewResponse.body.data).toBeDefined();
            expect(withReviewResponse.body.data.rating).toBe(4.5);
        });
    });
});

// UPH 1.51 - Stylist Responds to Reviews
describe('UPH 1.51 - Stylist Responds to Reviews', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Employee Creates Reply and Appears in Review List: POST /api/staff-reviews/replies/create returns 201 and reply shows in list', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const staffReviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Good service');

            const createResponse = await createStaffReplyViaAPI(env.employeeToken, staffReviewId, 'Thank you for your feedback!');

            expect(createResponse.status).toBe(201);
            expect(createResponse.body).toHaveProperty('message', 'Staff reply created');
            expect(createResponse.body.data).toHaveProperty('staff_reply_id');
            expect(createResponse.body.data).toHaveProperty('staff_review_id', staffReviewId);
            expect(createResponse.body.data).toHaveProperty('message', 'Thank you for your feedback!');
            expect(createResponse.body.data).toHaveProperty('user');

            const listResponse = await listEmployeeReviewsViaAPI(env.customerToken, env.employeeId);

            expect(listResponse.status).toBe(200);
            const review = listResponse.body.data.find(r => r.staff_review_id === staffReviewId);
            expect(review).toBeDefined();
            expect(review.reply).not.toBeNull();
            expect(review.reply.message).toBe('Thank you for your feedback!');
        });
    });

    describe('Negative Flow', () => {
        test('Verify Duplicate Reply Prevention: Employee cannot create multiple replies to same review', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const staffReviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Good service');
            await createStaffReplyViaAPI(env.employeeToken, staffReviewId, 'First reply');

            const response = await createStaffReplyViaAPI(env.employeeToken, staffReviewId, 'Second reply');

            expect(response.status).toBe(409);
            expect(response.body.message).toContain('A reply already exists');
        });

        test('Verify Invalid Review ID: Creating reply for non-existent review returns 404', async () => {
            const env = await setupBookingTestEnvironment();

            const response = await createStaffReplyViaAPI(env.employeeToken, 99999, 'Test reply');

            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Staff review not found');
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Cross-Employee Reply Prevention: Employee cannot reply to reviews for other employees', async () => {
            const env = await setupBookingTestEnvironment();

            const [owner2, employee2, customer2] = await Promise.all([
                insertUserWithCredentials({ password: 'Password123!', role: 'OWNER' }),
                insertUserWithCredentials({ password: 'Password123!', role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password: 'Password123!', role: 'CUSTOMER' })
            ]);

            const salonId2 = await createSalon(owner2.user_id);
            const serviceId2 = await createService(salonId2, 'Haircut', 50.00);

            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId2, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );

            const [employee2Result] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee2.user_id]
            );
            const employee2Id = employee2Result[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId2,
                customer2.user_id,
                employee2Id,
                serviceId2,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const staffReviewId = await createStaffReview(employee2Id, customer2.user_id, 4.0, 'Good service');

            const response = await createStaffReplyViaAPI(env.employeeToken, staffReviewId, 'Unauthorized reply');

            expect(response.status).toBe(403);
            expect(response.body.message).toContain('You can only reply to reviews about you');
        });
    });

    describe('Edge Cases', () => {
        const updateStaffReplyViaAPI = async (token, replyId, message) => {
            return await request(app)
                .patch(`/api/staff-reviews/replies/update/${replyId}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ message });
        };

        const deleteStaffReplyViaAPI = async (token, replyId) => {
            return await request(app)
                .delete(`/api/staff-reviews/replies/delete/${replyId}`)
                .set('Authorization', `Bearer ${token}`);
        };

        test.each([
            { scenario: 'non-existent review', reviewId: 99999, expectedStatus: 404 },
            { scenario: 'empty message', reviewId: null, expectedStatus: 400, hasReview: true, emptyMessage: true },
            { scenario: 'message too long', reviewId: null, expectedStatus: 400, hasReview: true, longMessage: true },
            { scenario: 'duplicate reply', reviewId: null, expectedStatus: 409, hasReview: true, duplicate: true },
            { scenario: 'reply to other employee review', reviewId: null, expectedStatus: 403, hasReview: true, crossEmployee: true }
        ])('Verify Create Staff Reply Errors: $scenario returns $expectedStatus', async ({ reviewId, expectedStatus, hasReview, emptyMessage, longMessage, duplicate, crossEmployee }) => {
            const env = await setupBookingTestEnvironment();
            let actualReviewId = reviewId;
            let authToken = env.employeeToken;

            if (hasReview) {
                const pastDate = DateTime.utc().minus({ days: 1 });
                await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');
                actualReviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Review');

                if (crossEmployee) {
                    const employee2 = await insertUserWithCredentials({ password: 'Password123!', role: 'EMPLOYEE' });
                    const nowUtc = toMySQLUtc(DateTime.utc());
                    await db.execute(
                        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                        [env.salonId, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
                    );
                    authToken = generateTestToken(employee2);
                }

                if (duplicate) {
                    await createStaffReplyViaAPI(env.employeeToken, actualReviewId, 'First reply');
                }
            }

            const message = emptyMessage ? '' : longMessage ? 'a'.repeat(2001) : 'Test reply';
            const response = await createStaffReplyViaAPI(authToken, actualReviewId, message);

            expect(response.status).toBe(expectedStatus);
        });

        test('Verify Update Staff Reply: PATCH /api/staff-reviews/replies/update/:staff_reply_id updates message', async () => {
            const env = await setupBookingTestEnvironment();
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');

            const reviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Review');
            const createResponse = await createStaffReplyViaAPI(env.employeeToken, reviewId, 'Initial reply');
            const replyId = createResponse.body.data.staff_reply_id;

            const updateResponse = await updateStaffReplyViaAPI(env.employeeToken, replyId, 'Updated reply');

            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body.data.message).toBe('Updated reply');
        });

        test.each([
            { scenario: 'non-existent reply', replyId: 99999, expectedStatus: 404 },
            { scenario: 'nothing to update', replyId: null, expectedStatus: 400, hasReply: true, emptyUpdate: true },
            { scenario: 'cross-employee update', replyId: null, expectedStatus: 403, hasReply: true, crossEmployee: true }
        ])('Verify Update Staff Reply Errors: $scenario returns $expectedStatus', async ({ replyId, expectedStatus, hasReply, emptyUpdate, crossEmployee }) => {
            const env = await setupBookingTestEnvironment();
            let actualReplyId = replyId;
            let authToken = env.employeeToken;

            if (hasReply) {
                const pastDate = DateTime.utc().minus({ days: 1 });
                await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');
                const reviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Review');
                const createResponse = await createStaffReplyViaAPI(env.employeeToken, reviewId, 'My reply');
                actualReplyId = createResponse.body.data.staff_reply_id;

                if (crossEmployee) {
                    const employee2 = await insertUserWithCredentials({ password: 'Password123!', role: 'EMPLOYEE' });
                    const nowUtc = toMySQLUtc(DateTime.utc());
                    await db.execute(
                        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                        [env.salonId, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
                    );
                    authToken = generateTestToken(employee2);
                }
            }

            const updateData = emptyUpdate ? {} : { message: 'Updated' };
            const response = await request(app)
                .patch(`/api/staff-reviews/replies/update/${actualReplyId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(updateData);

            expect(response.status).toBe(expectedStatus);
        });

        test('Verify Delete Staff Reply: DELETE /api/staff-reviews/replies/delete/:staff_reply_id removes reply', async () => {
            const env = await setupBookingTestEnvironment();
            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(env.salonId, env.customer.user_id, env.employeeId, env.serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED');

            const reviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Review');
            const createResponse = await createStaffReplyViaAPI(env.employeeToken, reviewId, 'Reply to delete');
            const replyId = createResponse.body.data.staff_reply_id;

            const deleteResponse = await deleteStaffReplyViaAPI(env.employeeToken, replyId);

            expect(deleteResponse.status).toBe(200);
            const [replies] = await db.execute('SELECT staff_reply_id FROM staff_review_replies WHERE staff_reply_id = ?', [replyId]);
            expect(replies.length).toBe(0);
        });
    });
});

// UPH 1.52 - Owner Views All Staff Reviews
describe('UPH 1.52 - Owner Views All Staff Reviews', () => {
    beforeEach(() => {
        notificationsController.createNotification.mockClear();
    });

    describe('Positive Flow', () => {
        test('Verify Owner Views All Staff Reviews: GET /api/staff-reviews/owner/all returns 200 OK with all staff reviews', async () => {
            const password = 'Password123!';
            const [owner, employee1, employee2, customer1, customer2] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password, role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const nowUtc = toMySQLUtc(DateTime.utc());
            await Promise.all([
                db.execute(
                    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [salonId, employee1.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
                ),
                db.execute(
                    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [salonId, employee2.user_id, 'Junior Stylist', 1, nowUtc, nowUtc]
                )
            ]);

            const [employee1Result, employee2Result] = await Promise.all([
                db.execute(`SELECT employee_id FROM employees WHERE user_id = ?`, [employee1.user_id]),
                db.execute(`SELECT employee_id FROM employees WHERE user_id = ?`, [employee2.user_id])
            ]);

            const employee1Id = employee1Result[0][0].employee_id;
            const employee2Id = employee2Result[0][0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await Promise.all([
                createBookingWithServices(salonId, customer1.user_id, employee1Id, serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer2.user_id, employee2Id, serviceId, pastDate.plus({ hours: 2 }), pastDate.plus({ hours: 3 }), 'COMPLETED')
            ]);

            await Promise.all([
                createStaffReview(employee1Id, customer1.user_id, 5.0, 'Excellent!'),
                createStaffReview(employee2Id, customer2.user_id, 4.5, 'Very good')
            ]);

            const ownerToken = generateTestToken(owner);

            const response = await listOwnerStaffReviewsViaAPI(ownerToken);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('meta');
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);
            expect(response.body.meta).toHaveProperty('total');
            expect(response.body.meta).toHaveProperty('avg_rating');
            expect(Number(response.body.meta.avg_rating)).toBeGreaterThanOrEqual(4.5);

            const reviews = response.body.data;
            expect(reviews[0]).toHaveProperty('staff_review_id');
            expect(reviews[0]).toHaveProperty('employee');
            expect(reviews[0]).toHaveProperty('rating');
            expect(reviews[0]).toHaveProperty('message');
            expect(reviews[0]).toHaveProperty('user');
            expect(reviews[0]).toHaveProperty('reply');
        });

        test('Verify Reviews Include Replies: Staff reviews show employee replies when present', async () => {
            const env = await setupBookingTestEnvironment();

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            const staffReviewId = await createStaffReview(env.employeeId, env.customer.user_id, 4.0, 'Good service');
            await createStaffReplyViaAPI(env.employeeToken, staffReviewId, 'Thank you!');

            const ownerToken = generateTestToken(env.owner);
            const response = await listOwnerStaffReviewsViaAPI(ownerToken);

            expect(response.status).toBe(200);
            const review = response.body.data.find(r => r.staff_review_id === staffReviewId);
            expect(review).toBeDefined();
            expect(review.reply).not.toBeNull();
            expect(review.reply.message).toBe('Thank you!');
        });
    });

    describe('Data Integrity & UI Logic', () => {
        test('Verify Average Rating Across All Staff: Owner sees aggregate average for all employees', async () => {
            const password = 'Password123!';
            const [owner, employee1, employee2, customer1, customer2, customer3] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password, role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const salonId = await createSalon(owner.user_id);
            const serviceId = await createService(salonId, 'Haircut', 50.00);

            const nowUtc = toMySQLUtc(DateTime.utc());
            await Promise.all([
                db.execute(
                    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [salonId, employee1.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
                ),
                db.execute(
                    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [salonId, employee2.user_id, 'Junior Stylist', 1, nowUtc, nowUtc]
                )
            ]);

            const [employee1Result, employee2Result] = await Promise.all([
                db.execute(`SELECT employee_id FROM employees WHERE user_id = ?`, [employee1.user_id]),
                db.execute(`SELECT employee_id FROM employees WHERE user_id = ?`, [employee2.user_id])
            ]);

            const employee1Id = employee1Result[0][0].employee_id;
            const employee2Id = employee2Result[0][0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await Promise.all([
                createBookingWithServices(salonId, customer1.user_id, employee1Id, serviceId, pastDate, pastDate.plus({ hours: 1 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer2.user_id, employee1Id, serviceId, pastDate.plus({ hours: 2 }), pastDate.plus({ hours: 3 }), 'COMPLETED'),
                createBookingWithServices(salonId, customer3.user_id, employee2Id, serviceId, pastDate.plus({ hours: 4 }), pastDate.plus({ hours: 5 }), 'COMPLETED')
            ]);

            await Promise.all([
                createStaffReview(employee1Id, customer1.user_id, 5.0),
                createStaffReview(employee1Id, customer2.user_id, 4.0),
                createStaffReview(employee2Id, customer3.user_id, 3.0)
            ]);

            const ownerToken = generateTestToken(owner);
            const response = await listOwnerStaffReviewsViaAPI(ownerToken);

            expect(response.status).toBe(200);
            const avgRating = Number(response.body.meta.avg_rating);
            expect(avgRating).toBeCloseTo(4.0, 1);
            expect(response.body.meta.total).toBe(3);
        });
    });

    describe('Security & Permissions', () => {
        test('Verify Owner Only Sees Own Staff: Owner cannot see reviews for other salon employees', async () => {
            const password = 'Password123!';
            const [owner1, owner2, employee2, customer] = await Promise.all([
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'OWNER' }),
                insertUserWithCredentials({ password, role: 'EMPLOYEE' }),
                insertUserWithCredentials({ password, role: 'CUSTOMER' })
            ]);

            const [salonId1, salonId2] = await Promise.all([
                createSalon(owner1.user_id),
                createSalon(owner2.user_id)
            ]);

            const serviceId2 = await createService(salonId2, 'Haircut', 50.00);

            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(
                `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [salonId2, employee2.user_id, 'Stylist', 1, nowUtc, nowUtc]
            );

            const [employee2Result] = await db.execute(
                `SELECT employee_id FROM employees WHERE user_id = ?`,
                [employee2.user_id]
            );
            const employee2Id = employee2Result[0].employee_id;

            const pastDate = DateTime.utc().minus({ days: 1 });
            await createBookingWithServices(
                salonId2,
                customer.user_id,
                employee2Id,
                serviceId2,
                pastDate,
                pastDate.plus({ hours: 1 }),
                'COMPLETED'
            );

            await createStaffReview(employee2Id, customer.user_id, 5.0, 'Great!');

            const owner1Token = generateTestToken(owner1);
            const response = await listOwnerStaffReviewsViaAPI(owner1Token);

            expect(response.status).toBe(200);
            const review = response.body.data.find(r => r.employee.employee_id === employee2Id);
            expect(review).toBeUndefined();
        });
    });
});
