const request = require('supertest');
const app = require('../../src/app');
const connection = require('../../src/config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../../src/utils/utilies');
const { insertUserWithCredentials, generateTestToken } = require('./authTestUtils');

const db = connection.promise();

const DEFAULT_PASSWORD = 'Password123!';
const DEFAULT_TIMEZONE = 'America/New_York';

const setupBookingTestEnvironment = async (options = {}) => {
    const password = options.password || DEFAULT_PASSWORD;
    const nowUtc = toMySQLUtc(DateTime.utc());

    const owner = await insertUserWithCredentials({
        password,
        role: 'OWNER',
        ...options.ownerOverrides
    });

    const employee = await insertUserWithCredentials({
        password,
        role: 'EMPLOYEE',
        ...options.employeeOverrides
    });

    const customer = await insertUserWithCredentials({
        password,
        role: 'CUSTOMER',
        ...options.customerOverrides
    });

    const [salonResult] = await db.execute(
        `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
         address, city, state, postal_code, country, status, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            owner.user_id,
            options.salonName || 'Test Salon',
            options.salonDescription || 'Test salon description',
            options.category || 'HAIR SALON',
            options.phone || '555-0100',
            options.email || 'test-salon@test.com',
            options.address || '123 Main St',
            options.city || 'Test City',
            options.state || 'TS',
            options.postal_code || '12345',
            options.country || 'USA',
            options.status || 'APPROVED',
            options.timezone || 'UTC',
            nowUtc,
            nowUtc
        ]
    );
    const salonId = salonResult.insertId;

    await db.execute(
        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, employee.user_id, options.employeeTitle || 'Senior Stylist', 1, nowUtc, nowUtc]
    );

    const [employeeResult] = await db.execute(
        `SELECT employee_id FROM employees WHERE user_id = ?`,
        [employee.user_id]
    );
    const employeeId = employeeResult[0].employee_id;

    const weekday = options.weekday !== undefined ? options.weekday : 1;
    await db.execute(
        `INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, weekday, options.salonStartTime || '09:00:00', options.salonEndTime || '17:00:00', nowUtc, nowUtc]
    );

    await db.execute(
        `INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, weekday, options.employeeStartTime || '09:00:00', options.employeeEndTime || '17:00:00', options.slotInterval || 30, nowUtc, nowUtc]
    );

    const servicePayload = {
        name: options.serviceName || 'Haircut',
        description: options.serviceDescription || 'Basic haircut',
        duration_minutes: options.durationMinutes || 60,
        price: options.servicePrice || 50
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

    // Generate tokens directly - bypasses HTTP login, DB lookup, and bcrypt
    const ownerToken = generateTestToken(owner);
    const employeeToken = generateTestToken(employee);
    const customerToken = generateTestToken(customer);

    return {
        owner,
        employee,
        customer,
        salonId,
        employeeId,
        serviceId,
        ownerToken,
        employeeToken,
        customerToken,
        password,
        nowUtc
    };
};

const loginUser = async (email, password) => {
    const [rows] = await db.execute('SELECT user_id, role, email FROM users WHERE email = ?', [email]);
    
    if (rows.length === 0) {
        throw new Error(`User not found for test login: ${email}`);
    }
    
    const user = rows[0];
    return generateTestToken(user);
};

const createBooking = async (salonId, customerUserId, scheduledStart, scheduledEnd, status = 'SCHEDULED', options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            salonId,
            customerUserId,
            toMySQLUtc(scheduledStart),
            toMySQLUtc(scheduledEnd),
            status,
            options.notes || null,
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const createBookingWithServices = async (salonId, customerUserId, employeeId, serviceId, scheduledStart, scheduledEnd, status = 'SCHEDULED', options = {}) => {
    const bookingId = await createBooking(salonId, customerUserId, scheduledStart, scheduledEnd, status, options);
    
    const nowUtc = toMySQLUtc(DateTime.utc());
    const servicePrice = options.servicePrice || 50;
    const durationMinutes = options.durationMinutes || 60;
    
    await db.execute(
        `INSERT INTO booking_services (booking_id, employee_id, service_id, price, duration_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, employeeId, serviceId, servicePrice, durationMinutes, nowUtc, nowUtc]
    );
    
    return bookingId;
};

// Salon Setup Helpers
const setupSecondSalon = async (ownerUserId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    
    const [salonResult] = await db.execute(
        `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
         address, city, state, postal_code, country, status, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            ownerUserId,
            options.name || 'Salon Y',
            options.description || 'Test salon Y',
            options.category || 'HAIR SALON',
            options.phone || '555-0101',
            options.email || 'salon-y@test.com',
            options.address || '456 Oak St',
            options.city || 'Test City',
            options.state || 'TS',
            options.postal_code || '12345',
            options.country || 'USA',
            options.status || 'APPROVED',
            options.timezone || 'UTC',
            nowUtc,
            nowUtc
        ]
    );
    const salonId = salonResult.insertId;
    
    const employee = await insertUserWithCredentials({
        password: options.password || DEFAULT_PASSWORD,
        role: 'EMPLOYEE',
        ...options.employeeOverrides
    });
    
    await db.execute(
        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, employee.user_id, options.employeeTitle || 'Stylist', 1, nowUtc, nowUtc]
    );
    
    const [employeeResult] = await db.execute(
        'SELECT employee_id FROM employees WHERE user_id = ?',
        [employee.user_id]
    );
    const employeeId = employeeResult[0].employee_id;
    
    const weekday = options.weekday !== undefined ? options.weekday : 1;
    await db.execute(
        `INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, weekday, options.salonStartTime || '09:00:00', options.salonEndTime || '17:00:00', nowUtc, nowUtc]
    );
    
    await db.execute(
        `INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, weekday, options.employeeStartTime || '09:00:00', options.employeeEndTime || '17:00:00', options.slotInterval || 30, nowUtc, nowUtc]
    );
    
    const [serviceResult] = await db.execute(
        `INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [salonId, options.serviceName || 'Haircut', options.serviceDescription || 'Basic haircut', options.durationMinutes || 60, options.servicePrice || 50, 1, nowUtc, nowUtc]
    );
    const serviceId = serviceResult.insertId;
    
    await db.execute(
        `INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [employeeId, serviceId, nowUtc, nowUtc]
    );
    
    return {
        salonId,
        employeeId,
        serviceId,
        employee
    };
};

// API Request Helpers
const rescheduleBookingViaAPI = async (token, bookingId, scheduledStart, notes = '') => {
    return await request(app)
        .post('/api/bookings/reschedule')
        .set('Authorization', `Bearer ${token}`)
        .send({
            booking_id: bookingId,
            scheduled_start: scheduledStart,
            notes: notes
        });
};

const cancelBookingViaAPI = async (token, bookingId) => {
    return await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${token}`)
        .send({ booking_id: bookingId });
};

const cancelBookingAsStylistViaAPI = async (token, bookingId) => {
    return await request(app)
        .post('/api/bookings/stylist/cancel')
        .set('Authorization', `Bearer ${token}`)
        .send({ booking_id: bookingId });
};

const getMyAppointmentsViaAPI = async (token, queryParams = {}) => {
    return await request(app)
        .get('/api/bookings/myAppointments')
        .set('Authorization', `Bearer ${token}`)
        .query(queryParams);
};

const getStylistWeeklyScheduleViaAPI = async (token, startDate, endDate) => {
    return await request(app)
        .get('/api/user/stylist/weeklySchedule')
        .set('Authorization', `Bearer ${token}`)
        .query({ start_date: startDate, end_date: endDate });
};

const getBookingById = async (bookingId) => {
    const [rows] = await db.execute(
        `SELECT booking_id, salon_id, customer_user_id, 
         DATE_FORMAT(scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
         DATE_FORMAT(scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
         status, notes
         FROM bookings WHERE booking_id = ?`,
        [bookingId]
    );
    return rows[0] || null;
};

const getBookingServices = async (bookingId) => {
    const [rows] = await db.execute(
        `SELECT booking_service_id, booking_id, employee_id, service_id, price, duration_minutes
         FROM booking_services WHERE booking_id = ?`,
        [bookingId]
    );
    return rows;
};

const getBookingsByCustomer = async (customerUserId, status = null) => {
    let query = `SELECT booking_id, salon_id, customer_user_id, 
                 DATE_FORMAT(scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
                 DATE_FORMAT(scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
                 status
                 FROM bookings WHERE customer_user_id = ?`;
    const params = [customerUserId];
    
    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }
    
    query += ' ORDER BY scheduled_start DESC';
    
    const [rows] = await db.execute(query, params);
    return rows;
};

const getConflictingBookings = async (employeeId, startTime, endTime, excludeBookingId = null) => {
    let query = `SELECT b.booking_id FROM bookings b 
                 JOIN booking_services bs ON b.booking_id = bs.booking_id
                 WHERE bs.employee_id = ? 
                 AND b.status NOT IN ('CANCELED', 'COMPLETED')
                 AND b.scheduled_start < ? 
                 AND b.scheduled_end > ?`;
    const params = [employeeId, toMySQLUtc(endTime), toMySQLUtc(startTime)];
    
    if (excludeBookingId) {
        query += ' AND b.booking_id <> ?';
        params.push(excludeBookingId);
    }
    
    const [rows] = await db.execute(query, params);
    return rows;
};

const getFutureDate = (daysFromNow = 7, hour = 10, minute = 0) => {
    return DateTime.utc().plus({ days: daysFromNow }).set({ hour, minute, second: 0, millisecond: 0 });
};

const getFutureDateWithTimezone = (daysFromNow = 7, hour = 10, minute = 0, timezone = DEFAULT_TIMEZONE) => {
    return DateTime.now().setZone(timezone).plus({ days: daysFromNow }).set({ hour, minute, second: 0, millisecond: 0 });
};

const getSameDayFutureTime = (hoursFromNow = 2) => {
    return DateTime.utc().plus({ hours: hoursFromNow });
};

const getNextMonday = (dateTime) => {
    let nextMonday = dateTime.plus({ days: 1 });
    while (nextMonday.weekday !== 1) {
        nextMonday = nextMonday.plus({ days: 1 });
    }
    return nextMonday;
};

const verifyBookingStatus = async (bookingId, expectedStatus) => {
    const booking = await getBookingById(bookingId);
    return booking && booking.status === expectedStatus;
};

const verifyBookingTime = async (bookingId, expectedStart, expectedEnd) => {
    const booking = await getBookingById(bookingId);
    if (!booking) return false;
    
    const bookingStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
    const bookingEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
    const expectedStartUtc = expectedStart.toUTC();
    const expectedEndUtc = expectedEnd.toUTC();
    
    return bookingStart.equals(expectedStartUtc) && bookingEnd.equals(expectedEndUtc);
};

const createPayment = async (bookingId, amount, status = 'SUCCEEDED', options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO payments (booking_id, amount, status, reward_id, user_promo_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            bookingId,
            amount,
            status,
            options.reward_id || null,
            options.user_promo_id || null,
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const getPaymentByBookingId = async (bookingId, status = null) => {
    let query = `SELECT payment_id, booking_id, amount, status, reward_id, user_promo_id
         FROM payments 
         WHERE booking_id = ?`;
    const params = [bookingId];
    
    if (status) {
        query += ' AND status = ?';
        params.push(status);
    } else {
        query += ` AND status IN ('SUCCEEDED', 'REFUNDED')`;
    }
    
    query += ' ORDER BY created_at DESC LIMIT 1';
    
    const [rows] = await db.execute(query, params);
    return rows[0] || null;
};

const updateBookingStatus = async (bookingId, status) => {
    await db.execute(
        `UPDATE bookings SET status = ? WHERE booking_id = ?`,
        [status, bookingId]
    );
};

const createSalon = async (ownerUserId, options = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const [result] = await db.execute(
        `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
         address, city, state, postal_code, country, status, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            options.status || 'APPROVED',
            options.timezone || 'UTC',
            nowUtc,
            nowUtc
        ]
    );
    return result.insertId;
};

const deletePendingBookingViaAPI = async (token, bookingId) => {
    return await request(app)
        .delete(`/api/bookings/${bookingId}/deletePendingBooking`)
        .set('Authorization', `Bearer ${token}`);
};

const listVisitCustomersViaAPI = async (token, queryParams = {}) => {
    return await request(app)
        .get('/api/bookings/visits/customers')
        .set('Authorization', `Bearer ${token}`)
        .query(queryParams);
};

const getCustomerVisitHistoryViaAPI = async (token, customerUserId, queryParams = {}) => {
    return await request(app)
        .get(`/api/bookings/visits/customers/${customerUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .query(queryParams);
};

const createUnavailabilityBlockViaAPI = async (token, weekday, startTime, endTime, slotIntervalMinutes = 30) => {
    return await request(app)
        .post('/api/unavailability')
        .set('Authorization', `Bearer ${token}`)
        .send({
            weekday,
            start_time: startTime,
            end_time: endTime,
            slot_interval_minutes: slotIntervalMinutes
        });
};

const listUnavailabilityBlocksViaAPI = async (token, weekday = null) => {
    const query = weekday !== null ? `?weekday=${weekday}` : '';
    return await request(app)
        .get(`/api/unavailability${query}`)
        .set('Authorization', `Bearer ${token}`);
};

const deleteUnavailabilityBlockViaAPI = async (token, weekday, startTime, endTime) => {
    return await request(app)
        .delete('/api/unavailability')
        .set('Authorization', `Bearer ${token}`)
        .send({
            weekday,
            start_time: startTime,
            end_time: endTime
        });
};

const getUnavailabilityBlockById = async (blockId) => {
    const [rows] = await db.execute(
        'SELECT * FROM employee_unavailability WHERE unavailability_id = ?',
        [blockId]
    );
    return rows[0] || null;
};

const getTimeslotsForDate = async (customerToken, salonId, employeeId, dateStr) => {
    const response = await request(app)
        .get(`/api/salons/${salonId}/stylists/${employeeId}/timeslots?start_date=${dateStr}&end_date=${dateStr}`)
        .set('Authorization', `Bearer ${customerToken}`);
    
    if (response.status !== 200) {
        throw new Error(`Failed to get timeslots: ${response.status}`);
    }
    
    return response.body.data.daily_slots[dateStr] || [];
};

const verifyBlockedSlotsMissing = async (customerToken, salonId, employeeId, dateStr, blockedHour, blockedMinute = 0) => {
    const slots = await getTimeslotsForDate(customerToken, salonId, employeeId, dateStr);
    
    if (Array.isArray(slots)) {
        const blockedSlots = slots.filter(slot => {
            const slotTime = DateTime.fromISO(slot.start_time);
            return slotTime.hour === blockedHour && slotTime.minute === blockedMinute;
        });
        return blockedSlots.length === 0;
    }
    return true; 
};

const getNextMondayDateString = (dateTime = null) => {
    const dt = dateTime || DateTime.utc();
    const nextMonday = getNextMonday(dt);
    return nextMonday.toISODate();
};

module.exports = {
    DEFAULT_PASSWORD,
    DEFAULT_TIMEZONE,
    
    setupBookingTestEnvironment,
    setupSecondSalon,
    loginUser,
    
    createBooking,
    createBookingWithServices,
    
    rescheduleBookingViaAPI,
    cancelBookingViaAPI,
    cancelBookingAsStylistViaAPI,
    getMyAppointmentsViaAPI,
    getStylistWeeklyScheduleViaAPI,
    deletePendingBookingViaAPI,
    listVisitCustomersViaAPI,
    getCustomerVisitHistoryViaAPI,
    
    createUnavailabilityBlockViaAPI,
    listUnavailabilityBlocksViaAPI,
    deleteUnavailabilityBlockViaAPI,
    getUnavailabilityBlockById,
    
    getBookingById,
    getBookingServices,
    getBookingsByCustomer,
    getConflictingBookings,
    
    createPayment,
    getPaymentByBookingId,
    
    updateBookingStatus,
    
    createSalon,
    
    getFutureDate,
    getFutureDateWithTimezone,
    getSameDayFutureTime,
    getNextMonday,
    getNextMondayDateString,
    
    getTimeslotsForDate,
    verifyBlockedSlotsMissing,
    
    verifyBookingStatus,
    verifyBookingTime
};
