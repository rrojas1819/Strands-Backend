require('dotenv').config();
const connection = require('../config/databaseConnection');
const { formatDateTime, toMySQLUtc, validateEmail } = require('../utils/utilies');
const { DateTime } = require('luxon');

// NC 1.1 - Get user's notifications with pagination
exports.getNotifications = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Pagination parameters
        let { page = 1, limit = 10 } = req.query;
        page = Math.max(1, parseInt(page, 10) || 1);
        limit = Math.max(1, Math.min(parseInt(limit, 10) || 10, 20)); // Max 100 per page
        const offset = (page - 1) * limit;

        // Get total count
        const [countResult] = await db.execute(
            `SELECT COUNT(*) as total 
             FROM notifications_inbox 
             WHERE user_id = ?`,
            [user_id]
        );
        const total = countResult[0]?.total || 0;

        // Get notifications ordered by created_at DESC (newest first)
        const [notifications] = await db.execute(
            `SELECT 
                notification_id,
                user_id,
                salon_id,
                employee_id,
                email,
                booking_id,
                payment_id,
                product_id,
                review_id,
                type_code,
                status,
                message,
                sender_email,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                DATE_FORMAT(read_at, '%Y-%m-%d %H:%i:%s') AS read_at
             FROM notifications_inbox
             WHERE user_id = ?
             ORDER BY notifications_inbox.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            [user_id]
        );

        // Format notifications
        const formattedNotifications = notifications.map(notif => {
            // Parse created_at and read_at using Luxon
            let created_at_dt = null;
            let read_at_dt = null;
            
            if (notif.created_at) {
                if (notif.created_at instanceof Date) {
                    created_at_dt = DateTime.fromJSDate(notif.created_at, { zone: 'utc' });
                } else if (typeof notif.created_at === 'string') {
                    created_at_dt = DateTime.fromSQL(notif.created_at, { zone: 'utc' });
                    if (!created_at_dt.isValid) {
                        created_at_dt = DateTime.fromISO(notif.created_at);
                    }
                }
            }
            
            if (notif.read_at) {
                if (notif.read_at instanceof Date) {
                    read_at_dt = DateTime.fromJSDate(notif.read_at, { zone: 'utc' });
                } else if (typeof notif.read_at === 'string') {
                    read_at_dt = DateTime.fromSQL(notif.read_at, { zone: 'utc' });
                    if (!read_at_dt.isValid) {
                        read_at_dt = DateTime.fromISO(notif.read_at);
                    }
                }
            }

            return {
                notification_id: notif.notification_id,
                user_id: notif.user_id,
                salon_id: notif.salon_id,
                employee_id: notif.employee_id,
                email: notif.email,
                booking_id: notif.booking_id,
                payment_id: notif.payment_id,
                product_id: notif.product_id,
                review_id: notif.review_id,
                type_code: notif.type_code,
                status: notif.status,
                message: notif.message,
                sender_email: notif.sender_email,
                created_at: formatDateTime(notif.created_at),
                sent: created_at_dt && created_at_dt.isValid 
                    ? created_at_dt.toLocal().toFormat('EEE, MMM d, yyyy h:mm a') 
                    : null,
                read_at: formatDateTime(notif.read_at),
                read_at_formatted: read_at_dt && read_at_dt.isValid 
                    ? read_at_dt.toLocal().toFormat('EEE, MMM d, yyyy h:mm a') 
                    : null
            };
        });

        const totalPages = Math.ceil(total / limit);
        const hasMore = page < totalPages;

        return res.status(200).json({
            message: 'Notifications retrieved successfully',
            data: {
                notifications: formattedNotifications,
                pagination: {
                    page,
                    limit,
                    total,
                    total_pages: totalPages,
                    has_more: hasMore
                }
            }
        });

    } catch (error) {
        console.error('getNotifications error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// NC 1.1 - Mark notification as read
exports.markAsRead = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { notification_id } = req.body;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!notification_id || isNaN(notification_id)) {
            return res.status(400).json({ message: 'Invalid notification_id' });
        }

        const now = toMySQLUtc(DateTime.utc());

        const [result] = await db.execute(
            `UPDATE notifications_inbox 
             SET status = 'READ', read_at = ?
             WHERE notification_id = ? AND user_id = ? AND status = 'UNREAD'`,
            [now, notification_id, user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                message: 'Notification not found, already read, or does not belong to you' 
            });
        }

        return res.status(200).json({
            message: 'Notification marked as read',
            data: {
                notification_id: parseInt(notification_id, 10),
                read_at: formatDateTime(now)
            }
        });

    } catch (error) {
        console.error('markAsRead error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// NC 1.1 - Stylist manually sends appointment reminder to all customers with bookings today
exports.stylistSendReminder = async (req, res) => {
    const db = connection.promise();

    try {
        const stylist_user_id = req.user?.user_id;
        const type_code = 'MANUAL_REMINDER';

        if (!stylist_user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const [employeeResult] = await db.execute(
            `SELECT e.employee_id, e.salon_id, u.email, u.full_name
             FROM employees e
             JOIN users u ON e.user_id = u.user_id
             WHERE e.user_id = ? AND e.active = 1`,
            [stylist_user_id]
        );

        if (employeeResult.length === 0) {
            return res.status(403).json({ message: 'Employee not found or inactive' });
        }

        const employee_id = employeeResult[0].employee_id;
        const salon_id = employeeResult[0].salon_id;
        const stylist_email = employeeResult[0].email;
        const stylist_name = employeeResult[0].full_name;

        // Check if stylist has sent a reminder in the last hour
        const now = DateTime.utc();
        const oneHourAgo = now.minus({ hours: 1 });
        const oneHourAgoUtc = toMySQLUtc(oneHourAgo);

        const [recentReminders] = await db.execute(
            `SELECT notification_id, created_at
             FROM notifications_inbox
             WHERE employee_id = ?
               AND type_code = 'MANUAL_REMINDER'
               AND created_at >= ?
             LIMIT 1`,
            [employee_id, oneHourAgoUtc]
        );

        if (recentReminders.length > 0) {
            const lastReminderTime = DateTime.fromSQL(recentReminders[0].created_at, { zone: 'utc' });
            const nextAllowedTime = lastReminderTime.plus({ hours: 1 });
            const timeUntilNext = nextAllowedTime.diff(now, ['minutes']).minutes;

            return res.status(429).json({
                message: 'You can only send reminders once per hour. Please wait before sending another reminder.',
                data: {
                    last_reminder_sent: lastReminderTime.toISO(),
                    next_allowed_at: nextAllowedTime.toISO(),
                    minutes_remaining: Math.ceil(timeUntilNext)
                }
            });
        }

        const [salonTimezoneResult] = await db.execute(
            'SELECT timezone, name FROM salons WHERE salon_id = ?',
            [salon_id]
        );
        const salonTimezone = salonTimezoneResult[0]?.timezone || 'America/New_York';
        const salon_name = salonTimezoneResult[0]?.name || '';

        const todayInSalonTz = now.setZone(salonTimezone);
        const startOfDay = todayInSalonTz.startOf('day');
        const endOfDay = todayInSalonTz.endOf('day');

        // Convert to UTC for database query
        const startOfDayUtc = toMySQLUtc(startOfDay.toUTC());
        const endOfDayUtc = toMySQLUtc(endOfDay.toUTC());

        // Get all SCHEDULED bookings for this stylist on the current day (in salon timezone)
        const [bookingsResult] = await db.execute(
            `SELECT 
                b.booking_id,
                b.customer_user_id,
                DATE_FORMAT(b.scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
                DATE_FORMAT(b.scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
                u.email,
                u.full_name
             FROM bookings b
             JOIN booking_services bs ON b.booking_id = bs.booking_id
             JOIN users u ON b.customer_user_id = u.user_id
             WHERE bs.employee_id = ?
               AND b.status = 'SCHEDULED'
               AND b.scheduled_start >= ?
               AND b.scheduled_start < ?
             ORDER BY b.scheduled_start ASC`,
            [employee_id, startOfDayUtc, endOfDayUtc]
        );

        if (bookingsResult.length === 0) {
            return res.status(200).json({
                message: 'No bookings found for today',
                data: {
                    notifications_created: 0,
                    date: startOfDay.toFormat('yyyy-MM-dd'),
                    salon_timezone: salonTimezone
                }
            });
        }

        // Group bookings by customer
        const bookingsByCustomer = {};
        for (const booking of bookingsResult) {
            const customer_id = booking.customer_user_id;
            if (!bookingsByCustomer[customer_id]) {
                bookingsByCustomer[customer_id] = {
                    user_id: customer_id,
                    email: booking.email,
                    full_name: booking.full_name,
                    bookings: []
                };
            }

            // Parse booking times and convert to salon timezone for display
            const bookingStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
            const bookingEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
            
            const bookingStartLocal = bookingStart.setZone(salonTimezone);
            const bookingEndLocal = bookingEnd.setZone(salonTimezone);

            bookingsByCustomer[customer_id].bookings.push({
                booking_id: booking.booking_id,
                scheduled_start: bookingStartLocal,
                scheduled_end: bookingEndLocal
            });
        }

        // Create notifications for each customer with all their booking times
        const nowUtc = toMySQLUtc(now);
        const notificationsCreated = [];
        const dateStr = startOfDay.toFormat('EEEE, MMMM d, yyyy'); // e.g., "Monday, November 17, 2025"

        await db.beginTransaction();

        try {
            for (const customerId in bookingsByCustomer) {
                const customer = bookingsByCustomer[customerId];
                const customerBookings = customer.bookings;

                let message = `Reminder: You have ${customerBookings.length} appointment${customerBookings.length > 1 ? 's' : ''} at ${salon_name} with ${stylist_name} scheduled for ${dateStr}:\n\n`;
                
                for (let i = 0; i < customerBookings.length; i++) {
                    const booking = customerBookings[i];
                    const startTime = booking.scheduled_start.toFormat('h:mm a');
                    const endTime = booking.scheduled_end.toFormat('h:mm a');
                    
                    message += `${i + 1}. ${startTime} - ${endTime}\n`;
                    
                    const [services] = await db.execute(
                        `SELECT 
                            s.name AS service_name,
                            bs.duration_minutes
                         FROM booking_services bs
                         JOIN services s ON bs.service_id = s.service_id
                         WHERE bs.booking_id = ? AND bs.employee_id = ?
                         ORDER BY s.name`,
                        [booking.booking_id, employee_id]
                    );
                    
                    if (services.length > 0) {
                        message += `   Services:\n`;
                        services.forEach((service) => {
                            message += `   - ${service.service_name}`;
                            if (service.duration_minutes) {
                                message += ` (${service.duration_minutes} min)`;
                            }
                            message += `\n`;
                        });
                    }
                    message += `\n`;
                }

                if (message.length > 500) {
                    message = message.substring(0, 497) + '...';
                }

                const firstBookingId = customerBookings[0].booking_id;

                const [result] = await db.execute(
                    `INSERT INTO notifications_inbox 
                     (user_id, salon_id, employee_id, email, booking_id, type_code, status, message, sender_email, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, 'UNREAD', ?, ?, ?)`,
                    [
                        customer.user_id,
                        salon_id,
                        employee_id,
                        customer.email,
                        firstBookingId, // Reference to first booking
                        type_code,
                        message.trim(),
                        stylist_email,
                        nowUtc
                    ]
                );

                notificationsCreated.push({
                    notification_id: result.insertId,
                    user_id: customer.user_id,
                    email: customer.email,
                    full_name: customer.full_name,
                    bookings_count: customerBookings.length,
                    booking_ids: customerBookings.map(b => b.booking_id)
                });
            }

            await db.commit();

            return res.status(201).json({
                message: 'Reminders sent successfully to customers',
                data: {
                    date: startOfDay.toFormat('yyyy-MM-dd'),
                    salon_timezone: salonTimezone,
                    notifications_created: notificationsCreated.length,
                    total_bookings: bookingsResult.length,
                    notifications: notificationsCreated
                }
            });

        } catch (txError) {
            await db.rollback();
            throw txError;
        }

    } catch (error) {
        console.error('stylistSendReminder error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// NC 1.1 - Delete notification
exports.deleteNotification = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { notification_id } = req.params;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!notification_id || isNaN(notification_id)) {
            return res.status(400).json({ message: 'Invalid notification_id' });
        }

        const [notification] = await db.execute(
            `SELECT notification_id 
             FROM notifications_inbox 
             WHERE notification_id = ? AND user_id = ?`,
            [notification_id, user_id]
        );

        if (notification.length === 0) {
            return res.status(404).json({ 
                message: 'Notification not found or does not belong to you' 
            });
        }

        const [result] = await db.execute(
            `DELETE FROM notifications_inbox 
             WHERE notification_id = ? AND user_id = ?`,
            [notification_id, user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                message: 'Notification not found or does not belong to you' 
            });
        }

        return res.status(200).json({
            message: 'Notification deleted successfully',
            data: {
                notification_id: parseInt(notification_id, 10)
            }
        });

    } catch (error) {
        console.error('deleteNotification error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

