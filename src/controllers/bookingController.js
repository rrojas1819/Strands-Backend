const connection = require('../config/databaseConnection'); //db connection

const toLocalSQL = (dt) => {
    const Y = dt.getFullYear();
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    const H = String(dt.getHours()).padStart(2, '0');
    const MI = String(dt.getMinutes()).padStart(2, '0');
    const S = String(dt.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D} ${H}:${MI}:${S}`;
};

const formatDateTime = (timeStr) => {
    if (!timeStr) return null;
    if (timeStr instanceof Date) {
        const Y = timeStr.getFullYear();
        const M = String(timeStr.getMonth() + 1).padStart(2, '0');
        const D = String(timeStr.getDate()).padStart(2, '0');
        const H = String(timeStr.getHours()).padStart(2, '0');
        const MI = String(timeStr.getMinutes()).padStart(2, '0');
        const S = String(timeStr.getSeconds()).padStart(2, '0');
        return `${Y}-${M}-${D}T${H}:${MI}:${S}`;
    }
    return String(timeStr);
};

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

        const appointmentData = await Promise.all(bookings.map(async (booking) => {
            const [services] = await db.execute(
                `SELECT 
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
                 WHERE bs.booking_id = ?`,
                [booking.booking_id]
            );

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
                notes: booking.notes
            };
        }));

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

        // Parse as Date and keep everything in LOCAL time (same as weekly schedule)
        const startDate = new Date(scheduled_start);

        if (isNaN(startDate.getTime())) {
            return res.status(400).json({
                message: 'Invalid date format. EX: "2025-10-28T13:00:00"'
            });
        }

        const now = new Date();
        if (startDate < now) return res.status(400).json({ message: 'Cannot reschedule to a past time' });

        //get the current SCHEDULED booking
        const [bkRows] = await db.execute(`SELECT booking_id, salon_id, customer_user_id, scheduled_start, scheduled_end, status
                                      FROM bookings WHERE booking_id = ? AND customer_user_id = ? AND status = 'SCHEDULED'`,
            [Number(booking_id), authUserId]
        );
        if (bkRows.length === 0) return res.status(404).json({ message: 'Booking not found or not reschedulable' });

        //store info of current booking (now old)
        const oldBooking = bkRows[0];
        const salon_id = oldBooking.salon_id;

        //get the services associated with this booking
        const [servicesRows] = await db.execute(`SELECT service_id, employee_id, price, duration_minutes FROM booking_services WHERE booking_id = ?`,
            [Number(booking_id)]
        );
        if (servicesRows.length === 0) return res.status(400).json({ message: 'No services found for this booking' });

        //getting service duration and endtime of booking
        const totalDurationMinutes = servicesRows.reduce((sum, s) => sum + s.duration_minutes, 0);
        const endDate = new Date(startDate.getTime() + totalDurationMinutes * 60 * 1000);

        //getting all employees involved with the original booking along with the day
        const employeeIds = [...new Set(servicesRows.map(r => r.employee_id))];
        const bookingDayOfWeek = startDate.getDay();

        // Build local YYYY-MM-DD for the booking date
        const y = startDate.getFullYear();
        const m = String(startDate.getMonth() + 1).padStart(2, '0');
        const d = String(startDate.getDate()).padStart(2, '0');
        const dayStr = `${y}-${m}-${d}`;

        //always use local time
        const toLocalSQL = (dt) => {
            const Y = dt.getFullYear();
            const M = String(dt.getMonth() + 1).padStart(2, '0');
            const D = String(dt.getDate()).padStart(2, '0');
            const H = String(dt.getHours()).padStart(2, '0');
            const MI = String(dt.getMinutes()).padStart(2, '0');
            const S = String(dt.getSeconds()).padStart(2, '0');
            return `${Y}-${M}-${D} ${H}:${MI}:${S}`;
        };
        const requestStartStr = toLocalSQL(startDate);
        const requestEndStr = toLocalSQL(endDate);

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

            //checking working hours
            const availStart = new Date(`${dayStr}T${dayAvailability.start_time}`);
            const availEnd = new Date(`${dayStr}T${dayAvailability.end_time}`);
            if (startDate < availStart || endDate > availEnd) return res.status(400).json({ message: `Booking time must be within stylist availability (${dayAvailability.start_time} - ${dayAvailability.end_time})` });

            //checking unavailability
            const [unavailRows] = await db.execute(`SELECT start_time, end_time FROM employee_unavailability WHERE employee_id = ? AND weekday = ?`,
                                                   [empId, bookingDayOfWeek]
            );
            const hasConflict = unavailRows.some(block => {
                const blockStart = new Date(`${dayStr}T${block.start_time}`);
                const blockEnd = new Date(`${dayStr}T${block.end_time}`);
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
            //cancelling the old booking
            await db.execute(`UPDATE bookings SET status = 'CANCELED' WHERE booking_id = ? AND customer_user_id = ? AND status = 'SCHEDULED'`,
                             [booking_id, authUserId]
            );

            //creating the new booking
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

            await db.commit(); //commiting db changes

            return res.status(201).json({
                message: 'Appointment rescheduled successfully (old booking canceled, new booking created)',
                data: {
                    old_booking_id: Number(booking_id),
                    new_booking_id: newBookingId,
                    appointment: {
                        scheduled_start: requestStartStr.replace(' ', 'T'),
                        scheduled_end: requestEndStr.replace(' ', 'T'),
                        duration_minutes: Math.round((endDate - startDate) / (1000 * 60)),
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

        //finding the booking (appointment) to cancel and locking it
        const [rows] = await db.execute(`SELECT booking_id, customer_user_id, scheduled_start, status
                                    FROM bookings WHERE booking_id = ? AND customer_user_id = ? AND status = 'SCHEDULED'
                                    FOR UPDATE`, [bookingId, authUserId]
        );

        if (rows.length === 0) {
            await db.rollback();
            return res.status(404).json({ message: 'Booking not found' });
        }

        const booking = rows[0];

        //update booking to CANCELLED in bookings
        await db.execute(`UPDATE bookings SET status = 'CANCELED' WHERE booking_id = ?`, [bookingId]);

        //commit all db changes only if this point is reached, if a rollback is triggered then all changes do not take affect to keep synergy in db
        await db.commit();

        return res.status(200).json({
            message: 'Booking canceled',
            data: {
                booking_id: booking.booking_id,
                previous_status: 'SCHEDULED',
                new_status: 'CANCELED',
                canceled_at: new Date().toISOString()
            }
        });
    } catch (err) {
        try { await connection.promise().rollback(); } catch (_) { }
        return res.status(500).json({ message: 'Internal server error' });
    }
};