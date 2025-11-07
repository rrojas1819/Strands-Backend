require('dotenv').config();
const connection = require('../config/databaseConnection');

// AFVD 1.1 User Engagement
exports.userEngagement = async (req, res) => {
    const db = connection.promise();

    try {
        const checkUserQuery = 
        `SELECT 
        (SELECT COUNT(*) FROM logins WHERE DATE(login_date) = CURDATE()) AS today_logins,
        (SELECT COUNT(*) FROM logins WHERE DATE(login_date) = CURDATE() - INTERVAL 1 DAY) AS yesterday_logins,
        (SELECT COUNT(*) FROM logins WHERE login_date >= CURDATE() - INTERVAL 7 DAY AND login_date < CURDATE()) AS past_week_logins,
        (SELECT COUNT(*) FROM logins WHERE login_date >= CURDATE() - INTERVAL 14 DAY AND login_date < CURDATE() - INTERVAL 7 DAY) AS previous_week_logins,
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
        ORDER BY participants DESC, golden_members DESC, avg_visits_per_member DESC
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

// AFDV 1.3 Salon Revenue Analytics
exports.salonRevenueAnalytics = async (req, res) => {
    const db = connection.promise();
    try {
        const perSalonRevenueAnalyticsQuery = 
        `SELECT 
        s.name AS salon_name,
        SUM(CASE WHEN p.status = 'SUCCEEDED' THEN p.amount ELSE 0 END) AS salon_revenue,
        SUM(CASE WHEN p.status = 'REFUNDED' THEN p.amount ELSE 0 END) AS refunded_amount
        FROM payments p
        LEFT JOIN orders o ON p.order_id = o.order_id
        LEFT JOIN bookings b ON p.booking_id = b.booking_id
        LEFT JOIN salons s ON s.salon_id = COALESCE(o.salon_id, b.salon_id)
        GROUP BY s.salon_id, s.name;`;
        const [perSalonRevenueAnalytics] = await db.execute(perSalonRevenueAnalyticsQuery);

        const platformRevenueAnalyticsQuery = 
        `SELECT 
        SUM(CASE WHEN status = 'SUCCEEDED' THEN amount ELSE 0 END) AS platform_revenue,
        SUM(CASE WHEN status = 'REFUNDED' THEN amount ELSE 0 END) AS refunded_amount,
        COUNT(CASE WHEN status = 'SUCCEEDED' THEN 1 END) AS total_successful,
        COUNT(CASE WHEN status = 'REFUNDED' THEN 1 END) AS total_refunded
        FROM payments;`;
        const [platformRevenueAnalytics] = await db.execute(platformRevenueAnalyticsQuery);
        

        const topSalonQuery = 
        `SELECT 
        s.name AS salon_name,
        SUM(CASE WHEN p.order_id IS NOT NULL THEN p.amount ELSE 0 END) AS product_revenue,
        SUM(CASE WHEN p.booking_id IS NOT NULL THEN p.amount ELSE 0 END) AS booking_revenue,
        SUM(p.amount) AS total_revenue
        FROM payments p
        LEFT JOIN orders o ON p.order_id = o.order_id
        LEFT JOIN bookings b ON p.booking_id = b.booking_id
        LEFT JOIN salons s ON s.salon_id = COALESCE(o.salon_id, b.salon_id)
        WHERE p.status = 'SUCCEEDED'
        GROUP BY s.salon_id, s.name
        ORDER BY total_revenue DESC
        LIMIT 1;`;
        const [topSalonResults] = await db.execute(topSalonQuery);

        const topProductQuery = 
        `SELECT 
            s.name AS salon_name,
            pr.name AS product_name,
            pr.price AS listing_price,
            SUM(oi.quantity) AS units_sold,
            SUM(oi.quantity * oi.purchase_price) AS total_revenue
        FROM order_items oi
        JOIN products pr ON oi.product_id = pr.product_id
        JOIN orders o ON oi.order_id = o.order_id
        JOIN salons s ON s.salon_id = pr.salon_id
        GROUP BY pr.product_id, pr.name, pr.price
        ORDER BY total_revenue DESC
        LIMIT 1;`;
        const [topProductResults] = await db.execute(topProductQuery);


        const topStylistQuery = 
        `SELECT 
        u.full_name AS stylist_name,
        s.name AS salon_name,
        SUM(p.amount) AS total_revenue,
        COUNT(DISTINCT bs.booking_id) AS total_bookings
        FROM booking_services bs
        JOIN employees e ON bs.employee_id = e.employee_id
        JOIN users u ON e.user_id = u.user_id
        JOIN salons s ON e.salon_id = s.salon_id
        JOIN bookings b ON bs.booking_id = b.booking_id
        JOIN payments p ON p.booking_id = b.booking_id
        WHERE p.status = 'SUCCEEDED'
        GROUP BY e.employee_id, u.full_name, s.name
        ORDER BY total_revenue DESC
        LIMIT 1;`;
        const [topStylistResults] = await db.execute(topStylistQuery);


        const topServicesQuery = 
        `SELECT 
        sv.name AS service_name,
        s.name AS salon_name,
        COUNT(DISTINCT bs.booking_id) AS times_booked,
        SUM(p.amount) AS total_revenue
        FROM payments p
        JOIN bookings b ON p.booking_id = b.booking_id
        JOIN booking_services bs ON b.booking_id = bs.booking_id
        JOIN services sv ON bs.service_id = sv.service_id
        JOIN salons s ON sv.salon_id = s.salon_id
        WHERE p.status = 'SUCCEEDED'
        GROUP BY sv.service_id, sv.name, s.name
        ORDER BY 
        total_revenue DESC,       
        times_booked DESC         
        LIMIT 5;`;
        const [topServicesResults] = await db.execute(topServicesQuery);

        res.status(200).json({
            perSalonRevenueAnalytics: perSalonRevenueAnalytics,
            platformRevenueAnalytics: platformRevenueAnalytics,
            topMetrics: {
                topSalon: topSalonResults[0],
                topProduct: topProductResults[0],
                topStylist: topStylistResults[0],
                topServices: topServicesResults,
            }
        });
        
    
    } catch (error) {
        console.error('salonRevenueAnalytics error:', error);
        res.status(500).json({
            message: "Internal server error"
        });
    }
};