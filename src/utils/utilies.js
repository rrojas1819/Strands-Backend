
const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
};

// Format a JS Date as local SQL datetime (YYYY-MM-DD HH:mm:ss) -- for SQL logic
function toLocalSQL(dt) {
    const Y = dt.getFullYear();
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    const H = String(dt.getHours()).padStart(2, '0');
    const MI = String(dt.getMinutes()).padStart(2, '0');
    const S = String(dt.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D} ${H}:${MI}:${S}`;
}

//format time with a 'T' separating the date and time -- for JSON responses
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

module.exports = {
    validateEmail,
    startTokenCleanup,
    startBookingsAutoComplete,
    toLocalSQL,
    formatDateTime
};

// Cleanup job to auto-complete finished bookings every 1 hour
function startBookingsAutoComplete(connection) {
    setInterval(async () => {
        try {
            const db = connection.promise();
            //Small grace period
            const GRACE_MS = 2 * 60 * 1000; // 2 minutes
            const nowMinusGrace = new Date(Date.now() - GRACE_MS);
            const currentLocal = toLocalSQL(nowMinusGrace);

            const updateQuery = `
                UPDATE bookings
                SET status = 'COMPLETED'
                WHERE status = 'SCHEDULED'
                  AND scheduled_end IS NOT NULL
                  AND scheduled_end < ?
            `;
            await db.execute(updateQuery, [currentLocal]);
        } catch (error) {
        }
    }, 60 * 60 * 1000); 
}
