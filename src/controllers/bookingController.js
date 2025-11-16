const connection = require('../config/databaseConnection'); //db connection
const { toMySQLUtc, formatDateTime, logUtcDebug, localAvailabilityToUtc, utcToLocalDateString, luxonWeekdayToDb } = require('../utils/utilies');
const { DateTime } = require('luxon');

// Customer views their appointments
exports.getMyAppointments = async (req, res) => {
    const db = connection.promise();

    try {
        const customer_user_id = req.user?.user_id;

        if (!customer_user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const [bookings] = await db.execute(
            `SELECT 
                b.booking_id,
                b.salon_id,
                b.scheduled_start,
                b.scheduled_end,
                b.status,
                b.notes,
                b.created_at,
                s.name AS salon_name,
                s.address AS salon_address,
                s.city AS salon_city,
                s.state AS salon_state,
                s.phone AS salon_phone,
                s.email AS salon_email
             FROM bookings b
             JOIN salons s ON b.salon_id = s.salon_id
             WHERE b.customer_user_id = ?
             ORDER BY b.scheduled_start DESC`,
            [customer_user_id]
        );

        if (bookings.length === 0) {
            return res.status(200).json({
                message: 'No appointments found',
                data: []
            });
        }

        // Extract booking IDs for bulk queries
        const bookingIds = bookings.map(b => b.booking_id);
        const placeholders = bookingIds.map(() => '?').join(',');

        // Bulk query: Get all services for all bookings
        const [allServices] = await db.execute(
            `SELECT 
                bs.booking_id,
                bs.service_id,
                bs.employee_id,
                bs.price,
                bs.duration_minutes,
                sv.name AS service_name,
                u.full_name AS stylist_name,
                e.title AS stylist_title
             FROM booking_services bs
             JOIN services sv ON bs.service_id = sv.service_id
             LEFT JOIN employees e ON bs.employee_id = e.employee_id
             LEFT JOIN users u ON e.user_id = u.user_id
             WHERE bs.booking_id IN (${placeholders})`,
            bookingIds
        );

        // Bulk query
        const [allPayments] = await db.execute(
            `SELECT p.booking_id, p.amount, p.reward_id, p.status
             FROM payments p
             WHERE p.booking_id IN (${placeholders})
             AND p.status = 'SUCCEEDED'
             AND p.created_at = (
                 SELECT MAX(created_at) 
                 FROM payments p2 
                 WHERE p2.booking_id = p.booking_id 
                 AND p2.status = 'SUCCEEDED'
             )`,
            bookingIds
        );

        // Extract reward IDs and bulk query rewards
        const rewardIds = allPayments.filter(p => p.reward_id).map(p => p.reward_id);
        let allRewards = [];
        if (rewardIds.length > 0) {
            const rewardPlaceholders = rewardIds.map(() => '?').join(',');
            [allRewards] = await db.execute(
                `SELECT reward_id, discount_percentage, note, creationDate, redeemed_at
                 FROM available_rewards
                 WHERE reward_id IN (${rewardPlaceholders})`,
                rewardIds
            );
        }

        // Group results
        const servicesByBooking = {};
        allServices.forEach(s => {
            if (!servicesByBooking[s.booking_id]) {
                servicesByBooking[s.booking_id] = [];
            }
            servicesByBooking[s.booking_id].push(s);
        });

        const paymentsByBooking = {};
        allPayments.forEach(p => {
            paymentsByBooking[p.booking_id] = p;
        });

        const rewardsById = {};
        allRewards.forEach(r => {
            rewardsById[r.reward_id] = r;
        });

        // Map results back to bookings
        const appointmentData = bookings.map(booking => {
            const services = servicesByBooking[booking.booking_id] || [];
            const payment = paymentsByBooking[booking.booking_id];

            let actualAmountPaid = null;
            let rewardInfo = null;

            if (payment) {
                actualAmountPaid = Number(payment.amount);
                
                if (payment.reward_id && rewardsById[payment.reward_id]) {
                    const reward = rewardsById[payment.reward_id];
                    rewardInfo = {
                        reward_id: reward.reward_id,
                        discount_percentage: Number(reward.discount_percentage),
                        note: reward.note,
                        creationDate: formatDateTime(reward.creationDate),
                        redeemed_at: formatDateTime(reward.redeemed_at)
                    };
                }
            }

            const totalPrice = services.reduce((sum, s) => sum + Number(s.price), 0);
            const totalDuration = services.reduce((sum, s) => sum + Number(s.duration_minutes), 0);

            // Unique stylists
            const stylists = services
                .filter(s => s.employee_id)
                .reduce((unique, s) => {
                    if (!unique.find(u => u.employee_id === s.employee_id)) {
                        unique.push({
                            employee_id: s.employee_id,
                            name: s.stylist_name,
                            title: s.stylist_title
                        });
                    }
                    return unique;
                }, []);

            logUtcDebug('bookingController.getMyAppointments raw scheduled_start', booking.scheduled_start);
            logUtcDebug('bookingController.getMyAppointments raw scheduled_end', booking.scheduled_end);
            return {
                booking_id: booking.booking_id,
                salon: {
                    salon_id: booking.salon_id,
                    name: booking.salon_name,
                    address: booking.salon_address,
                    city: booking.salon_city,
                    state: booking.salon_state,
                    phone: booking.salon_phone,
                    email: booking.salon_email
                },
                appointment: {
                    scheduled_start: formatDateTime(booking.scheduled_start),
                    scheduled_end: formatDateTime(booking.scheduled_end),
                    duration_minutes: totalDuration,
                    status: booking.status
                },
                stylists: stylists.length > 0 ? stylists : null,
                services: services.map(s => ({
                    service_id: s.service_id,
                    service_name: s.service_name,
                    duration_minutes: Number(s.duration_minutes),
                    price: Number(s.price)
                })),
                total_price: totalPrice,
                actual_amount_paid: actualAmountPaid,
                reward: rewardInfo,
                notes: booking.notes
            };
        });

        return res.status(200).json({
            message: 'Appointments retrieved successfully',
            data: appointmentData
        });

    } catch (error) {
        console.error('getMyAppointments error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.2 customer reschedules booking/appointment
exports.rescheduleBooking = async (req, res) => {
    const db = connection.promise();

    try {
        //get authenticated user and booking information
        const authUserId = req.user?.user_id;
        const { booking_id, scheduled_start, notes = '' } = req.body;

        //validation
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });
        if (!booking_id || isNaN(booking_id)) return res.status(400).json({ message: 'Invalid booking_id' });
        if (!scheduled_start) return res.status(400).json({ message: 'scheduled_start is required' });

        let startDate;
        if (typeof scheduled_start === 'string') {
            const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(scheduled_start);
            if (!hasTimezone) {
                return res.status(400).json({
                    message: 'scheduled_start must include a timezone offset (e.g., 2025-11-12T09:00:00-05:00 or 2025-11-12T14:00:00Z)'
                });
            }
            startDate = DateTime.fromISO(scheduled_start);
        } else {
            return res.status(400).json({
                message: 'scheduled_start must be a string in ISO 8601 format with timezone'
            });
        }

        if (!startDate.isValid) {
            return res.status(400).json({
                message: `Invalid scheduled_start: ${startDate.invalidReason || 'Invalid format'}. Provide a valid ISO 8601 datetime with timezone.`
            });
        }

        // Convert to UTC for consistent processing
        startDate = startDate.toUTC();

        const now = DateTime.utc();
        if (startDate < now) return res.status(400).json({ message: 'Cannot reschedule to a past time' });

        //get the current booking (must be SCHEDULED)
        // Use DATE_FORMAT to return SQL format (YYYY-MM-DD HH:mm:ss) for Luxon parsing
        const [bkRows] = await db.execute(`SELECT booking_id, salon_id, customer_user_id, 
                                      DATE_FORMAT(scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start, 
                                      DATE_FORMAT(scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end, 
                                      status
                                      FROM bookings WHERE booking_id = ? AND customer_user_id = ? AND status = 'SCHEDULED'`,
            [Number(booking_id), authUserId]
        );
        if (bkRows.length === 0) return res.status(404).json({ message: 'Booking not found or not reschedulable (must be SCHEDULED)' });

        //store info of current booking (now old)
        const oldBooking = bkRows[0];
        const salon_id = oldBooking.salon_id;

        // Check if booking is scheduled for the same day - cannot reschedule same day
        const [salonTimezoneResult] = await db.execute(
            'SELECT timezone FROM salons WHERE salon_id = ?',
            [salon_id]
        );
        const salonTimezone = salonTimezoneResult[0]?.timezone || 'America/New_York';
        
        // Parse SQL format datetime from database as UTC
        const oldBookingDate = DateTime.fromSQL(oldBooking.scheduled_start, { zone: 'utc' });
        if (!oldBookingDate.isValid) {
            return res.status(500).json({ message: 'Invalid booking date format in database' });
        }
        const nowLocalDate = utcToLocalDateString(now, salonTimezone);
        const bookingLocalDate = utcToLocalDateString(oldBookingDate, salonTimezone);
        
        if (nowLocalDate === bookingLocalDate) {
            return res.status(400).json({ 
                message: 'Cannot reschedule a booking on the same day. Please reschedule at least one day in advance.' 
            });
        }

        //get the services associated with this booking
        const [servicesRows] = await db.execute(`SELECT service_id, employee_id, price, duration_minutes FROM booking_services WHERE booking_id = ?`,
            [Number(booking_id)]
        );
        if (servicesRows.length === 0) return res.status(400).json({ message: 'No services found for this booking' });

        //getting service duration and endtime of booking
        const totalDurationMinutes = servicesRows.reduce((sum, s) => sum + s.duration_minutes, 0);
        const endDate = startDate.plus({ minutes: totalDurationMinutes });

        //getting all employees involved with the original booking along with the day
        const employeeIds = [...new Set(servicesRows.map(r => r.employee_id))];
        // Convert Luxon weekday to database weekday (0-6, Sunday=0)
        const bookingDayOfWeek = luxonWeekdayToDb(startDate.weekday);

        // Build UTC YYYY-MM-DD for the booking date
        const dayStr = startDate.toFormat('yyyy-MM-dd');

        // Format as UTC for database storage
        const requestStartStr = toMySQLUtc(startDate);
        const requestEndStr = toMySQLUtc(endDate);

        //checking availability of all employees
        for (const empId of employeeIds) {
            //checking availability
            const [availRows] = await db.execute(`SELECT weekday, start_time, end_time FROM employee_availability WHERE employee_id = ?`,
                [empId]
            );
            if (availRows.length === 0) return res.status(400).json({ message: 'Stylist has no availability set' });

            //checking availability on that weekday
            const dayAvailability = availRows.find(a => a.weekday === bookingDayOfWeek);
            if (!dayAvailability) return res.status(400).json({ message: 'Stylist is not available on this day' });

            const availStart = localAvailabilityToUtc(dayAvailability.start_time, dayStr, salonTimezone);
            const availEnd = localAvailabilityToUtc(dayAvailability.end_time, dayStr, salonTimezone);
            logUtcDebug('bookingController.rescheduleBooking availStart (UTC)', availStart);
            logUtcDebug('bookingController.rescheduleBooking availEnd (UTC)', availEnd);
            if (startDate < availStart || endDate > availEnd) return res.status(400).json({ message: `Booking time must be within stylist availability (${dayAvailability.start_time} - ${dayAvailability.end_time})` });

            //checking unavailability
            const [unavailRows] = await db.execute(`SELECT start_time, end_time FROM employee_unavailability WHERE employee_id = ? AND weekday = ?`,
                [empId, bookingDayOfWeek]
            );
            const hasConflict = unavailRows.some(block => {
                const blockStart = localAvailabilityToUtc(block.start_time, dayStr, salonTimezone);
                const blockEnd = localAvailabilityToUtc(block.end_time, dayStr, salonTimezone);
                return (startDate < blockEnd) && (blockStart < endDate);
            });
            if (hasConflict) return res.status(409).json({ message: 'Stylist is unavailable during this time slot' });
            
            //check for conflicting bookings
            const [conflicts] = await db.execute(`SELECT b.booking_id FROM bookings b JOIN booking_services bs ON b.booking_id = bs.booking_id
                                                 WHERE bs.employee_id = ? AND b.booking_id <> ?  AND b.status NOT IN ('CANCELED', 'COMPLETED')
                                                 AND b.scheduled_start < ? AND b.scheduled_end > ?`,
                [empId, Number(booking_id), requestEndStr, requestStartStr]
            );
            if (conflicts.length > 0) return res.status(409).json({ message: 'Time slot is no longer available. Please select a different time.' });
        }

        //db interactions
        await db.beginTransaction();

        try {
            //cancelling the old booking (must be SCHEDULED)
            const [cancelResult] = await db.execute(`UPDATE bookings SET status = 'CANCELED' WHERE booking_id = ? AND customer_user_id = ? AND status = 'SCHEDULED'`,
                [booking_id, authUserId]
            );

            if (cancelResult.affectedRows === 0) {
                await db.rollback();
                return res.status(404).json({ message: 'Booking not found or cannot be canceled (may already be canceled, completed, or not belong to you)' });
            }

           
            const [newBooking] = await db.execute(`INSERT INTO bookings (salon_id, customer_user_id, scheduled_start, scheduled_end, status, notes)
                                                  VALUES (?, ?, ?, ?, 'SCHEDULED', ?)`, [salon_id, authUserId, requestStartStr, requestEndStr, notes]
            );
            const newBookingId = newBooking.insertId;

            //create new booking_services entry
            for (const s of servicesRows) {
                await db.execute(`INSERT INTO booking_services (booking_id, employee_id, service_id, price, duration_minutes)
                                 VALUES (?, ?, ?, ?, ?)`, [newBookingId, s.employee_id, s.service_id, s.price, s.duration_minutes]
                );
            }

            //update payments to point to the new booking_id
            const nowUtc = toMySQLUtc(DateTime.utc());
            await db.execute(`UPDATE payments SET booking_id = ?, updated_at = ? WHERE booking_id = ?`,
                [newBookingId, nowUtc, Number(booking_id)]
            );

            await db.commit(); //commiting db changes

            return res.status(201).json({
                message: 'Appointment rescheduled successfully (old booking canceled, new booking created)',
                data: {
                    old_booking_id: Number(booking_id),
                    new_booking_id: newBookingId,
                    appointment: {
                        scheduled_start: formatDateTime(startDate),
                        scheduled_end: formatDateTime(endDate),
                        duration_minutes: Math.round(endDate.diff(startDate, 'minutes').minutes),
                        status: 'SCHEDULED'
                    },
                    total_services: servicesRows.length
                }
            });
        } catch (txErr) {
            await db.rollback();
            throw txErr;
        }
    } catch (error) {
        console.error('rescheduleBooking error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.3 customer cancels booking/appointment
exports.cancelBooking = async (req, res) => {
    const db = connection.promise();

    try {
        //get authenticated user and booking ID
        const authUserId = req.user?.user_id;
        const { booking_id } = req.body;

        //validate booking ID and user ID
        const bookingId = parseInt(booking_id, 10);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({ message: 'Invalid booking id' });
        }
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //db interactions
        await db.beginTransaction();

        //finding the booking (appointment) to cancel and locking it (must be SCHEDULED)
        // Use DATE_FORMAT to return SQL format (YYYY-MM-DD HH:mm:ss) for Luxon parsing
        const [rows] = await db.execute(`SELECT booking_id, customer_user_id, 
                                    DATE_FORMAT(scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start, 
                                    status
                                    FROM bookings WHERE booking_id = ? AND customer_user_id = ? AND status = 'SCHEDULED'
                                    FOR UPDATE`, [bookingId, authUserId]
        );

        if (rows.length === 0) {
            await db.rollback();
            return res.status(404).json({ message: 'Booking not found or cannot be canceled (must be SCHEDULED)' });
        }

        const booking = rows[0];
        const previousStatus = booking.status;

        // Check if booking is scheduled for the same day - cannot cancel same day
        const [salonTimezoneResult] = await db.execute(
            'SELECT s.timezone FROM salons s WHERE s.salon_id = (SELECT salon_id FROM bookings WHERE booking_id = ?)',
            [bookingId]
        );
        const salonTimezone = salonTimezoneResult[0]?.timezone || 'America/New_York';
        
        const now = DateTime.utc();
        // Parse SQL format datetime from database as UTC
        const bookingDate = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
        if (!bookingDate.isValid) {
            await db.rollback();
            return res.status(500).json({ message: 'Invalid booking date format in database' });
        }
        const nowLocalDate = utcToLocalDateString(now, salonTimezone);
        const bookingLocalDate = utcToLocalDateString(bookingDate, salonTimezone);
        
        if (nowLocalDate === bookingLocalDate) {
            await db.rollback();
            return res.status(400).json({ 
                message: 'Cannot cancel a booking on the same day. Please cancel at least one day in advance.' 
            });
        }

        //update booking to CANCELED in bookings
        await db.execute(`UPDATE bookings SET status = 'CANCELED' WHERE booking_id = ?`, [bookingId]);

        //mark any related payments as REFUNDED
        const nowUtc = toMySQLUtc(DateTime.utc());
        await db.execute(
            `UPDATE payments 
             SET status = 'REFUNDED', updated_at = ?
             WHERE booking_id = ? AND status <> 'REFUNDED'`,
            [nowUtc, bookingId]
        );

        //commit all db changes only if this point is reached, if a rollback is triggered then all changes do not take affect to keep synergy in db
        await db.commit();

        return res.status(200).json({
            message: 'Booking canceled',
            data: {
                booking_id: booking.booking_id,
                previous_status: previousStatus,
                new_status: 'CANCELED',
                canceled_at: DateTime.utc().toISO()
            }
        });
    } catch (err) {
        try { await connection.promise().rollback(); } catch (_) { }
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.7 stylist cancels booking/appointment
exports.cancelBookingAsStylist = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        const { booking_id } = req.body;

        const bookingId = parseInt(booking_id, 10);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({ message: 'Invalid booking id' });
        }
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        await db.beginTransaction();

        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        );
        if (!empRows.length) {
            await db.rollback();
            return res.status(404).json({ message: 'Employee not found' });
        }

        const employeeId = empRows[0].employee_id;

        const [rows] = await db.execute(`SELECT b.booking_id, b.customer_user_id, b.scheduled_start, b.status
                                    FROM bookings b
                                    JOIN booking_services bs ON b.booking_id = bs.booking_id
                                    WHERE b.booking_id = ? AND bs.employee_id = ? AND b.status = 'SCHEDULED'
                                    FOR UPDATE`, [bookingId, employeeId]
        );

        if (rows.length === 0) {
            await db.rollback();
            return res.status(404).json({ message: 'Booking not found or cannot be canceled (must be SCHEDULED and assigned to you)' });
        }

        const booking = rows[0];
        const previousStatus = booking.status;

        await db.execute(`UPDATE bookings SET status = 'CANCELED' WHERE booking_id = ?`, [bookingId]);

        const nowUtc = toMySQLUtc(DateTime.utc());
        await db.execute(
            `UPDATE payments 
             SET status = 'REFUNDED', updated_at = ?
             WHERE booking_id = ? AND status <> 'REFUNDED'`,
            [nowUtc, bookingId]
        );

        await db.commit();

        return res.status(200).json({
            message: 'Booking canceled by stylist',
            data: {
                booking_id: booking.booking_id,
                previous_status: previousStatus,
                new_status: 'CANCELED',
                canceled_at: DateTime.utc().toISO()
            }
        });
    } catch (err) {
        try { await db.rollback(); } catch (_) { }
        console.error('cancelBookingAsStylist error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Delete a pending booking (when user backs out of transaction)
exports.deletePendingBooking = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        const { booking_id } = req.params;

        if (!authUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const bookingId = parseInt(booking_id, 10);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({ message: 'Invalid booking id' });
        }

        await db.beginTransaction();

        try {
            // Verify booking exists, belongs to user, and is PENDING
            const [rows] = await db.execute(
                `SELECT booking_id, customer_user_id, status
                 FROM bookings 
                 WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'
                 FOR UPDATE`,
                [bookingId, authUserId]
            );

            if (rows.length === 0) {
                await db.rollback();
                return res.status(404).json({ 
                    message: 'Booking not found or cannot be deleted (must be PENDING and belong to you)' 
                });
            }

            const booking = rows[0];

            await db.execute(`DELETE FROM booking_services WHERE booking_id = ?`, [bookingId]);

            await db.execute(`DELETE FROM bookings WHERE booking_id = ?`, [bookingId]);

            await db.commit();

            return res.status(200).json({
                message: 'Pending booking deleted successfully',
                data: {
                    booking_id: booking.booking_id,
                    deleted_at: DateTime.utc().toISO()
                }
            });
        } catch (txErr) {
            await db.rollback();
            throw txErr;
        }
    } catch (err) {
        console.error('deletePendingBooking error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.2/1.21 salon owner/employee seeing customer visits, employees only see their own
exports.listVisitCustomers = async (req, res) => {
    const db = connection.promise();

    try {
        //get authenticated user and their role either OWNER or EMPLOYEE
        const authUserId = req.user?.user_id;
        const role = req.user?.role;

        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //pagination
        let { limit = 20, offset = 0 } = req.query;
        limit  = Number.isFinite(+limit) ? Math.max(1, Math.min(+limit, 100)) : 20;
        offset = Number.isFinite(+offset) ? Math.max(0, +offset) : 0;

        let salonIds = [];
        let employee_id = null;

        if (role === 'OWNER') { //OWNER view
            const [salonRows] = await db.execute(`SELECT salon_id FROM salons WHERE owner_user_id = ?`, [authUserId]);
            if (salonRows.length === 0) return res.status(404).json({ message: 'Salon not found for this owner' });
            salonIds = salonRows.map(s => s.salon_id);
        } else { //EMPLOYEE view
            const [empRows] = await db.execute(`SELECT employee_id, salon_id FROM employees WHERE user_id = ? AND active = 1`, [authUserId]);
            if (empRows.length === 0) return res.status(404).json({ message: 'Employee profile not found' });
            employee_id = empRows[0].employee_id;
        }

        const makeIn = (arr) => arr.map(() => '?').join(',');
        //only counting completed bookings
        let countQuery, countParams;
        if (role === 'OWNER') { //OWNER view
            countQuery = `SELECT COUNT(DISTINCT b.customer_user_id) AS cnt FROM bookings b
                         WHERE b.salon_id IN (${makeIn(salonIds)}) AND b.status = 'COMPLETED'`;
            countParams = salonIds;
        } else { //EMPLOYEE view
            countQuery = `SELECT COUNT(DISTINCT b.customer_user_id) AS cnt FROM bookings b
                         JOIN booking_services bs ON bs.booking_id = b.booking_id
                         WHERE bs.employee_id = ? AND b.status = 'COMPLETED'`;
            countParams = [employee_id];
        }
        const [countRows] = await db.execute(countQuery, countParams);
        const total_records = countRows[0]?.cnt || 0;

        if (total_records === 0) { //if no records are found
            return res.status(200).json({
                data: {
                    summary: { total_records: 0 },
                    customers: [],
                    limit,
                    offset,
                    has_more: false
                }
            });
        }

        // List customers with COMPLETED visit totals and last completed visit
        let listQuery, listParams;
        if (role === 'OWNER') { //OWNER view
            listQuery = `SELECT b.customer_user_id AS user_id, u.full_name, u.email, u.phone,
                        COUNT(*) AS total_visits, MAX(b.scheduled_start) AS last_visit
                        FROM bookings b JOIN users u ON u.user_id = b.customer_user_id
                        WHERE b.salon_id IN (${makeIn(salonIds)}) AND b.status = 'COMPLETED'
                        GROUP BY b.customer_user_id, u.full_name, u.email, u.phone
                        ORDER BY total_visits DESC, last_visit DESC LIMIT ${limit} OFFSET ${offset}`;
listParams = [...salonIds];
        } else { //EMPLOYEE view
            listQuery = `SELECT b.customer_user_id AS user_id, u.full_name, u.email, u.phone,
                        COUNT(*) AS total_visits, MAX(b.scheduled_start) AS last_visit
                        FROM bookings b JOIN booking_services bs ON bs.booking_id = b.booking_id
                        JOIN users u ON u.user_id = b.customer_user_id WHERE bs.employee_id = ? AND b.status = 'COMPLETED'
                        GROUP BY b.customer_user_id, u.full_name, u.email, u.phone
                        ORDER BY total_visits DESC, last_visit DESC LIMIT ${limit} OFFSET ${offset}`;
listParams = [employee_id];
        }
        const [rows] = await db.execute(listQuery, listParams);

        const customers = rows.map(r => ({
            user_id: r.user_id,
            full_name: r.full_name,
            email: r.email,
            phone: r.phone,
            total_visits: Number(r.total_visits || 0),
            last_visit: formatDateTime(r.last_visit)
        }));

        return res.status(200).json({
            data: {
                summary: { total_records },
                customers,
                limit,
                offset,
                has_more: offset + customers.length < total_records
            }
        });
    } catch (error) {
        console.error('listVisitCustomers error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.2/1.21 salon owner/employee seeing an individual customer's details
exports.getCustomerVisitHistory = async (req, res) => {
    const db = connection.promise();

    try {
        //get authenticated user and their role either OWNER or EMPLOYEE
        const authUserId = req.user?.user_id;
        const role = req.user?.role;

        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //getting individual customer ID
        const { customer_user_id: paramId } = req.params;
        const customer_user_id = parseInt(paramId, 10);
        if (!Number.isInteger(customer_user_id) || customer_user_id <= 0) return res.status(400).json({ message: 'Invalid customer ID' });

        //pagination
        let { limit = 20, offset = 0 } = req.query;
        limit  = Number.isFinite(+limit) ? Math.max(1, Math.min(+limit, 100)) : 20;
        offset = Number.isFinite(+offset) ? Math.max(0, +offset) : 0;

        let salonIds = [];
        let employee_id = null;

        if (role === 'OWNER') { //OWNER view
            const [salonRows] = await db.execute(`SELECT salon_id FROM salons WHERE owner_user_id = ?`, [authUserId]);
            if (salonRows.length === 0) return res.status(404).json({ message: 'Salon not found for this owner' });
            salonIds = salonRows.map(s => s.salon_id);
        } else { //EMPLOYEE view
            const [empRows] = await db.execute(`SELECT employee_id, salon_id FROM employees WHERE user_id = ? AND active = 1`, [authUserId]);
            if (empRows.length === 0) return res.status(404).json({ message: 'Employee profile not found' });
            employee_id = empRows[0].employee_id;
        }

        const makeIn = (arr) => arr.map(() => '?').join(',');
        //count completed bookings
        let countQuery, countParams;
        if (role === 'OWNER') { //OWNER view
            countQuery = `SELECT COUNT(*) AS cnt FROM bookings b
                         WHERE b.customer_user_id = ? AND b.salon_id IN (${makeIn(salonIds)})
                         AND b.status = 'COMPLETED'`;
            countParams = [customer_user_id, ...salonIds];
        } else { //EMPLOYEE view
            countQuery = `SELECT COUNT(*) AS cnt FROM bookings b
                         JOIN booking_services bs ON bs.booking_id = b.booking_id
                         WHERE b.customer_user_id = ? AND bs.employee_id = ? AND b.status = 'COMPLETED'`;
            countParams = [customer_user_id, employee_id];
        }
        const [countRows] = await db.execute(countQuery, countParams);
        const total_records = countRows[0]?.cnt || 0;

        if (total_records === 0) { //if no records are found
            return res.status(200).json({
                data: {
                    customer: { user_id: customer_user_id },
                    summary: { total_records: 0 },
                    visits: [],
                    limit,
                    offset,
                    has_more: false
                }
            });
        }

        let bookingQuery, bookingParams;
        if (role === 'OWNER') { //OWNER view
            bookingQuery = `SELECT b.booking_id, b.scheduled_start, b.scheduled_end, b.status, b.notes
                            FROM bookings b WHERE b.customer_user_id = ? AND b.salon_id IN (${makeIn(salonIds)})
                            AND b.status = 'COMPLETED' ORDER BY b.scheduled_start DESC LIMIT ${limit} OFFSET ${offset}`;
bookingParams = [customer_user_id, ...salonIds];
        } else { //EMPLOYEE view
            bookingQuery = `SELECT b.booking_id, b.scheduled_start, b.scheduled_end, b.status, b.notes
                           FROM bookings b JOIN booking_services bs ON bs.booking_id = b.booking_id
                           WHERE b.customer_user_id = ? AND bs.employee_id = ? AND b.status = 'COMPLETED'
                           GROUP BY b.booking_id ORDER BY b.scheduled_start DESC LIMIT ${limit} OFFSET ${offset}`;
bookingParams = [customer_user_id, employee_id];
        }
        const [bookingRows] = await db.execute(bookingQuery, bookingParams);
        const bookingIds = bookingRows.map(r => r.booking_id);

        if (bookingIds.length === 0) { //if no records are found
            return res.status(200).json({
                data: {
                    customer: { user_id: customer_user_id },
                    summary: { total_records: 0 },
                    visits: [],
                    limit,
                    offset,
                    has_more: false
                }
            });
        }

        //services for the bookings
        const svcPh = bookingIds.map(() => '?').join(',');
        let svcRows = [];
        if (role === 'OWNER') { //OWNER view
            const [svc] = await db.execute(`SELECT bs.booking_id, bs.service_id, s.name AS service_name,
                                           bs.duration_minutes, bs.price, bs.employee_id, u.full_name AS employee_name, e.title AS employee_title
                                           FROM booking_services bs JOIN services s ON s.service_id = bs.service_id
                                           LEFT JOIN employees e ON e.employee_id = bs.employee_id LEFT JOIN users u ON u.user_id = e.user_id
                                           WHERE bs.booking_id IN (${svcPh}) ORDER BY bs.booking_id, s.name`, bookingIds
            );
            svcRows = svc;
        } else { //EMPLOYEE view
            const [svc] = await db.execute(`SELECT bs.booking_id, bs.service_id, s.name AS service_name,
                                           bs.duration_minutes, bs.price, bs.employee_id, u.full_name AS employee_name, e.title AS employee_title
                                           FROM booking_services bs JOIN services s ON s.service_id = bs.service_id
                                           LEFT JOIN employees e ON e.employee_id = bs.employee_id LEFT JOIN users u ON u.user_id = e.user_id
                                           WHERE bs.booking_id IN (${svcPh}) AND bs.employee_id = ? ORDER BY bs.booking_id, s.name`, [...bookingIds, employee_id]
            );
            svcRows = svc;
        }
        //getting each service by booking
        const svcByBooking = new Map();
        for (const r of svcRows) {
            if (!svcByBooking.has(r.booking_id)) {
                svcByBooking.set(r.booking_id, []);
            }
            svcByBooking.get(r.booking_id).push({
                service_id: r.service_id,
                service_name: r.service_name,
                duration_minutes: Number(r.duration_minutes),
                price: Number(r.price),
                employee: r.employee_id
                    ? { employee_id: r.employee_id, name: r.employee_name, title: r.employee_title, } : null,
            });
        }

        // Bulk query
        if (bookingIds.length > 0) {
            const paymentPlaceholders = bookingIds.map(() => '?').join(',');
            [allPayments] = await db.execute(
                `SELECT p.booking_id, p.amount, p.reward_id, p.status
                 FROM payments p
                 WHERE p.booking_id IN (${paymentPlaceholders})
                 AND p.status = 'SUCCEEDED'
                 AND p.created_at = (
                     SELECT MAX(created_at) 
                     FROM payments p2 
                     WHERE p2.booking_id = p.booking_id 
                     AND p2.status = 'SUCCEEDED'
                 )`,
                bookingIds
            );
        }

        // Extract reward IDs and bulk query rewards
        const rewardIds = allPayments.filter(p => p.reward_id).map(p => p.reward_id);
        let allRewards = [];
        if (rewardIds.length > 0) {
            const rewardPlaceholders = rewardIds.map(() => '?').join(',');
            [allRewards] = await db.execute(
                `SELECT reward_id, discount_percentage, note, creationDate, redeemed_at
                 FROM available_rewards
                 WHERE reward_id IN (${rewardPlaceholders})`,
                rewardIds
            );
        }

        // Group payments and rewards
        const paymentsByBooking = {};
        allPayments.forEach(p => {
            paymentsByBooking[p.booking_id] = p;
        });

        const rewardsById = {};
        allRewards.forEach(r => {
            rewardsById[r.reward_id] = r;
        });

        // Merging booking and service information and showing it as a visit
        const visits = bookingRows.map(b => {
            logUtcDebug('bookingController.getCustomerVisitHistory raw scheduled_start', b.scheduled_start);
            logUtcDebug('bookingController.getCustomerVisitHistory raw scheduled_end', b.scheduled_end);
            const services = svcByBooking.get(b.booking_id) || [];
            const total_price = services.reduce((s, x) => s + Number(x.price || 0), 0);

            const payment = paymentsByBooking[b.booking_id];
            let actualAmountPaid = null;
            let rewardInfo = null;

            if (payment) {
                actualAmountPaid = Number(payment.amount);
                
                if (payment.reward_id && rewardsById[payment.reward_id]) {
                    const reward = rewardsById[payment.reward_id];
                    rewardInfo = {
                        reward_id: reward.reward_id,
                        discount_percentage: Number(reward.discount_percentage),
                        note: reward.note,
                        creationDate: formatDateTime(reward.creationDate),
                        redeemed_at: formatDateTime(reward.redeemed_at)
                    };
                }
            }

            return {
                booking_id: b.booking_id,
                scheduled_start: formatDateTime(b.scheduled_start),
                scheduled_end: formatDateTime(b.scheduled_end),
                status: b.status,
                notes: b.notes,
                services,
                total_price,
                actual_amount_paid: actualAmountPaid,
                reward: rewardInfo
            };
        });

        return res.status(200).json({
            data: {
                customer: { user_id: customer_user_id },
                summary: { total_records },
                visits,
                limit,
                offset,
                has_more: offset + visits.length < total_records
            }
        });
    } catch (error) {
        console.error('getCustomerVisitHistory error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};