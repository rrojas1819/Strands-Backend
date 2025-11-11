const connection = require('../config/databaseConnection'); //db connection
const { formatDateTime, localAvailabilityToUtc } = require('../utils/utilies');

//validating time for SQL
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const normTime = (t) => {
    if (!TIME_RX.test(t || '')) return null;
    const [hh, mm, ss] = t.split(':');
    return `${hh}:${mm}${ss ? ':' + ss.padStart(2, '0') : ':00'}`;
};

//validating weekday value function
const validWeekday = (w) => Number.isInteger(w) && w >= 0 && w <= 6;

//BS 1.5 block unavailable time slots (create/block)
exports.createRecurringBlock = async (req, res) => {
    const db = connection.promise();

    //params
    let { weekday, start_time, end_time, slot_interval_minutes = 30 } = req.body;

    //validate weekday value
    weekday = parseInt(weekday, 10);
    if (!validWeekday(weekday)) {
        return res.status(400).json({ message: 'Weekday must be an integer between 0-6' });
    }

    //validating start and end time
    const start = normTime(start_time);
    const end = normTime(end_time);
    if (!start || !end) {
        return res.status(400).json({ message: 'Start time and End time must be HH:MM (24h) format' });
    }
    if (end <= start) {
        return res.status(400).json({ message: 'End time must be after Start time' });
    }

    //get authenticated user
    const authUserId = req.user?.user_id;

    try {
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id, e.salon_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = empRows[0].employee_id;
        const salonId = empRows[0].salon_id;
        
        const [salonTimezoneResult] = await db.execute(
            'SELECT timezone FROM salons WHERE salon_id = ?',
            [salonId]
        );
        const salonTimezone = salonTimezoneResult[0]?.timezone || 'America/New_York';

        //checking if employee has availability for this weekday
        const [availabilityRows] = await db.execute(`SELECT start_time, end_time FROM employee_availability
                                                    WHERE employee_id = ? AND weekday = ?`, [employeeId, weekday]
        ); if (!availabilityRows.length) return res.status(400).json({ message: 'No availability set for this weekday' });

        const availability = availabilityRows[0];
        
        //validating that unavailability is within availability bounds
        if (start < availability.start_time || end > availability.end_time) {
            return res.status(400).json({ 
                message: `Unavailability must be within availability hours (${availability.start_time} - ${availability.end_time})` 
            });
        }

        //checking for blocked time overlap
        const [overlap] = await db.execute(`SELECT 1 FROM employee_unavailability
                                       WHERE employee_id = ? AND weekday = ?
                                       AND NOT (end_time <= ? OR start_time >= ?)
                                       LIMIT 1`, [employeeId, weekday, start, end]
        ); if (overlap.length) return res.status(409).json({ message: 'Overlaps an existing recurring block' });

        //BS 1.7 Check for conflicting SCHEDULED appointments
        const [bookings] = await db.execute(
            `SELECT DISTINCT b.booking_id, b.scheduled_start, b.scheduled_end, u.full_name AS customer_name
             FROM bookings b
             JOIN booking_services bs ON b.booking_id = bs.booking_id
             LEFT JOIN users u ON b.customer_user_id = u.user_id
             WHERE bs.employee_id = ?
               AND b.status = 'SCHEDULED'
               AND b.scheduled_start >= UTC_TIMESTAMP()
             ORDER BY b.scheduled_start ASC`,
            [employeeId]
        );

        const conflictingAppointments = [];
        for (const booking of bookings) {
            const bookingStart = new Date(booking.scheduled_start);
            const bookingEnd = new Date(booking.scheduled_end);
            const bookingWeekday = bookingStart.getUTCDay();

            if (bookingWeekday !== weekday) continue;

            const bookingYear = bookingStart.getUTCFullYear();
            const bookingMonth = String(bookingStart.getUTCMonth() + 1).padStart(2, '0');
            const bookingDay = String(bookingStart.getUTCDate()).padStart(2, '0');
            const bookingDateStr = `${bookingYear}-${bookingMonth}-${bookingDay}`;

            const blockStartUtc = localAvailabilityToUtc(start, bookingDateStr, salonTimezone);
            const blockEndUtc = localAvailabilityToUtc(end, bookingDateStr, salonTimezone);
            
            if (bookingStart < blockEndUtc && bookingEnd > blockStartUtc) {
                conflictingAppointments.push({
                    booking_id: booking.booking_id,
                    scheduled_start: formatDateTime(booking.scheduled_start),
                    scheduled_end: formatDateTime(booking.scheduled_end),
                    customer_name: booking.customer_name || null
                });
            }
        }

        if (conflictingAppointments.length > 0) {
            return res.status(409).json({
                message: 'Cannot create block: conflicting appointments found',
                conflicting_appointments: conflictingAppointments
            });
        }

        //insert new blocked time
        const [ins] = await db.execute(`INSERT INTO employee_unavailability
                                   (employee_id, weekday, start_time, end_time, slot_interval_minutes)
                                   VALUES (?, ?, ?, ?, ?)`, [employeeId, weekday, start, end, parseInt(slot_interval_minutes, 10) || 30]
        );
        //fetch inserted blocked time
        const [[row]] = await db.execute(`SELECT unavailability_id, employee_id, weekday, start_time, end_time, slot_interval_minutes,
                                     created_at, updated_at FROM employee_unavailability WHERE unavailability_id = ?`, [ins.insertId]
        ); return res.status(201).json({ message: 'Recurring block created', data: row });
    } catch (err) {
        console.error('createRecurringBlock error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.5 block unavailable time slots (list)
exports.listRecurringBlocks = async (req, res) => {
    const db = connection.promise();

    //params
    const weekdayQ = req.query.weekday !== undefined ? parseInt(req.query.weekday, 10) : null; //current weekday

    //validate weekday value
    if (weekdayQ !== null && !validWeekday(weekdayQ)) {
        return res.status(400).json({ message: 'Weekday must be an integer between 0-6' });
    }

    //get authenticated user
    const authUserId = req.user?.user_id;

    try {
        //looking up employee by user_id
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = empRows[0].employee_id;

        //getting unavailable time slots
        const where = [`employee_id = ?`];
        const params = [employeeId];
        if (weekdayQ !== null) { where.push(`weekday = ?`); params.push(weekdayQ); }
        const [rows] = await db.execute(`SELECT unavailability_id, employee_id, weekday, start_time, end_time,
                                        slot_interval_minutes, created_at, updated_at FROM employee_unavailability
                                        WHERE ${where.join(' AND ')} ORDER BY weekday ASC, start_time ASC`, params
        ); return res.status(200).json({ data: rows });
    } catch (err) {
        console.error('listRecurringBlocks error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.5 block unavailable time slots (delete/unblock)
exports.deleteRecurringBlock = async (req, res) => {
    const db = connection.promise();

    //params
    let { weekday, start_time, end_time } = req.body;

    //validate weekday value
    weekday = parseInt(weekday, 10);
    if (!validWeekday(weekday)) {
        return res.status(400).json({ message: 'Weekday must be an integer between 0-6' });
    }

    //validating start and end time
    const start = normTime(start_time);
    const end = normTime(end_time);
    if (!start || !end) {
        return res.status(400).json({ message: 'Start time and End time must be HH:MM (24h) format' });
    }

    //get authenticated user
    const authUserId = req.user?.user_id;

    try {
        //looking up employee by user_id first
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = empRows[0].employee_id;

        //finding blocked time by weekday and time range
        const [rows] = await db.execute(`SELECT eu.unavailability_id, eu.employee_id, eu.weekday, eu.start_time, eu.end_time
                                        FROM employee_unavailability eu
                                        WHERE eu.employee_id = ? AND eu.weekday = ? AND eu.start_time = ? AND eu.end_time = ?`, 
                                        [employeeId, weekday, start, end]
        ); if (!rows.length) return res.status(404).json({ message: 'Recurring block not found' });
        
        //block found, now delete it
        await db.execute(`DELETE FROM employee_unavailability WHERE employee_id = ? AND weekday = ? AND start_time = ? AND end_time = ?`,
                        [employeeId, weekday, start, end]);

        return res.status(200).json({ message: 'Recurring block deleted' });
    } catch (err) {
        console.error('deleteRecurringBlock error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};