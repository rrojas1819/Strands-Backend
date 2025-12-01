const connection = require('../config/databaseConnection');
const { formatDateTime, toMySQLUtc, validateEmail } = require('../utils/utilies');
const { DateTime } = require('luxon');
const notificationSecurity = require('../utils/notificationsSecurity');

// NC 1.1 - Get user's notifications with pagination
exports.getNotifications = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Pagination parameters
        let { page = 1, limit = 10, filter = 'all' } = req.query;
        page = Math.max(1, parseInt(page, 10) || 1);
        limit = Math.max(1, Math.min(parseInt(limit, 10) || 10, 20)); // Max 100 per page
        const offset = (page - 1) * limit;

        const categoryFilters = {
            'bookings': [
                'BOOKING_CREATED',
                'BOOKING_RESCHEDULED',
                'BOOKING_CANCELED',
                'PHOTO_UPLOADED',
                'MANUAL_REMINDER'
            ],
            'rewards': [
                'PROMO_REDEEMED',
                'LOYALTY_REWARD_REDEEMED',
                'UNUSED_OFFERS_REMINDER'
            ],
            'products': [
                'PRODUCT_ADDED',
                'PRODUCT_DELETED',
                'PRODUCT_RESTOCKED',
                'PRODUCT_PURCHASED'
            ],
            'reviews': [
                'REVIEW_CREATED',
                'REVIEW_UPDATED',
                'REVIEW_DELETED',
                'REVIEW_REPLY_CREATED',
                'REVIEW_REPLY_UPDATED',
                'REVIEW_REPLY_DELETED'
            ]
        };

        let whereClause = 'WHERE user_id = ?';
        const queryParams = [user_id];

        if (filter && filter !== 'all' && categoryFilters[filter.toLowerCase()]) {
            const typeCodes = categoryFilters[filter.toLowerCase()];
            const placeholders = typeCodes.map(() => '?').join(',');
            whereClause += ` AND type_code IN (${placeholders})`;
            queryParams.push(...typeCodes);
        }

        // Get total count
        const [countResult] = await db.execute(
            `SELECT COUNT(*) as total 
             FROM notifications_inbox 
             ${whereClause}`,
            queryParams
        );
        const total = countResult[0]?.total || 0;

        // Get unread count 
        const [unreadCountResult] = await db.execute(
            `SELECT COUNT(*) as unread_count 
             FROM notifications_inbox 
             ${whereClause} AND status = 'UNREAD'`,
            queryParams
        );
        const unreadCount = unreadCountResult[0]?.unread_count || 0;

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
             ${whereClause}
             ORDER BY notifications_inbox.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            queryParams
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

            // Decrypt the message when retrieving
            let decryptedMessage = notif.message;
            try {
                decryptedMessage = notificationSecurity.decryptMessage(notif.message);
            } catch (decryptError) {
                console.error('Failed to decrypt notification message:', decryptError);
                decryptedMessage = '[Unable to decrypt message]';
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
                message: decryptedMessage,
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

        const activeFilter = filter && filter !== 'all' && categoryFilters[filter.toLowerCase()]
            ? filter.toLowerCase()
            : 'all';

        return res.status(200).json({
            message: 'Notifications retrieved successfully',
            data: {
                notifications: formattedNotifications,
                unread_count: unreadCount,
                filter: {
                    active: activeFilter,
                    available: ['all', 'bookings', 'rewards', 'products', 'reviews']
                },
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

// Get unread notification count
exports.getUnreadCount = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Get unread count
        const [unreadCountResult] = await db.execute(
            `SELECT COUNT(*) as unread_count 
             FROM notifications_inbox 
             WHERE user_id = ? AND status = 'UNREAD'`,
            [user_id]
        );

        const unreadCount = unreadCountResult[0]?.unread_count || 0;

        return res.status(200).json({
            unread_count: unreadCount
        });

    } catch (error) {
        console.error('getUnreadCount error:', error);
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

                const notificationResult = await exports.createNotification(db, {
                    user_id: customer.user_id,
                    salon_id: salon_id,
                    employee_id: employee_id,
                    email: customer.email,
                    booking_id: firstBookingId, // Reference to first booking
                    type_code: type_code,
                    message: message.trim(),
                    sender_email: stylist_email
                });

                notificationsCreated.push({
                    notification_id: notificationResult.notification_id,
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

// Mark all notifications as read for a user
exports.markAllAsRead = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const now = toMySQLUtc(DateTime.utc());

        const [result] = await db.execute(
            `UPDATE notifications_inbox 
             SET status = 'READ', read_at = ?
             WHERE user_id = ? AND status = 'UNREAD'`,
            [now, user_id]
        );

        return res.status(200).json({
            message: 'All notifications marked as read',
            data: {
                notifications_updated: result.affectedRows,
                read_at: formatDateTime(now)
            }
        });

    } catch (error) {
        console.error('markAllAsRead error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Delete all notifications for a user
exports.deleteAllNotifications = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Get count before deletion
        const [countResult] = await db.execute(
            `SELECT COUNT(*) as total 
             FROM notifications_inbox 
             WHERE user_id = ?`,
            [user_id]
        );
        const totalBefore = countResult[0]?.total || 0;

        const [result] = await db.execute(
            `DELETE FROM notifications_inbox 
             WHERE user_id = ?`,
            [user_id]
        );

        return res.status(200).json({
            message: 'All notifications deleted successfully',
            data: {
                notifications_deleted: result.affectedRows,
                total_before: totalBefore
            }
        });

    } catch (error) {
        console.error('deleteAllNotifications error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// NC 1.3 - Helper function to send notifications about unused promos and rewards
// Can be used by both scheduled job and manual endpoint
const sendUnusedOffersNotifications = async (db = null, salon_id = null) => {
    const useExternalDb = db !== null;
    if (!useExternalDb) {
        db = connection.promise();
    }

    try {
        const now = DateTime.utc();
        const nowUtc = toMySQLUtc(now);
        const type_code = 'UNUSED_OFFERS_REMINDER';

        let allCustomers = [];
        if (salon_id !== null) {
            const [customers] = await db.execute(
                `SELECT DISTINCT 
                    b.customer_user_id AS user_id,
                    s.salon_id,
                    s.name AS salon_name,
                    u.email,
                    u.full_name
                 FROM bookings b
                 JOIN salons s ON s.salon_id = b.salon_id
                 JOIN users u ON u.user_id = b.customer_user_id
                 WHERE b.salon_id = ?`,
                [salon_id]
            );
            allCustomers = customers;
        }

        if (salon_id !== null && allCustomers.length === 0) {
            return {
                success: true,
                notifications_created: 0,
                message: 'No customers found for this salon'
            };
        }

        const customerUserIds = salon_id !== null && allCustomers.length > 0
            ? allCustomers.map(c => c.user_id)
            : null;

        // Query unused promos - filter by salon_id and customer list if provided
        let promoQuery = `SELECT 
                up.user_id,
                up.salon_id,
                up.promo_code,
                up.description,
                up.discount_pct,
                DATE_FORMAT(up.expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
                s.name AS salon_name,
                u.email,
                u.full_name
             FROM user_promotions up
             JOIN salons s ON s.salon_id = up.salon_id
             JOIN users u ON u.user_id = up.user_id
             WHERE up.status = 'ISSUED'
               AND (up.expires_at IS NULL OR up.expires_at > ?)`;

        const promoParams = [nowUtc];
        if (salon_id !== null) {
            promoQuery += ` AND up.salon_id = ?`;
            promoParams.push(salon_id);
        }
        if (customerUserIds !== null && customerUserIds.length > 0) {
            const placeholders = customerUserIds.map(() => '?').join(',');
            promoQuery += ` AND up.user_id IN (${placeholders})`;
            promoParams.push(...customerUserIds);
        }

        const [unusedPromos] = await db.execute(promoQuery, promoParams);

        // Query unused rewards - filter by salon_id and customer list if provided
        let rewardQuery = `SELECT 
                ar.user_id,
                ar.salon_id,
                ar.reward_id,
                ar.discount_percentage,
                ar.note,
                ar.creationDate,
                s.name AS salon_name,
                u.email,
                u.full_name
             FROM available_rewards ar
             JOIN salons s ON s.salon_id = ar.salon_id
             JOIN users u ON u.user_id = ar.user_id
             WHERE ar.active = 1 
               AND ar.redeemed_at IS NULL`;

        const rewardParams = [];
        if (salon_id !== null) {
            rewardQuery += ` AND ar.salon_id = ?`;
            rewardParams.push(salon_id);
        }
        if (customerUserIds !== null && customerUserIds.length > 0) {
            const placeholders = customerUserIds.map(() => '?').join(',');
            rewardQuery += ` AND ar.user_id IN (${placeholders})`;
            rewardParams.push(...customerUserIds);
        }

        const [unusedRewards] = await db.execute(rewardQuery, rewardParams);

        const userSalonMap = {};

        for (const promo of unusedPromos) {
            const key = `${promo.user_id}_${promo.salon_id}`;
            if (!userSalonMap[key]) {
                userSalonMap[key] = {
                    user_id: promo.user_id,
                    salon_id: promo.salon_id,
                    salon_name: promo.salon_name,
                    email: promo.email,
                    full_name: promo.full_name,
                    promos: [],
                    rewards: []
                };
            }
            userSalonMap[key].promos.push({
                promo_code: promo.promo_code,
                description: promo.description,
                discount_pct: promo.discount_pct,
                expires_at: promo.expires_at
            });
        }

        for (const reward of unusedRewards) {
            const key = `${reward.user_id}_${reward.salon_id}`;
            if (!userSalonMap[key]) {
                userSalonMap[key] = {
                    user_id: reward.user_id,
                    salon_id: reward.salon_id,
                    salon_name: reward.salon_name,
                    email: reward.email,
                    full_name: reward.full_name,
                    promos: [],
                    rewards: []
                };
            }
            userSalonMap[key].rewards.push({
                reward_id: reward.reward_id,
                discount_percentage: reward.discount_percentage,
                note: reward.note,
                creationDate: reward.creationDate
            });
        }

        const usersToNotify = Object.values(userSalonMap).filter(
            user => user.promos.length > 0 || user.rewards.length > 0
        );

        if (usersToNotify.length === 0) {
            return {
                success: true,
                notifications_created: 0,
                message: 'No users with unused offers found'
            };
        }

        const notificationsCreated = [];
        const shouldUseTransaction = !useExternalDb;

        if (shouldUseTransaction) {
            await db.beginTransaction();
        }

        try {
            const errors = [];
            for (const userData of usersToNotify) {
                try {
                    const createNotificationChunks = (message) => {
                        const maxMessageLength = 400;
                        const messageChunks = [];

                        if (message.length <= maxMessageLength) {
                            messageChunks.push(message.trim());
                        } else {
                            let remaining = message;
                            let partNumber = 1;
                            const totalParts = Math.ceil(message.length / maxMessageLength);

                            while (remaining.length > 0) {
                                if (remaining.length <= maxMessageLength) {
                                    let chunk = remaining.trim();
                                    if (totalParts > 1) {
                                        chunk = `(Part ${partNumber}/${totalParts})\n${chunk}`;
                                    }
                                    messageChunks.push(chunk);
                                    break;
                                }

                                let splitPoint = maxMessageLength;
                                const searchStart = Math.max(0, maxMessageLength - 50);
                                const lastNewline = remaining.lastIndexOf('\n', maxMessageLength);

                                if (lastNewline > searchStart) {
                                    splitPoint = lastNewline + 1;
                                }

                                let chunk = remaining.substring(0, splitPoint).trim();
                                if (totalParts > 1) {
                                    chunk = `(Part ${partNumber}/${totalParts})\n${chunk}`;
                                }
                                messageChunks.push(chunk);

                                remaining = remaining.substring(splitPoint);
                                partNumber++;
                            }
                        }
                        return messageChunks;
                    };

                    if (userData.promos.length > 0) {
                        let promoMessage = `You have unused promo codes at ${userData.salon_name}:\n\n`;
                        promoMessage += `Promo Codes (${userData.promos.length}):\n`;

                        userData.promos.forEach((promo, index) => {
                            promoMessage += `${index + 1}. Code: ${promo.promo_code} - ${promo.discount_pct}% off`;
                            if (promo.description) {
                                promoMessage += ` - ${promo.description}`;
                            }
                            if (promo.expires_at) {
                                let expiresAt = null;
                                if (typeof promo.expires_at === 'string') {
                                    expiresAt = DateTime.fromSQL(promo.expires_at, { zone: 'utc' });
                                    if (!expiresAt.isValid) {
                                        expiresAt = DateTime.fromISO(promo.expires_at);
                                    }
                                    if (!expiresAt.isValid) {
                                        const mysqlDate = promo.expires_at.replace(' ', 'T') + 'Z';
                                        expiresAt = DateTime.fromISO(mysqlDate);
                                    }
                                } else if (promo.expires_at instanceof Date) {
                                    expiresAt = DateTime.fromJSDate(promo.expires_at, { zone: 'utc' });
                                }

                                if (expiresAt && expiresAt.isValid) {
                                    promoMessage += ` (Expires: ${expiresAt.toFormat('MMM d, yyyy')})`;
                                }
                            }
                            promoMessage += `\n`;
                        });

                        const promoChunks = createNotificationChunks(promoMessage);

                        for (let i = 0; i < promoChunks.length; i++) {
                            const notificationResult = await exports.createNotification(db, {
                                user_id: userData.user_id,
                                salon_id: userData.salon_id,
                                email: userData.email,
                                type_code: type_code,
                                message: promoChunks[i],
                                sender_email: 'SYSTEM'
                            });

                            notificationsCreated.push({
                                notification_id: notificationResult.notification_id,
                                user_id: userData.user_id,
                                email: userData.email,
                                salon_id: userData.salon_id,
                                salon_name: userData.salon_name,
                                type: 'promo_codes',
                                promos_count: userData.promos.length,
                                part_number: promoChunks.length > 1 ? i + 1 : null,
                                total_parts: promoChunks.length > 1 ? promoChunks.length : null
                            });
                        }
                    }

                    if (userData.rewards.length > 0) {
                        let rewardMessage = `You have unused loyalty rewards at ${userData.salon_name}:\n\n`;
                        rewardMessage += `Loyalty Rewards (${userData.rewards.length}):\n`;

                        userData.rewards.forEach((reward, index) => {
                            rewardMessage += `${index + 1}. ${reward.discount_percentage}% off`;
                            if (reward.note) {
                                rewardMessage += ` - ${reward.note}`;
                            }
                            rewardMessage += `\n`;
                        });

                        const rewardChunks = createNotificationChunks(rewardMessage);

                        for (let i = 0; i < rewardChunks.length; i++) {
                            // Use createNotification helper to ensure encryption
                            const notificationResult = await exports.createNotification(db, {
                                user_id: userData.user_id,
                                salon_id: userData.salon_id,
                                email: userData.email,
                                type_code: type_code,
                                message: rewardChunks[i],
                                sender_email: 'SYSTEM'
                            });

                            notificationsCreated.push({
                                notification_id: notificationResult.notification_id,
                                user_id: userData.user_id,
                                email: userData.email,
                                salon_id: userData.salon_id,
                                salon_name: userData.salon_name,
                                type: 'loyalty_rewards',
                                rewards_count: userData.rewards.length,
                                part_number: rewardChunks.length > 1 ? i + 1 : null,
                                total_parts: rewardChunks.length > 1 ? rewardChunks.length : null
                            });
                        }
                    }
                } catch (userError) {
                    // Log error for this specific user but continue with others
                    console.error(`Error processing user ${userData.user_id} for unused offers notification:`, {
                        user_id: userData.user_id,
                        email: userData.email,
                        salon_id: userData.salon_id,
                        error: userError.message,
                        stack: userError.stack
                    });
                    errors.push({
                        user_id: userData.user_id,
                        email: userData.email,
                        error: userError.message
                    });
                    // Continue processing other users
                }
            }

            if (shouldUseTransaction) {
                await db.commit();
            }

            return {
                success: true,
                notifications_created: notificationsCreated.length,
                total_users_with_offers: usersToNotify.length,
                users_processed: usersToNotify.length - errors.length,
                users_failed: errors.length,
                errors: errors.length > 0 ? errors : undefined,
                notifications: notificationsCreated
            };

        } catch (txError) {
            if (shouldUseTransaction) {
                await db.rollback();
            }
            throw txError;
        }

    } catch (error) {
        console.error('sendUnusedOffersNotifications error:', error);
        throw error;
    }
};

exports.sendUnusedOffersNotifications = sendUnusedOffersNotifications;

// NC 1.3 - Owner endpoint to manually trigger unused offers notifications
exports.ownerSendUnusedOffersNotifications = async (req, res) => {
    const db = connection.promise();

    try {
        const owner_user_id = req.user?.user_id;

        if (!owner_user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Verify user is an owner and get their salon_id
        const [ownerCheck] = await db.execute(
            'SELECT user_id FROM users WHERE user_id = ? AND role = ?',
            [owner_user_id, 'OWNER']
        );

        if (ownerCheck.length === 0) {
            return res.status(403).json({ message: 'Only owners can trigger this notification' });
        }

        // Get the owner's salon_id
        const [salonResult] = await db.execute(
            'SELECT salon_id FROM salons WHERE owner_user_id = ?',
            [owner_user_id]
        );

        if (salonResult.length === 0) {
            return res.status(404).json({ message: 'Salon not found for this owner' });
        }

        const salon_id = salonResult[0].salon_id;

        const result = await sendUnusedOffersNotifications(db, salon_id);

        return res.status(200).json({
            message: 'Unused offers notifications sent successfully',
            data: result
        });

    } catch (error) {
        console.error('ownerSendUnusedOffersNotifications error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Helper function to create and send a notification, can be used by other controllers to send notifications
exports.createNotification = async (db, notificationData) => {
    try {
        const {
            user_id,
            salon_id = null,
            employee_id = null,
            email,
            booking_id = null,
            payment_id = null,
            product_id = null,
            review_id = null,
            type_code,
            message,
            sender_email = 'SYSTEM'
        } = notificationData;

        if (!user_id || !email || !type_code || !message) {
            throw new Error('Missing required notification fields');
        }

        const nowUtc = toMySQLUtc(DateTime.utc());

        let encryptedMessage;
        try {
            encryptedMessage = notificationSecurity.encryptMessage(message.trim());
        } catch (encryptError) {
            console.error('Failed to encrypt notification message:', encryptError);
            throw new Error('Failed to encrypt notification message');
        }

        const [result] = await db.execute(
            `INSERT INTO notifications_inbox 
             (user_id, salon_id, employee_id, email, booking_id, payment_id, product_id, review_id, type_code, status, message, sender_email, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNREAD', ?, ?, ?)`,
            [
                user_id,
                salon_id,
                employee_id,
                email,
                booking_id,
                payment_id,
                product_id,
                review_id,
                type_code,
                encryptedMessage,
                sender_email,
                nowUtc
            ]
        );

        return {
            success: true,
            notification_id: result.insertId,
            created_at: nowUtc
        };
    } catch (error) {
        console.error('createNotification error:', error);
        throw error;
    }
};

