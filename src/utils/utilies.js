const { DateTime } = require('luxon');

function logUtcDebug(label, value) {
    if (process.env.UTC_DEBUG === '1') {
        const type = value instanceof DateTime ? 'DateTime' : typeof value;
        const printable = value instanceof DateTime ? value.toISO() : value;
        console.log(`[UTC DEBUG] ${label}:`, printable, `(type: ${type})`);
    }
}

const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
};

function toMySQLUtc(dt) {
    if (!(dt instanceof DateTime)) {
        throw new Error('toMySQLUtc requires a DateTime object');
    }
    return dt.toUTC().toFormat('yyyy-MM-dd HH:mm:ss');
}

function localAvailabilityToUtc(availabilityTime, dateStr, timezone) {
    if (!availabilityTime || !dateStr || !timezone) {
        throw new Error('localAvailabilityToUtc requires availabilityTime, dateStr, and timezone');
    }

    const [hours, minutes] = availabilityTime.split(':').map(Number);

    if (isNaN(hours) || isNaN(minutes)) {
        throw new Error(`Invalid time format: ${availabilityTime}`);
    }

    const localDt = DateTime.fromObject(
        {
            year: parseInt(dateStr.split('-')[0]),
            month: parseInt(dateStr.split('-')[1]),
            day: parseInt(dateStr.split('-')[2]),
            hour: hours,
            minute: minutes,
            second: 0,
            millisecond: 0
        },
        { zone: timezone }
    );

    if (!localDt.isValid) {
        throw new Error(`Invalid date or time: ${dateStr} ${availabilityTime} - ${localDt.invalidReason}`);
    }

    return localDt.toUTC();
}

const formatDateTime = (dt) => {
    if (!dt) return null;
    
    let dateTime;
    
    if (dt instanceof DateTime) {
        dateTime = dt;
    } else if (typeof dt === 'string') {
        const isNaiveMySQL = dt.includes(' ') && !dt.includes('T') && !/[zZ]|[+-]\d{2}:\d{2}$/.test(dt);
        if (isNaiveMySQL) {
            dateTime = DateTime.fromSQL(dt, { zone: 'utc' });
        } else {
            dateTime = DateTime.fromISO(dt);
        }
    } else {
        return String(dt);
    }
    
    if (!dateTime || !dateTime.isValid) {
        return String(dt);
    }
    
    return dateTime.toISO();
};

function utcToLocalDateString(dt, timezone) {
    if (!(dt instanceof DateTime)) {
        throw new Error('utcToLocalDateString requires a DateTime object');
    }
    return dt.setZone(timezone).toFormat('yyyy-MM-dd');
}

// Helper to convert Luxon weekday (1-7, Monday=1, Sunday=7) to database weekday (0-6, Sunday=0, Saturday=6)
function luxonWeekdayToDb(luxonWeekday) {
    // Luxon: 1=Monday, 2=Tuesday, ..., 6=Saturday, 7=Sunday
    // DB: 0=Sunday, 1=Monday, 2=Tuesday, ..., 6=Saturday
    return luxonWeekday === 7 ? 0 : luxonWeekday;
}

// Cleanup job for expired tokens every 15 minutes for more responsive cleanup
const startTokenCleanup = (connection) => {
    setInterval(async () => {
        try {
            const db = connection.promise();
            const currentUtc = toMySQLUtc(DateTime.utc());
            
            const getExpiredUsersQuery = `
                SELECT user_id 
                FROM auth_credentials 
                WHERE token_expires_at IS NOT NULL 
                AND token_expires_at < ?
            `;
            const [expiredUsers] = await db.execute(getExpiredUsersQuery, [currentUtc]);
            
            if (expiredUsers.length > 0) {
                const expiredUserIds = expiredUsers.map(user => user.user_id);
                const placeholders = expiredUserIds.map(() => '?').join(',');// Placeholders for the query
                
                const deactivateUsersQuery = `
                    UPDATE users 
                    SET active = 0 
                    WHERE user_id IN (${placeholders})
                    AND active = 1
                `;
                //const [userResult] = 
                await db.execute(deactivateUsersQuery, expiredUserIds);
                
                const clearTokensQuery = `
                    UPDATE auth_credentials 
                    SET token_expires_at = NULL 
                    WHERE user_id IN (${placeholders})
                    AND token_expires_at IS NOT NULL
                `;
                //const [tokenResult] = 
                await db.execute(clearTokensQuery, expiredUserIds);
                
                //console.log(`Cleanup: Deactivated ${userResult.affectedRows} users and cleared ${tokenResult.affectedRows} expired tokens`);
            }
        } catch (error) {
            //console.error('Cleanup job failed:', error);
        }
    }, 15 * 60 * 1000); // Every 15 minutes
};



// Cleanup job to auto-complete finished bookings every 1 hour
function startBookingsAutoComplete(connection) {
    setInterval(async () => {
        try {
            const db = connection.promise();
            //Small grace period
            const nowMinusGrace = DateTime.utc().minus({ minutes: 2 });
            const currentUtc = toMySQLUtc(nowMinusGrace);

            const updateQuery = `
                UPDATE bookings
                SET status = 'COMPLETED'
                WHERE status = 'SCHEDULED'
                  AND scheduled_end IS NOT NULL
                  AND scheduled_end < ?
            `;
            await db.execute(updateQuery, [currentUtc]);
        } catch (error) {
        }
    }, 60 * 60 * 1000); 
}

// Job to update loyalty_seen for completed bookings with past end times every 15 minutes
function startLoyaltySeenUpdate(connection) {
    setInterval(async () => {
        try {
            const db = connection.promise();
            const currentUtc = toMySQLUtc(DateTime.utc());

            const getCompletedBookingsQuery = `
                SELECT booking_id, customer_user_id, salon_id
                FROM bookings
                WHERE status = 'COMPLETED'
                  AND (loyalty_seen = 0 OR loyalty_seen IS NULL)
                  AND scheduled_end IS NOT NULL
                  AND scheduled_end < ?
            `;
            const [completedBookings] = await db.execute(getCompletedBookingsQuery, [currentUtc]);

            for (const booking of completedBookings) {
                try {
                    await db.beginTransaction();
                    
                    const checkMembershipQuery = `
                        SELECT membership_id, visits_count
                        FROM loyalty_memberships
                        WHERE user_id = ? AND salon_id = ?
                        FOR UPDATE
                    `;
                    const [membership] = await db.execute(checkMembershipQuery, [booking.customer_user_id, booking.salon_id]);

                    if (membership.length === 0) {
                        const nowUtc = toMySQLUtc(DateTime.utc());
                        const insertMembershipQuery = `
                            INSERT INTO loyalty_memberships (user_id, salon_id, visits_count, created_at, updated_at)
                            VALUES (?, ?, 0, ?, ?)
                        `;
                        await db.execute(insertMembershipQuery, [booking.customer_user_id, booking.salon_id, nowUtc, nowUtc]);
                    }

                    const nowUtc = toMySQLUtc(DateTime.utc());
                    const incrementVisitsQuery = `
                        UPDATE loyalty_memberships
                        SET visits_count = visits_count + 1, updated_at = ?
                        WHERE user_id = ? AND salon_id = ?
                    `;
                    await db.execute(incrementVisitsQuery, [nowUtc, booking.customer_user_id, booking.salon_id]);

                    const getLoyaltyProgramQuery = `
                        SELECT target_visits, discount_percentage, note
                        FROM loyalty_programs
                        WHERE salon_id = ? AND active = 1
                    `;
                    const [loyaltyProgram] = await db.execute(getLoyaltyProgramQuery, [booking.salon_id]);

                    if (loyaltyProgram.length > 0) {
                        const program = loyaltyProgram[0];
                        const target_visits = program.target_visits;

                        const [updatedMembership] = await db.execute(
                            `SELECT visits_count FROM loyalty_memberships WHERE user_id = ? AND salon_id = ?`,
                            [booking.customer_user_id, booking.salon_id]
                        );

                        if (updatedMembership.length > 0) {
                            const current_visits = updatedMembership[0].visits_count;

                            if (current_visits >= target_visits) {
                                const new_visits_count = current_visits - target_visits;

                                const currentUtc = toMySQLUtc(DateTime.utc());
                                const insertRewardQuery = `
                                    INSERT INTO available_rewards 
                                    (user_id, salon_id, active, discount_percentage, note, redeemed_at, creationDate, created_at, updated_at)
                                    VALUES (?, ?, 1, ?, ?, NULL, ?, ?, ?)
                                `;
                                await db.execute(insertRewardQuery, [
                                    booking.customer_user_id,
                                    booking.salon_id,
                                    program.discount_percentage,
                                    program.note,
                                    currentUtc,
                                    currentUtc,
                                    currentUtc
                                ]);

                                const resetVisitsQuery = `
                                    UPDATE loyalty_memberships
                                    SET visits_count = ?, updated_at = ?
                                    WHERE user_id = ? AND salon_id = ?
                                `;
                                await db.execute(resetVisitsQuery, [
                                    new_visits_count,
                                    currentUtc,
                                    booking.customer_user_id,
                                    booking.salon_id
                                ]);
                            }
                        }
                    }

                    const updateBookingQuery = `
                        UPDATE bookings
                        SET loyalty_seen = 1
                        WHERE booking_id = ?
                    `;
                    await db.execute(updateBookingQuery, [booking.booking_id]);

                    await db.commit();
                } catch (bookingError) {
                    await db.rollback();
                }
            }

            const updateCanceledQuery = `
                UPDATE bookings
                SET loyalty_seen = 2
                WHERE status = 'CANCELED'
                  AND (loyalty_seen != 2 OR loyalty_seen IS NULL)
            `;
            await db.execute(updateCanceledQuery);
        } catch (error) {
            //console.error('Loyalty seen update job failed:', error);
        }
    }, 15 * 60 * 1000); // Every 15 minutes 
}


// NC 1.1 - Job to send appointment reminders (24h, 1h, 15min before)
function startAppointmentReminders(connection) {
    setInterval(async () => {
        try {
            const db = connection.promise();
            const now = DateTime.utc();
            
            const queryStart = toMySQLUtc(now);
            const queryEnd = toMySQLUtc(now.plus({ hours: 25 }));
            
            const [bookings] = await db.execute(
                `SELECT 
                    b.booking_id,
                    b.customer_user_id,
                    b.salon_id,
                    DATE_FORMAT(b.scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
                    b.scheduled_start AS scheduled_start_raw,
                    u.email,
                    s.name AS salon_name
                 FROM bookings b
                 JOIN users u ON b.customer_user_id = u.user_id
                 JOIN salons s ON b.salon_id = s.salon_id
                 WHERE b.status = 'SCHEDULED'
                   AND b.scheduled_start > ?
                   AND b.scheduled_start <= ?`,
                [queryStart, queryEnd]
            );

            for (const booking of bookings) {
                const scheduledStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
                if (!scheduledStart.isValid) continue;

                const reminder24hWindowStart = now.plus({ hours: 23, minutes: 55 });
                const reminder24hWindowEnd = now.plus({ hours: 24, minutes: 5 });
                
                const reminder1hWindowStart = now.plus({ minutes: 55 });
                const reminder1hWindowEnd = now.plus({ minutes: 65 });
                
                const reminder15minWindowStart = now.plus({ minutes: 10 });
                const reminder15minWindowEnd = now.plus({ minutes: 20 });

                let reminderType = null;
                let message = '';
                let shouldSend = false;

                if (scheduledStart >= reminder24hWindowStart && scheduledStart <= reminder24hWindowEnd) {
                    reminderType = 'APPOINTMENT_REMINDER_24H';
                    message = `Reminder: You have an appointment at ${booking.salon_name} in 24 hours.`;
                    shouldSend = true;
                }
                else if (scheduledStart >= reminder1hWindowStart && scheduledStart <= reminder1hWindowEnd) {
                    reminderType = 'APPOINTMENT_REMINDER_1H';
                    message = `Reminder: You have an appointment at ${booking.salon_name} in 1 hour.`;
                    shouldSend = true;
                }
                else if (scheduledStart >= reminder15minWindowStart && scheduledStart <= reminder15minWindowEnd) {
                    reminderType = 'APPOINTMENT_REMINDER_15MIN';
                    message = `Reminder: You have an appointment at ${booking.salon_name} in 15 minutes.`;
                    shouldSend = true;
                }

                if (shouldSend && reminderType) {
                    const [existing] = await db.execute(
                        `SELECT notification_id 
                         FROM notifications_inbox 
                         WHERE booking_id = ? 
                           AND type_code = ? 
                           AND user_id = ?`,
                        [booking.booking_id, reminderType, booking.customer_user_id]
                    );

                    if (existing.length === 0) {
                        const nowUtc = toMySQLUtc(now);
                        await db.execute(
                            `INSERT INTO notifications_inbox 
                             (user_id, salon_id, email, booking_id, type_code, status, message, sender_email, created_at)
                             VALUES (?, ?, ?, ?, ?, 'UNREAD', ?, 'SYSTEM', ?)`,
                            [
                                booking.customer_user_id,
                                booking.salon_id,
                                booking.email,
                                booking.booking_id,
                                reminderType,
                                message,
                                nowUtc
                            ]
                        );
                    }
                }
            }
        } catch (error) {
            console.error('Appointment reminders job failed:', error);
        }
    }, 60 * 1000); // Run every minute
}

module.exports = {
    validateEmail,
    startTokenCleanup,
    startBookingsAutoComplete,
    toMySQLUtc,
    formatDateTime,
    startLoyaltySeenUpdate,
    startAppointmentReminders,
    logUtcDebug,
    localAvailabilityToUtc,
    utcToLocalDateString,
    luxonWeekdayToDb
};