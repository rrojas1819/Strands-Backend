
const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
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
    startTokenCleanup
};
