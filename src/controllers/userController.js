require('dotenv').config();
const bcrypt = require('bcrypt');
const connection = require('../config/databaseConnection');
const { generateToken } = require('../middleware/auth.middleware');
const { validateEmail, toLocalSQL, formatDateTime } = require('../utils/utilies');

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
        
        const insertUserQuery = `
            INSERT INTO users (full_name, email, phone, profile_picture_url, role, last_login_at, active, created_at, updated_at)
            VALUES (?, ?, NULL, NULL, ?, NOW(), 1, NOW(), NOW())
        `;

        const [userRes] = await db.execute(insertUserQuery, [full_name, email, role]);
        const userId = userRes.insertId;

        const insertAuthQuery = `
            INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at)
            VALUES (?, ?, NOW(), NOW())
        `;
        await db.execute(insertAuthQuery, [userId, hashedPassword]);
  
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
        const updateLoginQuery = 'UPDATE users SET last_login_at = NOW() WHERE user_id = ?';
        await db.execute(updateLoginQuery, [existingUsers[0].user_id]);

        const tokenPayload = {
            user_id: existingUsers[0].user_id,
            role: existingUsers[0].role.toUpperCase(),
            full_name: existingUsers[0].full_name
        };

        const token = generateToken(tokenPayload);
        
        // Store token expiration time (2 hours from now)
        const tokenExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const updateTokenQuery = 'UPDATE auth_credentials SET token_expires_at = ? WHERE user_id = ?';
        await db.execute(updateTokenQuery, [tokenExpiry, existingUsers[0].user_id]);


        // Track login
        const trackLoginQuery = 'INSERT INTO logins (user_id, login_date) VALUES (?, NOW())';
        await db.execute(trackLoginQuery, [existingUsers[0].user_id]);

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

    // Parse dates (expecting MM-DD-YYYY per example), fallback to Date parsing
    const parseMmDdYyyy = (s) => {
      const parts = String(s).split('-');
      if (parts.length === 3) {
        const [mm, dd, yyyy] = parts.map((p) => Number(p));
        if (!Number.isNaN(mm) && !Number.isNaN(dd) && !Number.isNaN(yyyy)) {
          return new Date(yyyy, mm - 1, dd);
        }
      }
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const rangeStart = parseMmDdYyyy(start_date);
    const rangeEnd = parseMmDdYyyy(end_date);

    if (!rangeStart || !rangeEnd) {
      return res.status(400).json({ message: 'Invalid start_date or end_date format' });
    }

    // Normalize to start/end of day
    const startOfDay = new Date(rangeStart);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(rangeEnd);
    endOfDay.setHours(23, 59, 59, 999);

    if (startOfDay.getTime() > endOfDay.getTime()) {
      return res.status(400).json({ message: 'start_date must be before or equal to end_date' });
    }

    

    // Get employee_id and salon_id from user_id
    const getEmployeeQuery = 'SELECT employee_id, salon_id FROM employees WHERE user_id = ? AND active = 1';
    const [employeeResult] = await db.execute(getEmployeeQuery, [user_id]);

    const employee_id = employeeResult[0].employee_id;
    const salon_id = employeeResult[0].salon_id;

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

    const getBookingsQuery = `
      SELECT DISTINCT b.booking_id, b.salon_id, b.customer_user_id, b.scheduled_start, b.scheduled_end, b.status, b.notes, b.created_at, b.updated_at,
             u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
      FROM bookings b
      JOIN booking_services bs ON b.booking_id = bs.booking_id
      JOIN users u ON b.customer_user_id = u.user_id
      WHERE bs.employee_id = ?
        AND b.scheduled_start >= ?
        AND b.scheduled_start <= ?
      ORDER BY b.scheduled_start ASC
    `;
    const requestStartStr = toLocalSQL(startOfDay);
    const requestEndStr = toLocalSQL(endOfDay);
    const [bookingsResult] = await db.execute(getBookingsQuery, [employee_id, requestStartStr, requestEndStr]);

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

    const formatMmDdYyyy = (d) => {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${mm}-${dd}-${yyyy}`;
    };

    const ymd = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const bookingsByDate = {};
    const bookingIds = [];
    for (const booking of bookingsResult) {
      const d = new Date(booking.scheduled_start);
      const key = ymd(d);
      if (!bookingsByDate[key]) bookingsByDate[key] = [];
      bookingsByDate[key].push(booking);
      bookingIds.push(booking.booking_id);
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

    for (let d = new Date(startOfDay); d.getTime() <= endOfDay.getTime(); d.setDate(d.getDate() + 1)) {
      const dayIndex = d.getDay(); // 0..6 (Sun..Sat)
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

      const dateKey = ymd(d);
      const bookingsForDate = bookingsByDate[dateKey] || [];
      const dayBookings = await Promise.all(bookingsForDate.map(async (booking) => {
        const startDate = new Date(booking.scheduled_start);
        const endDate = new Date(booking.scheduled_end);
        const startTime = startDate.toTimeString().split(' ')[0];
        const endTime = endDate.toTimeString().split(' ')[0];

        const servicesResult = servicesByBookingId[booking.booking_id] || [];
        const totalDuration = servicesResult.reduce((sum, s) => sum + Number(s.duration_minutes), 0);
        const totalPrice = servicesResult.reduce((sum, s) => sum + Number(s.price), 0);

        // Get payment information for this booking
        const [payments] = await db.execute(
          `SELECT amount, reward_id, status
           FROM payments
           WHERE booking_id = ? AND status = 'SUCCEEDED'
           ORDER BY created_at DESC
           LIMIT 1`,
          [booking.booking_id]
        );

        let actualAmountPaid = null;
        let rewardInfo = null;

        if (payments.length > 0) {
          actualAmountPaid = Number(payments[0].amount);
          
          if (payments[0].reward_id) {
            const [rewards] = await db.execute(
              `SELECT reward_id, discount_percentage, note, creationDate, redeemed_at
               FROM available_rewards
               WHERE reward_id = ?`,
              [payments[0].reward_id]
            );
            
            if (rewards.length > 0) {
              rewardInfo = {
                reward_id: rewards[0].reward_id,
                discount_percentage: Number(rewards[0].discount_percentage),
                note: rewards[0].note,
                creationDate: formatDateTime(rewards[0].creationDate),
                redeemed_at: formatDateTime(rewards[0].redeemed_at)
              };
            }
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
      }));

      const displayDate = formatMmDdYyyy(d);
      schedule[displayDate] = {
        weekday: dayName,
        availability: dayAvailability,
        unavailability: dayUnavailability,
        bookings: dayBookings
      };
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

    const revenueMetricsQuery = 
    `SELECT(
    SELECT COALESCE(SUM(p.amount), 0)
    FROM payments p
    JOIN bookings b ON b.booking_id = p.booking_id
    JOIN booking_services bs ON bs.booking_id = b.booking_id
    WHERE p.status = 'SUCCEEDED'
      AND p.created_at >= CURDATE()
      AND p.created_at < CURDATE() + INTERVAL 1 DAY
      AND bs.employee_id = (SELECT employee_id FROM employees WHERE user_id = ?)
  ) AS revenue_today,
  (SELECT COALESCE(SUM(p.amount), 0)
    FROM payments p
    JOIN bookings b ON b.booking_id = p.booking_id
    JOIN booking_services bs ON bs.booking_id = b.booking_id
    WHERE p.status = 'SUCCEEDED'
      AND p.created_at >= CURDATE() - INTERVAL 7 DAY
      AND p.created_at < CURDATE() + INTERVAL 1 DAY
      AND bs.employee_id = (SELECT employee_id FROM employees WHERE user_id = ?)
  ) AS revenue_past_week;`;

    const [revenueMetrics] = await db.execute(revenueMetricsQuery, [user_id, user_id]);

    return res.status(200).json({
      revenueMetrics: revenueMetrics[0]
    });

  } catch (err) {
    return res.status(500).json({ message: 'Internal Server Error' });
  }

};