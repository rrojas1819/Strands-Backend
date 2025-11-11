function logUtcDebug(label, value) {
    if (process.env.UTC_DEBUG === '1') {
        const type = value instanceof Date ? 'Date' : typeof value;
        const printable =
            value instanceof Date ? value.toISOString() : value;
        console.log(`[UTC DEBUG] ${label}:`, printable, `(type: ${type})`);
    }
}

const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
};

function toMySQLUtc(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}


function localAvailabilityToUtc(availabilityTime, dateStr, timezone) {
    if (!availabilityTime || !dateStr || !timezone) {
        throw new Error('localAvailabilityToUtc requires availabilityTime, dateStr, and timezone');
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = availabilityTime.split(':').map(Number);

    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
        throw new Error(`Invalid date or time format: ${dateStr} ${availabilityTime}`);
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    
    const targetDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
    const dayRangeMs = nextDay.getTime() - targetDate.getTime();
    
    let low = targetDate.getTime();
    let high = nextDay.getTime();
    const targetHour = String(hours).padStart(2, '0');
    const targetMin = String(minutes).padStart(2, '0');
    const targetYear = String(year).padStart(4, '0');
    const targetMonth = String(month).padStart(2, '0');
    const targetDay = String(day).padStart(2, '0');
    
    for (let iter = 0; iter < 50; iter++) {
        const mid = Math.floor((low + high) / 2);
        const testUtc = new Date(mid);
        const parts = formatter.formatToParts(testUtc);
        const fYear = parts.find(p => p.type === 'year').value;
        const fMonth = parts.find(p => p.type === 'month').value;
        const fDay = parts.find(p => p.type === 'day').value;
        const fHour = parts.find(p => p.type === 'hour').value;
        const fMinute = parts.find(p => p.type === 'minute').value;
        
        const dateMatch = fYear === targetYear && fMonth === targetMonth && fDay === targetDay;
        const timeMatch = fHour === targetHour && fMinute === targetMin;
        
        if (dateMatch && timeMatch) {
            return testUtc;
        }
        
        if (!dateMatch || (dateMatch && (fHour < targetHour || (fHour === targetHour && fMinute < targetMin)))) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
        
        if (low >= high) break;
    }
    
    const startMs = targetDate.getTime();
    const endMs = nextDay.getTime();
    const stepMs = 60 * 1000;
    
    for (let ms = startMs; ms < endMs; ms += stepMs) {
        const testUtc = new Date(ms);
        const parts = formatter.formatToParts(testUtc);
        const fYear = parts.find(p => p.type === 'year').value;
        const fMonth = parts.find(p => p.type === 'month').value;
        const fDay = parts.find(p => p.type === 'day').value;
        const fHour = parts.find(p => p.type === 'hour').value;
        const fMinute = parts.find(p => p.type === 'minute').value;
        
        if (fYear === targetYear && fMonth === targetMonth && fDay === targetDay &&
            fHour === targetHour && fMinute === targetMin) {
            return testUtc;
        }
    }
    
    const midnightUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const midnightParts = formatter.formatToParts(midnightUtc);
    const midnightLocalHour = parseInt(midnightParts.find(p => p.type === 'hour').value);
    const offsetHours = -midnightLocalHour;
    
    return new Date(Date.UTC(year, month - 1, day, hours + offsetHours, minutes, 0, 0));
}

const formatDateTime = (timeStr) => {
    if (!timeStr) return null;
    if (timeStr instanceof Date) {
        return timeStr.toISOString();
    }
    let parsedInput = timeStr;
    if (typeof timeStr === 'string') {
        const isNaiveMySQL = timeStr.includes(' ') && !timeStr.includes('T') && !/[zZ]|[+-]\d{2}:\d{2}$/.test(timeStr);
        if (isNaiveMySQL) {
            // Convert 'YYYY-MM-DD HH:mm:ss' -> 'YYYY-MM-DDTHH:mm:ssZ' (treat as UTC)
            parsedInput = `${timeStr.replace(' ', 'T')}Z`;
        }
    }
    const date = new Date(parsedInput);
    if (!isNaN(date.getTime())) {
        return date.toISOString();
    }
    return String(timeStr);
};

// Cleanup job for expired tokens every 15 minutes for more responsive cleanup
const startTokenCleanup = (connection) => {
    setInterval(async () => {
        try {
            const db = connection.promise();
            
            const getExpiredUsersQuery = `
                SELECT user_id 
                FROM auth_credentials 
                WHERE token_expires_at IS NOT NULL 
                AND token_expires_at < NOW()
            `;
            const [expiredUsers] = await db.execute(getExpiredUsersQuery);
            
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
            const GRACE_MS = 2 * 60 * 1000; // 2 minutes
            const nowMinusGrace = new Date(Date.now() - GRACE_MS);
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
            const currentUtc = toMySQLUtc(new Date());

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
                        const insertMembershipQuery = `
                            INSERT INTO loyalty_memberships (user_id, salon_id, visits_count, created_at, updated_at)
                            VALUES (?, ?, 0, NOW(), NOW())
                        `;
                        await db.execute(insertMembershipQuery, [booking.customer_user_id, booking.salon_id]);
                    }

                    const incrementVisitsQuery = `
                        UPDATE loyalty_memberships
                        SET visits_count = visits_count + 1, updated_at = NOW()
                        WHERE user_id = ? AND salon_id = ?
                    `;
                    await db.execute(incrementVisitsQuery, [booking.customer_user_id, booking.salon_id]);

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

                                const currentUtc = toMySQLUtc(new Date());
                                const insertRewardQuery = `
                                    INSERT INTO available_rewards 
                                    (user_id, salon_id, active, discount_percentage, note, redeemed_at, creationDate, created_at, updated_at)
                                    VALUES (?, ?, 1, ?, ?, NULL, ?, NOW(), NOW())
                                `;
                                await db.execute(insertRewardQuery, [
                                    booking.customer_user_id,
                                    booking.salon_id,
                                    program.discount_percentage,
                                    program.note,
                                    currentUtc
                                ]);

                                const resetVisitsQuery = `
                                    UPDATE loyalty_memberships
                                    SET visits_count = ?, updated_at = NOW()
                                    WHERE user_id = ? AND salon_id = ?
                                `;
                                await db.execute(resetVisitsQuery, [
                                    new_visits_count,
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

function utcToLocalDateString(utcDate, timezone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    
    const parts = formatter.formatToParts(utcDate);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    
    return `${year}-${month}-${day}`;
}

module.exports = {
    validateEmail,
    startTokenCleanup,
    startBookingsAutoComplete,
    toMySQLUtc,
    formatDateTime,
    startLoyaltySeenUpdate,
    logUtcDebug,
    localAvailabilityToUtc,
    utcToLocalDateString
};