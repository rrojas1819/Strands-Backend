const { DateTime } = require('luxon');
const notificationSecurity = require('./notificationsSecurity');

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

async function runTokenCleanup(connection) {
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
        console.error('Token cleanup job failed:', error);
    }
}



async function runBookingsAutoComplete(connection) {
    try {
        const db = connection.promise();
        const nowMinusGrace = DateTime.utc().minus({ minutes: 0.1 });
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
        console.error('Bookings auto-complete job failed:', error);
    }
}

async function runLoyaltySeenUpdate(connection) {
    try {
        const db = connection.promise();
        const currentUtc = toMySQLUtc(DateTime.utc());
        const nowUtc = toMySQLUtc(DateTime.utc());

        const getCompletedBookingsQuery = `
            SELECT booking_id, customer_user_id, salon_id
            FROM bookings
            WHERE status = 'COMPLETED'
              AND (loyalty_seen = 0 OR loyalty_seen IS NULL)
              AND scheduled_end IS NOT NULL
              AND scheduled_end < ?
        `;
        const [completedBookings] = await db.execute(getCompletedBookingsQuery, [currentUtc]);

        if (completedBookings.length === 0) {
            const updateCanceledQuery = `
                UPDATE bookings
                SET loyalty_seen = 2
                WHERE status = 'CANCELED'
                  AND (loyalty_seen != 2 OR loyalty_seen IS NULL)
            `;
            await db.execute(updateCanceledQuery);
            return;
        }

        const uniqueUserSalonPairs = Array.from(
            new Set(completedBookings.map(b => `${b.customer_user_id}:${b.salon_id}`))
        ).map(pair => {
            const [user_id, salon_id] = pair.split(':');
            return { user_id: parseInt(user_id), salon_id: parseInt(salon_id) };
        });

        if (uniqueUserSalonPairs.length > 0) {
            const membershipValues = uniqueUserSalonPairs.map(() => '(?, ?, 0, 0, ?, ?)').join(',');
            const membershipParams = uniqueUserSalonPairs.flatMap(pair => [pair.user_id, pair.salon_id, nowUtc, nowUtc]);
            
            const bulkInsertMembershipQuery = `
                INSERT IGNORE INTO loyalty_memberships (user_id, salon_id, visits_count, total_visits_count, created_at, updated_at)
                VALUES ${membershipValues}
            `;
            await db.execute(bulkInsertMembershipQuery, membershipParams);
        }

        const salonIds = Array.from(new Set(completedBookings.map(b => b.salon_id)));
        const salonPlaceholders = salonIds.map(() => '?').join(',');
        
        const getLoyaltyProgramsQuery = `
            SELECT salon_id, target_visits, discount_percentage, note
            FROM loyalty_programs
            WHERE salon_id IN (${salonPlaceholders}) AND active = 1
        `;
        const [loyaltyPrograms] = await db.execute(getLoyaltyProgramsQuery, salonIds);
        const programsBySalon = {};
        loyaltyPrograms.forEach(program => {
            programsBySalon[program.salon_id] = program;
        });

        const membershipPlaceholders = uniqueUserSalonPairs.map(() => '(?, ?)').join(',');
        const membershipParams = uniqueUserSalonPairs.flatMap(pair => [pair.user_id, pair.salon_id]);
        
        const getInitialMembershipsQuery = `
            SELECT user_id, salon_id, visits_count
            FROM loyalty_memberships
            WHERE (user_id, salon_id) IN (${membershipPlaceholders})
        `;
        const [initialMemberships] = await db.execute(getInitialMembershipsQuery, membershipParams);
        
        const initialMembershipsByKey = {};
        initialMemberships.forEach(m => {
            const key = `${m.user_id}:${m.salon_id}`;
            initialMembershipsByKey[key] = m;
        });

        const bookingsByUserSalon = {};
        completedBookings.forEach(booking => {
            const key = `${booking.customer_user_id}:${booking.salon_id}`;
            if (!bookingsByUserSalon[key]) {
                bookingsByUserSalon[key] = [];
            }
            bookingsByUserSalon[key].push(booking);
        });

        const rewardsToInsert = [];
        const visitsUpdates = [];
        const bookingIds = [];

        for (const [key, bookings] of Object.entries(bookingsByUserSalon)) {
            const [user_id, salon_id] = key.split(':').map(Number);
            const program = programsBySalon[salon_id];
            
            if (!program) {
                bookings.forEach(b => bookingIds.push(b.booking_id));
                continue;
            }

            let currentVisits = initialMembershipsByKey[key]?.visits_count || 0;
            const targetVisits = program.target_visits;
            let totalIncrement = 0;

            for (const booking of bookings) {
                bookingIds.push(booking.booking_id);
                currentVisits += 1;
                totalIncrement += 1;

                if (currentVisits >= targetVisits) {
                    const newVisitsCount = currentVisits - targetVisits;
                    rewardsToInsert.push({
                        user_id: user_id,
                        salon_id: salon_id,
                        discount_percentage: program.discount_percentage,
                        note: program.note
                    });
                    currentVisits = newVisitsCount;
                }
            }

            visitsUpdates.push({
                user_id: user_id,
                salon_id: salon_id,
                final_visits_count: currentVisits,
                total_increment: totalIncrement
            });
        }

        if (visitsUpdates.length > 0) {
            const totalVisitsCases = visitsUpdates.map(v => 
                `WHEN user_id = ${v.user_id} AND salon_id = ${v.salon_id} THEN total_visits_count + ${v.total_increment}`
            ).join(' ');
            const totalVisitsWherePairs = visitsUpdates.map(v => 
                `(user_id = ${v.user_id} AND salon_id = ${v.salon_id})`
            ).join(' OR ');
            
            const bulkIncrementTotalVisitsQuery = `
                UPDATE loyalty_memberships
                SET total_visits_count = CASE ${totalVisitsCases} ELSE total_visits_count END,
                    updated_at = ?
                WHERE ${totalVisitsWherePairs}
            `;
            await db.execute(bulkIncrementTotalVisitsQuery, [nowUtc]);
        }

        if (visitsUpdates.length > 0) {
            const visitsCases = visitsUpdates.map(v => 
                `WHEN user_id = ${v.user_id} AND salon_id = ${v.salon_id} THEN ${v.final_visits_count}`
            ).join(' ');
            const visitsWherePairs = visitsUpdates.map(v => 
                `(user_id = ${v.user_id} AND salon_id = ${v.salon_id})`
            ).join(' OR ');
            
            const bulkUpdateVisitsQuery = `
                UPDATE loyalty_memberships
                SET visits_count = CASE ${visitsCases} END,
                    updated_at = ?
                WHERE ${visitsWherePairs}
            `;
            await db.execute(bulkUpdateVisitsQuery, [nowUtc]);
        }

        if (rewardsToInsert.length > 0) {
            const rewardValues = rewardsToInsert.map(() => '(?, ?, 1, ?, ?, NULL, ?, ?, ?)').join(',');
            const rewardParams = rewardsToInsert.flatMap(r => [
                r.user_id,
                r.salon_id,
                r.discount_percentage,
                r.note,
                nowUtc,
                nowUtc,
                nowUtc
            ]);
            
            const bulkInsertRewardsQuery = `
                INSERT INTO available_rewards 
                (user_id, salon_id, active, discount_percentage, note, redeemed_at, creationDate, created_at, updated_at)
                VALUES ${rewardValues}
            `;
            await db.execute(bulkInsertRewardsQuery, rewardParams);
        }

        if (bookingIds.length > 0) {
            const bookingPlaceholders = bookingIds.map(() => '?').join(',');
            const bulkUpdateBookingsQuery = `
                UPDATE bookings
                SET loyalty_seen = 1
                WHERE booking_id IN (${bookingPlaceholders})
            `;
            await db.execute(bulkUpdateBookingsQuery, bookingIds);
        }

        const updateCanceledQuery = `
            UPDATE bookings
            SET loyalty_seen = 2
            WHERE status = 'CANCELED'
              AND (loyalty_seen != 2 OR loyalty_seen IS NULL)
        `;
        await db.execute(updateCanceledQuery);
    } catch (error) {
        console.error('Loyalty seen update job failed:', error);
    }
}


// NC 1.1 - Job to send appointment reminders (24h, 1h, 15min before) - executes once when called
async function runAppointmentReminders(connection) {
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
                DATE_FORMAT(b.scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
                b.scheduled_start AS scheduled_start_raw,
                u.email,
                s.name AS salon_name,
                s.timezone AS salon_timezone,
                GROUP_CONCAT(
                    DISTINCT CONCAT(sv.name, '|', COALESCE(bs.duration_minutes, ''))
                    ORDER BY sv.name
                    SEPARATOR '||'
                ) AS services_data,
                MAX(stylist_user.full_name) AS stylist_name
             FROM bookings b
             JOIN users u ON b.customer_user_id = u.user_id
             JOIN salons s ON b.salon_id = s.salon_id
             LEFT JOIN booking_services bs ON b.booking_id = bs.booking_id
             LEFT JOIN services sv ON bs.service_id = sv.service_id
             LEFT JOIN employees e ON bs.employee_id = e.employee_id
             LEFT JOIN users stylist_user ON e.user_id = stylist_user.user_id
             WHERE b.status = 'SCHEDULED'
               AND b.scheduled_start > ?
               AND b.scheduled_start <= ?
             GROUP BY b.booking_id, b.customer_user_id, b.salon_id, b.scheduled_start, b.scheduled_end, 
                      u.email, s.name, s.timezone`,
            [queryStart, queryEnd]
        );

        if (bookings.length === 0) {
            return;
        }

        const bookingIds = bookings.map(b => b.booking_id);
        const bookingPlaceholders = bookingIds.map(() => '?').join(',');
        const [existingNotifications] = await db.execute(
            `SELECT booking_id, type_code, user_id
             FROM notifications_inbox 
             WHERE booking_id IN (${bookingPlaceholders})
               AND type_code IN ('APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H', 'APPOINTMENT_REMINDER_15MIN')`,
            bookingIds
        );
        
        const existingNotificationsSet = new Set();
        existingNotifications.forEach(notif => {
            const key = `${notif.booking_id}:${notif.type_code}:${notif.user_id}`;
            existingNotificationsSet.add(key);
        });

        const notificationsToInsert = [];

        for (const booking of bookings) {
            const scheduledStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
            const scheduledEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
            if (!scheduledStart.isValid) continue;

            // Calculate time difference between appointment and now (in minutes)
            const diffMinutes = scheduledStart.diff(now, 'minutes').minutes;

            let reminderType = null;
            let timeUntil = '';
            let shouldSend = false;
            const windowSize = 3; // 3-minute window

            // Check if appointment is approximately 24 hours away (1437-1440 minutes, 3-minute window)
            if (diffMinutes >= (1440 - windowSize) && diffMinutes <= 1440) {
                reminderType = 'APPOINTMENT_REMINDER_24H';
                timeUntil = '24 hours';
                shouldSend = true;
            }
            // Check if appointment is approximately 1 hour away (57-60 minutes, 3-minute window)
            else if (diffMinutes >= (60 - windowSize) && diffMinutes <= 60) {
                reminderType = 'APPOINTMENT_REMINDER_1H';
                timeUntil = '1 hour';
                shouldSend = true;
            }
            // Check if appointment is approximately 15 minutes away (12-15 minutes, 3-minute window)
            else if (diffMinutes >= (15 - windowSize) && diffMinutes <= 15) {
                reminderType = 'APPOINTMENT_REMINDER_15MIN';
                timeUntil = '15 minutes';
                shouldSend = true;
            }

            if (shouldSend && reminderType) {
                const notificationKey = `${booking.booking_id}:${reminderType}:${booking.customer_user_id}`;
                
                if (!existingNotificationsSet.has(notificationKey)) {
                    const services = [];
                    if (booking.services_data) {
                        const servicePairs = booking.services_data.split('||');
                        servicePairs.forEach(pair => {
                            const [service_name, duration_minutes] = pair.split('|');
                            if (service_name) {
                                services.push({
                                    service_name: service_name,
                                    duration_minutes: duration_minutes ? parseInt(duration_minutes) : null
                                });
                            }
                        });
                    }

                    const stylistName = booking.stylist_name || null;
                    const salonTimezone = booking.salon_timezone || 'America/New_York';
                    
                    const bookingStartLocal = scheduledStart.setZone(salonTimezone);
                    const bookingEndLocal = scheduledEnd.setZone(salonTimezone);
                    
                    const appointmentDate = bookingStartLocal.toFormat('EEEE, MMMM d, yyyy');
                    const appointmentTime = bookingStartLocal.toFormat('h:mm a');
                    const appointmentEndTime = bookingEndLocal.toFormat('h:mm a');
                    
                    let message = `Reminder: You have an appointment at ${booking.salon_name}${stylistName ? ` with ${stylistName}` : ''} in ${timeUntil}.\n\n`;
                    message += `Date: ${appointmentDate}\n`;
                    message += `Time: ${appointmentTime} - ${appointmentEndTime}\n`;
                    
                    if (services.length > 0) {
                        message += `\nServices:\n`;
                        services.forEach((service) => {
                            message += `- ${service.service_name}`;
                            if (service.duration_minutes) {
                                message += ` (${service.duration_minutes} min)`;
                            }
                            message += `\n`;
                        });
                    }

                    // Truncate message if too long (max 500 chars)
                    if (message.length > 500) {
                        message = message.substring(0, 497) + '...';
                    }

                    let encryptedMessage;
                    try {
                        encryptedMessage = notificationSecurity.encryptMessage(message.trim());
                    } catch (encryptError) {
                        console.error('Failed to encrypt appointment reminder notification message:', encryptError);
                        throw new Error('Failed to encrypt notification message');
                    }

                    notificationsToInsert.push({
                        user_id: booking.customer_user_id,
                        salon_id: booking.salon_id,
                        email: booking.email,
                        booking_id: booking.booking_id,
                        type_code: reminderType,
                        message: encryptedMessage
                    });
                }
            }
        }

        if (notificationsToInsert.length > 0) {
            const nowUtc = toMySQLUtc(now);
            const notificationValues = notificationsToInsert.map(() => 
                '(?, ?, ?, ?, ?, \'UNREAD\', ?, \'SYSTEM\', ?)'
            ).join(',');
            const notificationParams = notificationsToInsert.flatMap(notif => [
                notif.user_id,
                notif.salon_id,
                notif.email,
                notif.booking_id,
                notif.type_code,
                notif.message,
                nowUtc
            ]);
            
            await db.execute(
                `INSERT INTO notifications_inbox 
                 (user_id, salon_id, email, booking_id, type_code, status, message, sender_email, created_at)
                 VALUES ${notificationValues}`,
                notificationParams
            );
        }
    } catch (error) {
        console.error('Appointment reminders job failed:', error);
    }
}

// NC 1.3 - Job to send notifications about unused promos and rewards - executes once when called
async function runUnusedOffersReminders(connection) {
    try {
        const db = connection.promise();
        const notificationsController = require('../controllers/notificationsController');
        await notificationsController.sendUnusedOffersNotifications(db);
    } catch (error) {
        console.error('Unused offers reminders job failed:', error);
    }
}

async function runExpirePromoCodes(connection) {
    try {
        const db = connection.promise();
        const now = DateTime.utc();
        const nowUtc = toMySQLUtc(now);

        const [result] = await db.execute(
            `UPDATE user_promotions 
             SET status = 'EXPIRED'
             WHERE status = 'ISSUED' 
               AND expires_at IS NOT NULL 
               AND expires_at <= ?`,
            [nowUtc]
        );

        if (result.affectedRows > 0 && process.env.NODE_ENV !== 'test') {
            console.log(`Expired ${result.affectedRows} promo code(s) at ${now.toISO()}`);
        }
    } catch (error) {
        console.error('Expire promo codes job failed:', error);
    }
}

// Job to delete temporary credit cards after all associated bookings have passed - executes once when called
async function runTempCreditCardCleanup(connection) {
    try {
        const db = connection.promise();
        const now = DateTime.utc();
        const nowUtc = toMySQLUtc(now);

        const [cardsToDelete] = await db.execute(
            `SELECT cc.credit_card_id
             FROM credit_cards cc
             WHERE cc.is_temporary = TRUE
               AND NOT EXISTS (
                   SELECT 1
                   FROM payments p
                   INNER JOIN bookings b ON p.booking_id = b.booking_id
                   WHERE p.credit_card_id = cc.credit_card_id
                     AND p.booking_id IS NOT NULL
                     AND (
                         (b.status != 'COMPLETED' AND b.scheduled_end IS NOT NULL AND b.scheduled_end > ?)
                         OR
                         (b.status IN ('SCHEDULED', 'PENDING') AND (b.scheduled_end IS NULL OR b.scheduled_end > ?))
                     )
               )`,
            [nowUtc, nowUtc]
        );

        if (cardsToDelete.length > 0) {
            const cardIds = cardsToDelete.map(card => card.credit_card_id);
            const deletePlaceholders = cardIds.map(() => '?').join(',');
            
            const [deleteResult] = await db.execute(
                `DELETE FROM credit_cards 
                 WHERE credit_card_id IN (${deletePlaceholders}) 
                   AND is_temporary = TRUE`,
                cardIds
            );

            if (deleteResult.affectedRows > 0 && process.env.NODE_ENV !== 'test') {
                console.log(`Deleted ${deleteResult.affectedRows} temporary credit card(s) at ${now.toISO()}`);
            }
        }
    } catch (error) {
        console.error('Temp credit card cleanup job failed:', error);
    }
}

module.exports = {
    validateEmail,
    runTokenCleanup,
    runBookingsAutoComplete,
    toMySQLUtc,
    formatDateTime,
    runLoyaltySeenUpdate,
    runAppointmentReminders,
    runUnusedOffersReminders,
    runExpirePromoCodes,
    runTempCreditCardCleanup,
    logUtcDebug,
    localAvailabilityToUtc,
    utcToLocalDateString,
    luxonWeekdayToDb
};