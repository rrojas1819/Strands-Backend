require('dotenv').config();
const connection = require('../config/databaseConnection');

// AFVD 1.1 User Engagement
exports.userEngagement = async (req, res) => {
    const db = connection.promise();

    try {
        const checkUserQuery = `
        SELECT 
        (SELECT COUNT(*) FROM users WHERE DATE(last_login_at) = CURDATE()) as today_logins,
        (SELECT COUNT(*) FROM users WHERE DATE(last_login_at) = CURDATE() - INTERVAL 1 DAY) as yesterday_logins,
        (SELECT COUNT(*) FROM users WHERE last_login_at >= CURDATE() - INTERVAL 7 DAY AND last_login_at <  CURDATE()) AS past_week_logins,
        (SELECT COUNT(*) FROM users WHERE last_login_at >= CURDATE() - INTERVAL 14 DAY AND last_login_at <  CURDATE() - INTERVAL 7 DAY) AS previous_week_logins,
        (SELECT COUNT(*) FROM bookings) as total_bookings,
        (SELECT COUNT(*) AS total_repeat_users FROM ( SELECT salon_id, customer_user_id FROM bookings WHERE status IN ('SCHEDULED', 'COMPLETED') GROUP BY salon_id, customer_user_id HAVING COUNT(*) >= 2) AS repeats) AS repeat_bookers;
        `;
        const [results] = await db.execute(checkUserQuery);

        const top3ServicesQuery = `(SELECT s.name, COUNT(*) AS total_bookings FROM booking_services bs JOIN bookings b ON bs.booking_id = b.booking_id JOIN services s ON s.service_id = bs.service_id WHERE b.status IN ('SCHEDULED', 'COMPLETED') GROUP BY s.name ORDER BY total_bookings DESC LIMIT 3);`;
        const [top3Services] = await db.execute(top3ServicesQuery);

        const top3ViewedSalonsQuery = `SELECT s.name, sc.clicks FROM salon_clicks sc JOIN salons s ON s.salon_id = sc.salon_id WHERE event_name = 'view_details_click' ORDER BY clicks DESC LIMIT 3;`;
        const [top3ViewedSalons] = await db.execute(top3ViewedSalonsQuery);

        res.status(200).json({
            data: { ...results[0], top3Services, top3ViewedSalons }
        });
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

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

function hourLabel(h) {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
  }

// AFDV 1.2 Appointment Analytics
exports.appointmentAnalytics = async (req, res) => {
    const db = connection.promise();
    try {
        const appointmentsByDayQuery = 
        `SELECT
            dw AS day_idx,
            day_name,
            total_appointments
            FROM (
            SELECT
                DAYOFWEEK(scheduled_start) AS dw,
                DAYNAME(scheduled_start)   AS day_name,
                COUNT(*)                   AS total_appointments
            FROM bookings
            WHERE status IN ('SCHEDULED','COMPLETED')
            GROUP BY DAYOFWEEK(scheduled_start), DAYNAME(scheduled_start)
            ) t
            ORDER BY day_idx;`;
        const [appointmentsByDay] = await db.execute(appointmentsByDayQuery);

        const appointmentsByDayMap = appointmentsByDay.reduce((acc, row) => {
            acc[row.day_name] = row.total_appointments;
            return acc;
        }, {});

        const peakHoursQuery = `
        SELECT HOUR(scheduled_start) AS hour_24, COUNT(*) AS total_appointments
        FROM bookings
        WHERE status IN ('SCHEDULED','COMPLETED')
        GROUP BY HOUR(scheduled_start)
        ORDER BY hour_24;`;
        const [peakHours] = await db.execute(peakHoursQuery);

        const peakHoursMap = {};
        for (let h = 0; h < 24; h++) {
            peakHoursMap[hourLabel(h)] = 0;
        }
        peakHours.forEach(row => {
            peakHoursMap[hourLabel(row.hour_24)] = row.total_appointments;
        });

        const avgDurationQuery = 
        `SELECT AVG(total_duration) AS avg_duration
        FROM (
        SELECT booking_id, SUM(duration_minutes) AS total_duration
        FROM booking_services
        WHERE booking_id IN (
            SELECT booking_id 
            FROM bookings 
            WHERE status IN ('SCHEDULED','COMPLETED')
        )
        GROUP BY booking_id
        ) AS res;`;
        const [avgDuration] = await db.execute(avgDurationQuery);


        res.status(200).json({
            appointmentsByDay: appointmentsByDayMap,
            peakHours: peakHoursMap,
            avgDurationInMin: avgDuration[0].avg_duration
        });
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

