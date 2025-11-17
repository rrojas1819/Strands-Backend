require('dotenv').config();
const bcrypt = require('bcrypt');
const connection = require('../config/databaseConnection');
const { generateToken } = require('../middleware/auth.middleware');
const { validateEmail, toMySQLUtc, formatDateTime, logUtcDebug, luxonWeekdayToDb } = require('../utils/utilies');
const { DateTime } = require('luxon');

// Global constants
const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// User Sign Up
exports.signUp = async (req, res) => {
    const db = connection.promise();
    
    try {
        const { full_name, email, role, password } = req.body;

        // Input validation
        if (!full_name || !email || !role || !password) {
            return res.status(400).json({
                message: "All fields are required"
            });
        }

        // Validate password strength *REVIST WITH FRONTEND*
        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters long"
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                message: "Invalid email format"
            }); 
        }

        // Validate role
        const validRoles = ['ADMIN', 'OWNER', 'CUSTOMER', 'EMPLOYEE'];
        if (!validRoles.includes(role.toUpperCase())) {
            return res.status(400).json({
                message: "Invalid role"
            });
        }

        // Check if user already exists
        const checkUserQuery = 'SELECT user_id FROM users WHERE email = ?';
        const [existingUsers] = await connection.promise().execute(checkUserQuery, [email]);
        
        if (existingUsers.length > 0) {
            return res.status(409).json({
                message: "Invalid credentials or account cannot be created"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT));


        // Database Operations
        await db.beginTransaction();
        
        const nowUtc = toMySQLUtc(DateTime.utc());
        const insertUserQuery = `
            INSERT INTO users (full_name, email, phone, profile_picture_url, role, last_login_at, active, created_at, updated_at)
            VALUES (?, ?, NULL, NULL, ?, ?, 1, ?, ?)
        `;
        const [userRes] = await db.execute(insertUserQuery, [full_name, email, role, nowUtc, nowUtc, nowUtc]);

        const userId = userRes.insertId;

        const insertAuthQuery = `
            INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?)
        `;
        await db.execute(insertAuthQuery, [userId, hashedPassword, nowUtc, nowUtc]);
  
        await db.commit();

        // Return success response without token
        res.status(201).json({
            message: "User signed up successfully",
        });

    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// User Login
exports.login = async (req, res) => {
    const db = connection.promise();
    /*Not adding the token login in the beginning, but will have the token generated after the users logins.
    Not adding the ability to refresh tokens, or reset passwords etc, unless asked by Professor.
    */

    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }
        // Validate email format Utility Function!
        if (!validateEmail(email)) {
            return res.status(400).json({
                message: "Invalid email format"
            });
        }

        const checkUserQuery = 'SELECT user_id, role, full_name FROM users WHERE email = ?';
        const [existingUsers] = await db.execute(checkUserQuery, [email]);

        if (existingUsers.length === 0) {
            return res.status(401).json({
                message: "Invalid credentials"
            });
        }
        
        const checkAuthQuery = 'SELECT password_hash FROM auth_credentials WHERE user_id = ?';
        const [authCredentials] = await db.execute(checkAuthQuery, [existingUsers[0].user_id]);
        

        const isPasswordValid = await bcrypt.compare(password, authCredentials[0].password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({
                message: "Invalid credentials"
            });
        }

        // Activate user if not already active
        const activateUserQuery = 'UPDATE users SET active = 1 WHERE user_id = ? AND active != 1';
        await db.execute(activateUserQuery, [existingUsers[0].user_id]);

        // Update last login time
        const nowUtc = toMySQLUtc(DateTime.utc());
        const updateLoginQuery = 'UPDATE users SET last_login_at = ? WHERE user_id = ?';
        await db.execute(updateLoginQuery, [nowUtc, existingUsers[0].user_id]);

        const tokenPayload = {
            user_id: existingUsers[0].user_id,
            role: existingUsers[0].role.toUpperCase(),
            full_name: existingUsers[0].full_name
        };

        const token = generateToken(tokenPayload);
        
        // Store token expiration time (2 hours from now)
        const tokenExpiry = DateTime.utc().plus({ hours: 2 });
        const updateTokenQuery = 'UPDATE auth_credentials SET token_expires_at = ? WHERE user_id = ?';
        await db.execute(updateTokenQuery, [toMySQLUtc(tokenExpiry), existingUsers[0].user_id]);


        // Track login
        const trackLoginQuery = 'INSERT INTO logins (user_id, login_date) VALUES (?, ?)';
        await db.execute(trackLoginQuery, [existingUsers[0].user_id, nowUtc]);

        res.status(200).json({
            message: "Login successful",
            data: {
                user_id: existingUsers[0].user_id,
                full_name: existingUsers[0].full_name,
                role: existingUsers[0].role,
                token: token
            }
        });
        
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// User Logout
/* Token will not be invalidated, but the user will be set as inactive. 
    Frontend will handle the token deletion and redirect to login page after calling this endpoint.
*/
exports.logout = async (req, res) => {
    const db = connection.promise();
    
    try {
        // Get user_id from the authenticated token
        const userId = req.user.user_id;
        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized"
            });
        }
        
        // Set user as inactive and clear token expiration
        const logoutQuery = 'UPDATE users SET active = 0 WHERE user_id = ?';
        const clearTokenQuery = 'UPDATE auth_credentials SET token_expires_at = NULL WHERE user_id = ?';
        await db.execute(logoutQuery, [userId]);
        await db.execute(clearTokenQuery, [userId]);
        
        res.status(200).json({
            message: "Logout successful",
            data: {
                user_id: userId,
                active: 0
            }
        });
        
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
};

// Example Authenication Test
exports.authTest = async (req, res) => {
    res.status(200).json({
        message: "Request Authorized via Token",
    });
};


//UAR 1.8 Get stylist's assigned salon
exports.getStylistSalon = async (req, res) => {
    const db = connection.promise();
  
    try {
      const user_id = req.user?.user_id;
      const role = req.user?.role;
  
      if (!user_id) {
        return res.status(401).json({ message: 'No user found' });
      }
  
      if (role !== 'EMPLOYEE') {
        return res.status(403).json({ message: 'Access denied.' });
      }
  
  
      // Query to get the salon where this employee works
      const getStylistSalonQuery = 
      `SELECT s.salon_id, s.name, s.description, s.category, s.phone, s.email, 
              s.address, s.city, s.state, s.postal_code, s.country, 
              u.full_name as owner_name, e.title as employee_title
       FROM salons s
       JOIN employees e ON s.salon_id = e.salon_id
       JOIN users u ON s.owner_user_id = u.user_id
       WHERE e.user_id = ? AND e.active = 1`;
  
      
  
      const [result] = await db.execute(getStylistSalonQuery, [user_id]);
  
      if (result.length === 0) {
        return res.status(404).json({ 
          message: 'No salon assigned to this stylist' 
        });
      }
  
      return res.status(200).json({ 
        data: result[0] 
      });
  
    } catch (err) {
        //console.error('getStylistSalon error:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  };




//BS 1.4 Get stylist's schedule for a date range
/*REQUIRES FURTHER TESTING */
exports.getStylistWeeklySchedule = async (req, res) => {
  const db = connection.promise();

  try {
    const user_id = req.user?.user_id;
    const { start_date, end_date } = req.query;

    if (!user_id) {
      return res.status(401).json({ message: 'No user found' });
    }

    // Validate date range params
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'start_date and end_date are required (MM-DD-YYYY)' });
    }

    // Parse dates (expecting MM-DD-YYYY per example), create UTC dates using Luxon
    const parseMmDdYyyy = (s) => {
      const parts = String(s).split('-');
      if (parts.length === 3) {
        const [mm, dd, yyyy] = parts.map((p) => Number(p));
        if (!Number.isNaN(mm) && !Number.isNaN(dd) && !Number.isNaN(yyyy)) {
          // Create UTC DateTime
          return DateTime.utc(yyyy, mm, dd);
        }
      }
      // Try parsing as ISO or other format
      const dt = DateTime.fromISO(s);
      return dt.isValid ? dt.toUTC() : null;
    };

    const rangeStart = parseMmDdYyyy(start_date);
    const rangeEnd = parseMmDdYyyy(end_date);

    if (!rangeStart || !rangeStart.isValid || !rangeEnd || !rangeEnd.isValid) {
      return res.status(400).json({ message: 'Invalid start_date or end_date format' });
    }

    // Normalize to start/end of day (UTC)
    const startOfDay = rangeStart.startOf('day');
    const endOfDay = rangeEnd.endOf('day');

    if (startOfDay > endOfDay) {
      return res.status(400).json({ message: 'start_date must be before or equal to end_date' });
    }

    

    // Get employee_id and salon_id from user_id
    const getEmployeeQuery = 'SELECT employee_id, salon_id FROM employees WHERE user_id = ? AND active = 1';
    const [employeeResult] = await db.execute(getEmployeeQuery, [user_id]);

    const employee_id = employeeResult[0].employee_id;
    const salon_id = employeeResult[0].salon_id;

    // Get salon timezone - critical for grouping bookings by correct date
    const getSalonTimezoneQuery = 'SELECT timezone FROM salons WHERE salon_id = ?';
    const [salonTimezoneResult] = await db.execute(getSalonTimezoneQuery, [salon_id]);
    const salonTimezone = salonTimezoneResult[0]?.timezone || 'America/New_York';

    const getAvailabilityQuery = `
      SELECT availability_id, employee_id, weekday, start_time, end_time, created_at, updated_at 
      FROM employee_availability 
      WHERE employee_id = ?
      ORDER BY FIELD(weekday, 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')
    `;
    const [availabilityResult] = await db.execute(getAvailabilityQuery, [employee_id]);

    const getUnavailabilityQuery = `
      SELECT unavailability_id, employee_id, weekday, start_time, end_time, created_at, updated_at 
      FROM employee_unavailability 
      WHERE employee_id = ?
      ORDER BY weekday, start_time
    `;
    const [unavailabilityResult] = await db.execute(getUnavailabilityQuery, [employee_id]);

    const getSalonHoursQuery = `
      SELECT weekday, start_time, end_time 
      FROM salon_availability 
      WHERE salon_id = ?
    `;
    const [salonHoursResult] = await db.execute(getSalonHoursQuery, [salon_id]);

    const weekdayMap = { 0: 'SUNDAY', 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY', 4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY' };

    // Create salon hours map by weekday
    const salonHoursMap = {};
    salonHoursResult.forEach(hour => {
      const dayName = weekdayMap[hour.weekday];
      if (dayName) {
        salonHoursMap[dayName] = {
          start_time: hour.start_time,
          end_time: hour.end_time
        };
      }
    });

    // Get bookings that OVERLAP with the date range (not just start in range)
    // Use DATE_FORMAT to return SQL format (YYYY-MM-DD HH:mm:ss) for Luxon parsing
    const getBookingsQuery = `
      SELECT DISTINCT 
        b.booking_id, 
        b.salon_id, 
        b.customer_user_id, 
        DATE_FORMAT(b.scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
        DATE_FORMAT(b.scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
        b.status, 
        b.notes, 
        b.created_at, 
        b.updated_at,
        u.full_name AS customer_name, 
        u.email AS customer_email, 
        u.phone AS customer_phone
      FROM bookings b
      JOIN booking_services bs ON b.booking_id = bs.booking_id
      JOIN users u ON b.customer_user_id = u.user_id
      WHERE bs.employee_id = ?
        AND b.scheduled_start < ?
        AND b.scheduled_end > ?
      ORDER BY scheduled_start ASC
    `;
    const requestStartStr = toMySQLUtc(startOfDay);
    const requestEndStr = toMySQLUtc(endOfDay);
    const [bookingsResult] = await db.execute(getBookingsQuery, [employee_id, requestEndStr, requestStartStr]);

    // Index availability by weekday for O(1) lookup
    const availabilityByWeekday = {};
    for (const avail of availabilityResult) {
      const dayName = weekdayMap[avail.weekday];
      if (dayName) {
        availabilityByWeekday[dayName] = {
          availability_id: avail.availability_id,
          start_time: avail.start_time,
          end_time: avail.end_time
        };
      }
    }

    // Group unavailability by weekday
    const unavailabilityByWeekday = {};
    for (const unavail of unavailabilityResult) {
      const dayName = weekdayMap[unavail.weekday];
      if (!dayName) continue;
      if (!unavailabilityByWeekday[dayName]) unavailabilityByWeekday[dayName] = [];
      unavailabilityByWeekday[dayName].push(unavail);
    }

    const schedule = {};

    const formatMmDdYyyy = (dt) => {
      // dt is a DateTime object
      return dt.toFormat('MM-dd-yyyy');
    };

    const ymd = (dt) => {
      // dt is a DateTime object
      return dt.toFormat('yyyy-MM-dd');
    };
    
    const bookingsByDate = {};
    const bookingIds = [];
    for (const booking of bookingsResult) {
      // Parse SQL format datetime as UTC
      const bookingDt = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
      if (bookingDt.isValid) {
        // Convert to salon timezone to get the correct local date
        const bookingDtInSalonTz = bookingDt.setZone(salonTimezone);
        const key = ymd(bookingDtInSalonTz);  // Use salon timezone date!
        if (!bookingsByDate[key]) bookingsByDate[key] = [];
        bookingsByDate[key].push(booking);
        bookingIds.push(booking.booking_id);
      }
    }

    const servicesByBookingId = {};
    if (bookingIds.length > 0) {
      const placeholders = bookingIds.map(() => '?').join(',');
      const getServicesBulkQuery = `
        SELECT bs.booking_id, bs.service_id, bs.price, bs.duration_minutes,
               s.name AS service_name
        FROM booking_services bs
        JOIN services s ON bs.service_id = s.service_id
        WHERE bs.booking_id IN (${placeholders}) AND bs.employee_id = ?
      `;
      const params = [...bookingIds, employee_id];
      const [servicesRows] = await db.execute(getServicesBulkQuery, params);
      for (const row of servicesRows) {
        if (!servicesByBookingId[row.booking_id]) servicesByBookingId[row.booking_id] = [];
        servicesByBookingId[row.booking_id].push({
          service_id: row.service_id,
          service_name: row.service_name,
          duration_minutes: row.duration_minutes,
          price: row.price
        });
      }
    }

    // Bulk query
    let allPayments = [];
    if (bookingIds.length > 0) {
      const paymentPlaceholders = bookingIds.map(() => '?').join(',');
      [allPayments] = await db.execute(
        `SELECT p.booking_id, p.amount, p.reward_id, p.status
         FROM payments p
         WHERE p.booking_id IN (${paymentPlaceholders})
         AND p.status = 'SUCCEEDED'
         AND p.created_at = (
             SELECT MAX(created_at) 
             FROM payments p2 
             WHERE p2.booking_id = p.booking_id 
             AND p2.status = 'SUCCEEDED'
         )`,
        bookingIds
      );
    }

    // Extract reward IDs and bulk query rewards
    const rewardIds = allPayments.filter(p => p.reward_id).map(p => p.reward_id);
    let allRewards = [];
    if (rewardIds.length > 0) {
      const rewardPlaceholders = rewardIds.map(() => '?').join(',');
      [allRewards] = await db.execute(
        `SELECT reward_id, discount_percentage, note, creationDate, redeemed_at
         FROM available_rewards
         WHERE reward_id IN (${rewardPlaceholders})`,
        rewardIds
      );
    }

    // Group payments and rewards
    const paymentsByBooking = {};
    allPayments.forEach(p => {
      paymentsByBooking[p.booking_id] = p;
    });

    const rewardsById = {};
    allRewards.forEach(r => {
      rewardsById[r.reward_id] = r;
    });

    // Iterate through each day in the range using Luxon
    // Convert date range to salon timezone for correct day grouping
    const startOfDayInSalonTz = startOfDay.setZone(salonTimezone).startOf('day');
    const endOfDayInSalonTz = endOfDay.setZone(salonTimezone).endOf('day');
    
    let currentDate = startOfDayInSalonTz;
    while (currentDate <= endOfDayInSalonTz) {
      // Convert Luxon weekday to database weekday (0-6, Sunday=0)
      const dayIndex = luxonWeekdayToDb(currentDate.weekday);
      const dayName = weekdayMap[dayIndex];

      const dayAvailability = availabilityByWeekday[dayName] || null;

      const dayUnavailability = [];
      const salonHours = salonHoursMap[dayName];
      if (salonHours && dayAvailability) {
        const list = unavailabilityByWeekday[dayName] || [];
        for (const unavail of list) {
          const salonStart = salonHours.start_time;
          const salonEnd = salonHours.end_time;
          const unavailStart = unavail.start_time;
          const unavailEnd = unavail.end_time;
          const empStart = dayAvailability.start_time;
          const empEnd = dayAvailability.end_time;

          const overlapsSalonHours = unavailStart < salonEnd && unavailEnd > salonStart;
          const overlapsEmployeeAvailability = unavailStart < empEnd && unavailEnd > empStart;

          if (overlapsSalonHours && overlapsEmployeeAvailability) {
            dayUnavailability.push({
              unavailability_id: unavail.unavailability_id,
              start_time: unavail.start_time,
              end_time: unavail.end_time
            });
          }
        }
      }

      // Use salon timezone date for matching bookings
      const dateKey = ymd(currentDate);
      const bookingsForDate = bookingsByDate[dateKey] || [];
      const dayBookings = bookingsForDate.map(booking => {
        // Parse SQL format datetime strings as UTC
        const bookingStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
        const bookingEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
        logUtcDebug('userController.getStylistWeeklySchedule parsed scheduled_start', bookingStart);
        logUtcDebug('userController.getStylistWeeklySchedule parsed scheduled_end', bookingEnd);
        // Return full ISO datetime strings so frontend can properly convert to local timezone
        const startTime = formatDateTime(bookingStart);
        const endTime = formatDateTime(bookingEnd);

        const servicesResult = servicesByBookingId[booking.booking_id] || [];
        const totalDuration = servicesResult.reduce((sum, s) => sum + Number(s.duration_minutes), 0);
        const totalPrice = servicesResult.reduce((sum, s) => sum + Number(s.price), 0);

        const payment = paymentsByBooking[booking.booking_id];
        let actualAmountPaid = null;
        let rewardInfo = null;

        if (payment) {
          actualAmountPaid = Number(payment.amount);
          
          if (payment.reward_id && rewardsById[payment.reward_id]) {
            const reward = rewardsById[payment.reward_id];
            rewardInfo = {
              reward_id: reward.reward_id,
              discount_percentage: Number(reward.discount_percentage),
              note: reward.note,
              creationDate: formatDateTime(reward.creationDate),
              redeemed_at: formatDateTime(reward.redeemed_at)
            };
          }
        }

        return {
          booking_id: booking.booking_id,
          salon_id: booking.salon_id,
          customer: {
            user_id: booking.customer_user_id,
            name: booking.customer_name,
            email: booking.customer_email,
            phone: booking.customer_phone
          },
          scheduled_start: startTime,
          scheduled_end: endTime,
          status: booking.status,
          notes: booking.notes,
          services: servicesResult.map(s => ({
            service_id: s.service_id,
            service_name: s.service_name,
            duration_minutes: Number(s.duration_minutes),
            price: s.price
          })),
          total_duration_minutes: totalDuration,
          total_price: totalPrice,
          actual_amount_paid: actualAmountPaid,
          reward: rewardInfo
        };
      });

      const displayDate = formatMmDdYyyy(currentDate);
      schedule[displayDate] = {
        weekday: dayName,
        availability: dayAvailability,
        unavailability: dayUnavailability,
        bookings: dayBookings
      };
      
      // Move to next day
      currentDate = currentDate.plus({ days: 1 });
    }

    return res.status(200).json({ 
      data: {
        schedule: schedule
      }
    });

  } catch (err) {
    console.error('getStylistWeeklySchedule error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

// PLR 1.4 View Loyalty Program
exports.viewLoyaltyProgram = async (req, res) => {
  const db = connection.promise();

  try {
      const user_id = req.user?.user_id;
      const salon_id = req.query.salon_id;

      if (!user_id || !salon_id) {
          return res.status(401).json({ message: 'Invalid fields.' });
      }

      const getLoyaltyProgramQuery = 
      `SELECT lm.visits_count, lp.target_visits, lp.discount_percentage, lp.note, s.name as salon_name
      FROM loyalty_memberships lm
      JOIN loyalty_programs lp ON lm.salon_id = lp.salon_id
      JOIN salons s ON s.salon_id = lp.salon_id
      WHERE lm.salon_id = ? and lm.user_id = ? and lp.active = 1;`;

      const [result] = await db.execute(getLoyaltyProgramQuery, [salon_id, user_id]);

      if (result.length === 0) {
          return res.status(404).json({ 
              message: 'No Loyalty Program found.' 
          });
      }

      const getGoldenSalonsQuery = `SELECT COUNT(*) as golden_salons FROM loyalty_memberships WHERE user_id = ? and visits_count >= 5;`;
      const [goldenSalons] = await db.execute(getGoldenSalonsQuery, [user_id]);    
  
      const getTotalVisitsQuery = `SELECT SUM(visits_count) as total_visits FROM loyalty_memberships WHERE user_id = ?;`;
      const [totalVisits] = await db.execute(getTotalVisitsQuery, [user_id]);

      const getUserRewardsQuery = `SELECT reward_id, creationDate AS earned_at, active, redeemed_at, discount_percentage, note FROM available_rewards WHERE salon_id = ? AND user_id = ?;`;
      const [userRewards] = await db.execute(getUserRewardsQuery, [salon_id, user_id]);
  
      return res.status(200).json({ 
          userData: result[0],
          goldenSalons: goldenSalons[0].golden_salons,
          totalVisits: totalVisits[0].total_visits,
          userRewards: userRewards
      }); 

  } catch (err) {
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

// PLR 1.2 View Stylist Metrics
exports.viewStylistMetrics = async (req, res) => {
  const db = connection.promise();

  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(401).json({ message: 'Invalid fields.' });
    }

    // Calculate date ranges using Luxon
    const now = DateTime.utc();
    const todayStart = toMySQLUtc(now.startOf('day'));
    const todayEnd = toMySQLUtc(now.endOf('day'));
    const weekAgoStart = toMySQLUtc(now.minus({ days: 7 }).startOf('day'));

    const revenueMetricsQuery = 
    `SELECT
    (SELECT COALESCE(SUM(p.amount), 0)
      FROM payments p
      JOIN bookings b ON b.booking_id = p.booking_id
      JOIN booking_services bs ON bs.booking_id = b.booking_id
      WHERE p.status = 'SUCCEEDED'
        AND p.created_at >= ?
        AND p.created_at < ?
        AND bs.employee_id = (SELECT employee_id FROM employees WHERE user_id = ?)
    ) AS revenue_today,

    (SELECT COALESCE(SUM(p.amount), 0)
      FROM payments p
      JOIN bookings b ON b.booking_id = p.booking_id
      JOIN booking_services bs ON bs.booking_id = b.booking_id
      WHERE p.status = 'SUCCEEDED'
        AND p.created_at >= ?
        AND p.created_at < ?
        AND bs.employee_id = (SELECT employee_id FROM employees WHERE user_id = ?)
    ) AS revenue_past_week,

    (SELECT COALESCE(SUM(p.amount), 0)
      FROM payments p
      JOIN bookings b ON b.booking_id = p.booking_id
      JOIN booking_services bs ON bs.booking_id = b.booking_id
      WHERE p.status = 'SUCCEEDED'
        AND bs.employee_id = (SELECT employee_id FROM employees WHERE user_id = ?)
    ) AS revenue_all_time;`;

    const [revenueMetrics] = await db.execute(revenueMetricsQuery, [
      todayStart, todayEnd, user_id,  // revenue_today
      weekAgoStart, todayEnd, user_id,  // revenue_past_week
      user_id  // revenue_all_time (if exists)
    ]);

    return res.status(200).json({
      revenueMetrics: revenueMetrics[0]
    });

  } catch (err) {
    console.error('viewStylistMetrics error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }

};