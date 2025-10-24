require('dotenv').config();
const bcrypt = require('bcrypt');
const connection = require('../config/databaseConnection');
const { generateToken } = require('../middleware/auth.middleware');
const { validateEmail } = require('../utils/utilies');

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




//BS 1.4 Get stylist's weekly schedule
/*REQUIRES FURTHER TESTING */
exports.getStylistWeeklySchedule = async (req, res) => {
  const db = connection.promise();

  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(401).json({ message: 'No user found' });
    }


    // Get employee_id from user_id
    const getEmployeeQuery = 'SELECT employee_id FROM employees WHERE user_id = ? AND active = 1';
    const [employeeResult] = await db.execute(getEmployeeQuery, [user_id]);

    const employee_id = employeeResult[0].employee_id;

    const getAvailabilityQuery = `
      SELECT availability_id, employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at 
      FROM employee_availability 
      WHERE employee_id = ?
      ORDER BY FIELD(weekday, 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')
    `;
    const [availabilityResult] = await db.execute(getAvailabilityQuery, [employee_id]);

    const getUnavailabilityQuery = `
      SELECT unavailability_id, employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at 
      FROM employee_unavailability 
      WHERE employee_id = ?
      ORDER BY weekday, start_time
    `;
    const [unavailabilityResult] = await db.execute(getUnavailabilityQuery, [employee_id]);

    // Get all non-cancelled bookings
    const getBookingsQuery = `
      SELECT b.booking_id, b.salon_id, b.customer_user_id, b.scheduled_start, b.scheduled_end, b.status, b.notes, b.created_at, b.updated_at
      FROM bookings b
      JOIN booking_services bs ON b.booking_id = bs.booking_id
      WHERE bs.employee_id = ? AND b.status != 'CANCELED'
      ORDER BY b.scheduled_start ASC
    `;
    const [bookingsResult] = await db.execute(getBookingsQuery, [employee_id]);

    const daysOfWeek = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const weeklySchedule = {};

    daysOfWeek.forEach(day => {
      weeklySchedule[day] = {
        availability: null,
        unavailability: [],
        bookings: []
      };
    });

    const weekdayMap = { 0: 'SUNDAY', 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY', 4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY' };
    availabilityResult.forEach(avail => {
      const dayName = weekdayMap[avail.weekday];
      if (weeklySchedule[dayName]) {
        weeklySchedule[dayName].availability = {
          availability_id: avail.availability_id,
          start_time: avail.start_time,
          end_time: avail.end_time,
          slot_interval_minutes: avail.slot_interval_minutes
        };
      }
    });

    // Map unavailability data to days (convert weekday number to day name)
    unavailabilityResult.forEach(unavail => {
      const dayName = weekdayMap[unavail.weekday];
      if (weeklySchedule[dayName]) {
        weeklySchedule[dayName].unavailability.push({
          unavailability_id: unavail.unavailability_id,
          start_time: unavail.start_time,
          end_time: unavail.end_time,
          slot_interval_minutes: unavail.slot_interval_minutes
        });
      }
    });

    // Map bookings to days based on scheduled_start date
    bookingsResult.forEach(booking => {
      const bookingDate = new Date(booking.scheduled_start);
      const dayName = daysOfWeek[bookingDate.getDay() === 0 ? 6 : bookingDate.getDay() - 1]; // Convert JS day to our Monday-Sunday format
      
      if (weeklySchedule[dayName]) {
        const startTime = new Date(booking.scheduled_start).toTimeString().split(' ')[0];
        const endTime = new Date(booking.scheduled_end).toTimeString().split(' ')[0];
        
        weeklySchedule[dayName].bookings.push({
          booking_id: booking.booking_id,
          salon_id: booking.salon_id,
          customer_user_id: booking.customer_user_id,
          scheduled_start: startTime,
          scheduled_end: endTime,
          status: booking.status,
          notes: booking.notes
        });
      }
    });

    if (Object.keys(weeklySchedule).length === 0) {
        return res.status(404).json({ message: 'No schedule found for this stylist' });
    }

    return res.status(200).json({ 
      data: {
        schedule: weeklySchedule
      }
    });

  } catch (err) {
    console.error('getStylistWeeklySchedule error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

