require('dotenv').config();
const connection = require('../config/databaseConnection');

// AFDV 1.5 User demographics
exports.demographics = async (req, res) => {
    const db = connection.promise();

    try {
        const checkUserQuery = 'SELECT u.role, COUNT(*) as count FROM users u GROUP BY u.role';
        const [results] = await db.execute(checkUserQuery);

        // Format the data
        const demographics = {};
        results.forEach(row => {
            demographics[row.role] = row.count;
        });

        res.status(200).json({
            data: demographics
        });
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// AFDV 1.4 Loyalty Program Analytics
exports.loyaltyProgramAnalytics = async (req, res) => {    
    const db = connection.promise();

    try {
        // Loyalty Program Data
        const loyaltyProgramDataQuery = `SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(DISTINCT customer_user_id) FROM bookings) AS users_with_bookings,
        (SELECT COUNT(*) FROM loyalty_memberships WHERE visits_count < 5)  AS bronze_status,
        (SELECT COUNT(*) FROM loyalty_memberships WHERE visits_count >= 5) AS golden_status,
        (SELECT COUNT(*) FROM available_rewards) as total_rewards, (SELECT COUNT(*) FROM available_rewards WHERE active = 0) as redeemed_rewards;
        `;
        const [loyaltyProgramData] = await db.execute(loyaltyProgramDataQuery);

        // Top 3 Performing Salons
        const top3PerformingSalonsQuery = 
        `SELECT 
        s.name AS salon_name,
        COUNT(DISTINCT lm.user_id) AS participants,
        COUNT(DISTINCT CASE WHEN lm.visits_count >= 5 THEN lm.user_id END) AS golden_members,
        SUM(lm.visits_count) AS total_visits,
        ROUND(AVG(lm.visits_count), 2) AS avg_visits_per_member
        FROM loyalty_memberships lm
        JOIN salons s ON s.salon_id = lm.salon_id
        GROUP BY s.salon_id, s.name
        ORDER BY participants DESC
        LIMIT 3;`;

        const [top3PerformingSalons] = await db.execute(top3PerformingSalonsQuery);

        // Multi Salon Memberships
        const multiSalonMembershipsQuery = 
        `SELECT COUNT(*) AS multi_salon_users
        FROM (
        SELECT user_id
        FROM loyalty_memberships
        GROUP BY user_id
        HAVING COUNT(*) > 1
        ) AS multi_salon_users;`

        const [multiSalonMemberships] = await db.execute(multiSalonMembershipsQuery);

        res.status(200).json({
            data: loyaltyProgramData[0],
            multiSalonMemberships: multiSalonMemberships[0].multi_salon_users,
            top3PerformingSalons: top3PerformingSalons,
        });
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};


