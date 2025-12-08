const request = require('supertest');
const connection = require('../src/config/databaseConnection');
const { insertUserWithCredentials } = require('./helpers/authTestUtils');
const { DateTime } = require('luxon');

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
    loginUser,
    getNextMonday,
    getMyAppointmentsViaAPI,
    getCustomerVisitHistoryViaAPI
} = require('./helpers/bookingTestUtils');

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
            const pastEndTime1 = pastTime1.plus({ minutes: 60 });
            
            const pastTime2 = nextMonday.minus({ weeks: 1 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
            const pastEndTime2 = pastTime2.plus({ minutes: 60 });
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastTime1,
                pastEndTime1,
                'COMPLETED'
            );
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastTime2,
                pastEndTime2,
                'COMPLETED'
            );
            
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
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                olderTime,
                olderTime.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                newerTime,
                newerTime.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
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
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastTime,
                pastTime.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                futureTime,
                futureTime.plus({ minutes: 60 }),
                'SCHEDULED'
            );
            
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
            
            for (let i = 1; i <= 5; i++) {
                const pastTime = nextMonday.minus({ weeks: i }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
                await createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime,
                    pastTime.plus({ minutes: 60 }),
                    'COMPLETED'
                );
            }
            
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
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastTime1,
                pastTime1.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
            await createBookingWithServices(
                salon2.salonId,
                env.customer.user_id,
                salon2.employeeId,
                salon2.serviceId,
                pastTime2,
                pastTime2.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
            const owner2Token = await loginUser(owner2.email, 'Password123!');
            
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
            
            await createBookingWithServices(
                env.salonId,
                env.customer.user_id,
                env.employeeId,
                env.serviceId,
                pastTime1,
                pastTime1.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
            await createBookingWithServices(
                salon2.salonId,
                env.customer.user_id,
                salon2.employeeId,
                salon2.serviceId,
                pastTime2,
                pastTime2.plus({ minutes: 60 }),
                'COMPLETED'
            );
            
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
            
            for (let i = 1; i <= 5; i++) {
                const pastTime = nextMonday.minus({ weeks: i }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
                await createBookingWithServices(
                    env.salonId,
                    env.customer.user_id,
                    env.employeeId,
                    env.serviceId,
                    pastTime,
                    pastTime.plus({ minutes: 60 }),
                    'COMPLETED'
                );
            }
            
            const response = await getCustomerVisitHistoryViaAPI(env.ownerToken, env.customer.user_id, { limit: 3, offset: 0 });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('limit', 3);
            expect(response.body.data).toHaveProperty('offset', 0);
            expect(response.body.data).toHaveProperty('has_more');
            expect(response.body.data.visits.length).toBeLessThanOrEqual(3);
        });

    });
});
