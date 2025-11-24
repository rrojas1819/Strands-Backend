const connection = require('../config/databaseConnection'); //db connection
const { validateEmail, toMySQLUtc, formatDateTime, logUtcDebug, localAvailabilityToUtc, luxonWeekdayToDb } = require('../utils/utilies');
const { DateTime } = require('luxon');
const { getFilePresigned } = require('../utils/s3.js');

//allowed salon categories
const ALLOWED_CATEGORIES = new Set([
  'NAIL SALON', 'HAIR SALON', 'EYELASH STUDIO',
  'SPA & WELLNESS', 'BARBERSHOP', 'FULL SERVICE BEAUTY'
]);

// Global weekday constants for availability
const VALID_WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// Map weekday names to database integers (Sunday = 0, Monday = 1, etc)
const WEEKDAY_TO_NUMBER = {
  'SUNDAY': 0,
  'MONDAY': 1,
  'TUESDAY': 2,
  'WEDNESDAY': 3,
  'THURSDAY': 4,
  'FRIDAY': 5,
  'SATURDAY': 6
};

// Helper function to normalize service names for duplicate detection
const normalizeServiceName = (name) => {
  return name
    .toLowerCase()
    .replace(/\s+$/g, '') // Remove trailing spaces
    .replace(/\d+$/g, '') // Remove trailing numbers
    .replace(/\s+/g, ' ') // Merge multiple spaces to single space
    .trim();
};

//separate endpoint to check owner has a salon already
exports.checkOwnerHasSalon = async (req, res) => {
  const db = connection.promise();
  const owner_user_id = req.user?.user_id;

  if (!owner_user_id) {
    return res.status(401).json({ message: 'No user found' });
  }

  try {
    const [rows] = await db.execute('SELECT salon_id, status FROM salons WHERE owner_user_id = ? LIMIT 1', [owner_user_id]);

    const hasSalon = rows.length > 0;
    
    return res.status(200).json({ hasSalon, status: rows[0].status });
  } catch (err) {
    console.error('checkOwnerHasSalon error:', err);
    return res.status(500).json({ message: 'Internal server error' })
  }
};

//UAR 1.3/1.4 registration + salon type
exports.createSalon = async (req, res) => {
  const db = connection.promise();
  try {
    //info from user
    const role = req.user?.role;
    const owner_user_id = req.user?.user_id;

    //check for owner role
    if (!role || (role !== 'OWNER')) {
      return res.status(403).json({ message: 'Invalid role' });
    }

    //extract details from request
    let {
      name, description = '', category, phone = null, email = null, address = null,
      city = null, state = null, postal_code = null, country = 'USA'
    } = req.body;

    //validation for all params
    const stringFields = { name, description, phone, email, address, city, state, postal_code };
    for (const [field, value] of Object.entries(stringFields)) {
      if (!value || typeof value !== 'string') {
        return res.status(400).json({ message: `Field '${field}' is required and must be a string` });
      }
    }

    category = category.toUpperCase(); //making category uppercase for db
    if (!category || !ALLOWED_CATEGORIES.has(category)) {
      return res.status(400).json({
        message: "Invalid 'category'",
        allowed: Array.from(ALLOWED_CATEGORIES)
      });
    }

    //check for only one salon per owner
    const checkSalonQuery = 'SELECT salon_id FROM salons WHERE owner_user_id = ?';
    const [existingSalons] = await db.execute(checkSalonQuery, [owner_user_id]);

    if(existingSalons.length > 0) {
      return res.status(409).json({ message: 'You already have a salon registered.' });
    }

    //inserting salon into db
    const nowUtc = toMySQLUtc(DateTime.utc());
    const insertSql = `INSERT INTO salons
                      (owner_user_id, name, description, category, phone, email,
                      address, city, state, postal_code, country, status, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`;

    const params = [
      owner_user_id, name, description, category, phone, email,
      address, city, state, postal_code, country, nowUtc, nowUtc
    ];

    //insert
    const [result] = await db.execute(insertSql, params);
    //retrieve
    const [rows] = await db.execute(
      'SELECT * FROM salons WHERE salon_id = ?', [result.insertId]
    );

    //now we wait for an admin to verify it
    return res.status(201).json({
      message: 'Salon registered (pending verification)', data: rows[0]
    });
  } catch (err) {
    console.error('createSalon error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


//UAR 1.5 salon approval
exports.approveSalon = async (req, res) => {
  const db = connection.promise();

  try {
    const { salon_id, status } = req.body;

    if (!salon_id || isNaN(salon_id)) {
      return res.status(400).json({ message: 'Invalid salon_id' });
    }

    if (!['APPROVED','REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const nowUtc = toMySQLUtc(DateTime.utc());
    const updateSalonQuery = 
      `UPDATE salons 
        SET status = ?,
        approval_date = IF(? = 'APPROVED', ?, approval_date)
      WHERE salon_id = ?;`;

    const [result] = await db.execute(updateSalonQuery, [status, status, nowUtc, salon_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    res.status(200).json({
      message: `Salon ${salon_id} has been ${status.toLowerCase()}.`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

//UAR 1.6 browse salons user/admin
exports.browseSalons = async (req, res) => {
  const db = connection.promise();
  const userRole = req.user?.role;
  const isAdmin = userRole === 'ADMIN';
  const category = req.body?.category;

  try {
    //URL params
    let {status = 'all', limit = 20, offset = 0, sort = 'recent'} = req.query;

    //pagination
    limit  = Number.isFinite(+limit) ? +limit : 20;
    offset = Number.isFinite(+offset) ? +offset : 0;

    //dynamic filters
    const where = [];
    const params = [];

    if (isAdmin) {
      //admin can view all types of salons, PENDING, APPROVED, etc.
      if (status && status !== 'all') {
        where.push(`s.status = ?`);
        params.push(status);
      }
    } else {
      //users can only see APPROVED
      where.push(`s.status = 'APPROVED'`);
    }

    //filters
    if (category) {where.push(`s.category = ?`); params.push(category);}

    //sorting
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let orderBy = `ORDER BY s.created_at DESC`;
    if (sort === 'name') orderBy = `ORDER BY s.name ASC`;

    //tab counts, ex. All (6)
    let counts;
    if (isAdmin) {
      const [[allC]] = await db.execute(`SELECT COUNT(*) AS c FROM salons`);
      const [[pC]] = await db.execute(`SELECT COUNT(*) AS c FROM salons WHERE status='PENDING'`);
      const [[aC]] = await db.execute(`SELECT COUNT(*) AS c FROM salons WHERE status='APPROVED'`);
      const [[rC]] = await db.execute(`SELECT COUNT(*) AS c FROM salons WHERE status='REJECTED'`);
      counts = {all: allC.c || 0, pending: pC.c || 0, approved: aC.c || 0, rejected: rC.c || 0};
    }

    //current total for current filtered view
    const countSql = isAdmin ? `SELECT COUNT(*) AS total FROM salons s JOIN users u ON u.user_id = s.owner_user_id ${whereSql}`
                             : `SELECT COUNT(*) AS total FROM salons s ${whereSql}`;
    const [countRows] = await db.execute(countSql, params);

    const total = countRows[0]?.total || 0;

    //fetching salon info
    const listSql = isAdmin ? `SELECT s.salon_id, s.name, s.category, s.description, s.phone, s.email, s.address, s.city, s.state, s.postal_code, s.country,
                              s.status, s.created_at, s.updated_at, u.user_id AS owner_user_id, u.full_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
                              FROM salons s JOIN users u ON u.user_id = s.owner_user_id ${whereSql} ${orderBy} LIMIT ${limit} OFFSET ${offset}`
                            : `SELECT s.salon_id, s.name, s.description, s.category, s.phone, s.email, s.address, s.city, s.state, s.postal_code, s.country,
                              s.status, s.created_at, s.updated_at FROM salons s ${whereSql} ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    const [rows] = await db.execute(listSql, params);
    
    const salonIds = rows.map(row => row.salon_id);
    let salonHours = {};
    
    if (salonIds.length > 0) {
      const placeholders = salonIds.map(() => '?').join(',');
      const getAvailabilityQuery = `
        SELECT salon_id, weekday, start_time, end_time
        FROM salon_availability 
        WHERE salon_id IN (${placeholders})
        ORDER BY salon_id, weekday
      `;
      const [availabilityResult] = await db.execute(getAvailabilityQuery, salonIds);
      
      salonHours = salonIds.reduce((acc, id) => {
        acc[id] = {};
        return acc;
      }, {});
      
      salonIds.forEach(id => {
        VALID_WEEKDAYS.forEach(day => {
          salonHours[id][day] = {
            is_open: false,
            start_time: null,
            end_time: null
          };
        });
      });
      
      availabilityResult.forEach(avail => {
        const dayName = Object.keys(WEEKDAY_TO_NUMBER).find(day => WEEKDAY_TO_NUMBER[day] === avail.weekday);
        if (dayName && salonHours[avail.salon_id]) {
          salonHours[avail.salon_id][dayName] = {
            is_open: true,
            start_time: avail.start_time,
            end_time: avail.end_time
          };
        }
      });
    }

    // fetch salon photo signed URL per salon
    const salonPhotoUrlById = {};
    for (const id of salonIds) {
      const getSalonPhotoQuery = `SELECT p.s3_key FROM pictures p JOIN salon_photos sp ON p.picture_id = sp.picture_id WHERE sp.salon_id = ? LIMIT 1;`;
      const [salonPhotoRows] = await db.execute(getSalonPhotoQuery, [id]);
      const key = salonPhotoRows[0]?.s3_key;
      if (key) {
        const { url } = await getFilePresigned(key);
        if (url) {
          salonPhotoUrlById[id] = url;
        }
      }
    }
    
    
      
    const rowsWithHours = rows.map(row => ({
      ...row,
      weekly_hours: salonHours[row.salon_id] || {},
      photo_url: salonPhotoUrlById[row.salon_id] || null
    }));
    
    //returning salons
    return res.status(200).json({
      data: rowsWithHours,
      meta: {total, limit, offset, hasMore: offset + rows.length < total},
      ...(isAdmin ? { counts } : {})
    });
  } catch (err) {
    console.error('browseSalonsUnified error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

//UAR 1.7 Add Employee
exports.addEmployee = async (req, res) => {
  const db = connection.promise();

  try {
    const { email, title } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!email || !title) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const checkEmployeeExistsQuery = `SELECT user_id FROM users WHERE email = ? AND role = 'EMPLOYEE'`;
    
    const [existingEmployee] = await db.execute(checkEmployeeExistsQuery, [email]);

    if (existingEmployee.length === 0) {
      return res.status(409).json({ message: 'Employee does not exist.' });
    }

    const nowUtc = toMySQLUtc(DateTime.utc());
    const assignEmployeeQuery = 
    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
    VALUES((SELECT salon_id FROM salons WHERE owner_user_id = ?), (SELECT user_id FROM users WHERE email = ?), ?, 1, ?, ?);`;

    const [result] = await db.execute(assignEmployeeQuery, [owner_user_id, email, title, nowUtc, nowUtc]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    res.status(200).json({
      message: `Employee ${email} has been added to salon.`
    });

  } catch (err) {
    console.error('addEmployee error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

//UAR 1.7 Remove Employee
exports.removeEmployee = async (req, res) => {
  const db = connection.promise();

  try {
    const { email } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!email) { 
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const removeEmployeeQuery = 
    `DELETE FROM employees
    WHERE user_id = (
    SELECT user_id
    FROM users
    WHERE email = ?
    ) AND salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)`;

    const [result] = await db.execute(removeEmployeeQuery, [email, owner_user_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    res.status(200).json({
      message: `Employee ${email} has been removed from salon.`
    });

  } catch (err) {
    console.error('removeEmployee error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


//UAR 1.7 View Employees
exports.viewEmployees = async (req, res) => {
  const db = connection.promise();

  try {
    const { limit, offset } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!limit || isNaN(offset)) {
      return res.status(400).json({ message: 'Invalid fields.' });
    }

    const countQuery = 
    `SELECT COUNT(*) as total 
    FROM employees e 
    JOIN salons s ON e.salon_id = s.salon_id
    WHERE e.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)`;

    const [countResult] = await db.execute(countQuery, [owner_user_id]);
    const total = countResult[0]?.total || 0;


    const limitInt = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 10);
    const offsetInt = Math.max(0, Number.isFinite(Number(offset)) ? Number(offset) : 0);

    const employeesQuery = `
    SELECT e.employee_id, e.user_id, e.title, e.active, u.full_name, u.email, u.phone, u.profile_picture_url
    FROM employees e
    JOIN users u ON e.user_id = u.user_id
    JOIN salons s ON e.salon_id = s.salon_id
    WHERE e.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
    ORDER BY u.full_name ASC
    LIMIT ${limitInt} OFFSET ${offsetInt}
    `;

    const [employees] = await db.execute(employeesQuery, [owner_user_id]);


    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const hasNextPage = offset + employees.length < total;
    const hasPrevPage = offset > 0;

    return res.status(200).json({
      data: employees,
      pagination: {
        current_page: currentPage,
        total_pages: totalPages,
        total_employees: total,
        limit: limit,
        offset: offset,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage
      }
    });

  } catch (err) {
    console.error('viewEmployees error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


// PLR 1.6 Configure Loyalty Program
exports.configureLoyaltyProgram = async (req, res) => {
  const db = connection.promise();

  try {
    const { target_visits, discount_percentage, note, active } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!target_visits || !discount_percentage) { 
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const nowUtc = toMySQLUtc(DateTime.utc());
    const insertLoyaltyProgramQuery = 
    `INSERT INTO loyalty_programs (salon_id, target_visits, discount_percentage, note, created_at, updated_at, active) VALUES ((SELECT salon_id FROM salons WHERE owner_user_id = ?), ?, ?, ?, ?, ?, ?);`;

    const [result] = await db.execute(insertLoyaltyProgramQuery, [owner_user_id, target_visits, discount_percentage, note, nowUtc, nowUtc, active]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }
    
    res.status(200).json({
      message: `Salon has been configured with a loyalty program.`
    });

  } catch (err) {
    console.error('configureLoyalty error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// PLR 1.6 Update Loyalty Program
exports.updateLoyaltyProgram = async (req, res) => {
  const db = connection.promise();

  try {
    const { target_visits, discount_percentage, note, active } = req.body;
    const owner_user_id = req.user?.user_id;

    if (!target_visits || !discount_percentage) { 
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const updateLoyaltyProgramQuery = 
    `UPDATE loyalty_programs SET target_visits = ?, discount_percentage = ?, note = ?, active = ? WHERE salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)`;

    const [result] = await db.execute(updateLoyaltyProgramQuery, [target_visits, discount_percentage, note, active, owner_user_id]);

    if (result.length === 0) {
      return res.status(404).json({ 
        message: 'No loyalty program found' 
      });
    }

    return res.status(200).json({ 
      message: `Salon's loyalty program has been updated.`
    });

  } catch (err) {
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

// PLR 1.6 Get loyalty program
exports.getLoyaltyProgram = async (req, res) => {
  const db = connection.promise();

  try {
    const owner_user_id = req.user?.user_id;

    const updateLoyaltyProgramQuery = 
    `SELECT target_visits, discount_percentage, note, active FROM loyalty_programs WHERE salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)`;

    const [result] = await db.execute(updateLoyaltyProgramQuery,[owner_user_id]);

    if (result.length === 0) {
      return res.status(404).json({ 
        message: 'No loyalty program found' 
      });
    }

    return res.status(200).json({ 
      programData: result[0]
    });

  } catch (err) {
    console.error('getLoyaltyProgram error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};


// BS 1.0 - Get salon operating hours
exports.getSalonHours = async (req, res) => {
  const db = connection.promise();
  
  try {
      const owner_user_id = req.user?.user_id;
      
   
      const getSalonQuery = 'SELECT salon_id FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);
      

      const salon_id = salonResult[0].salon_id;
      
       const getAvailabilityQuery = `
           SELECT salon_availability_id, weekday, start_time, end_time, created_at, updated_at
           FROM salon_availability 
           WHERE salon_id = ?
           ORDER BY weekday
       `;
      const [availabilityResult] = await db.execute(getAvailabilityQuery, [salon_id]);
      
      const weeklyHours = {};
      
      VALID_WEEKDAYS.forEach(day => {
          weeklyHours[day] = {
              is_open: false,
              start_time: null,
              end_time: null
          };
      });
      
      availabilityResult.forEach(avail => {
          const dayName = Object.keys(WEEKDAY_TO_NUMBER).find(day => WEEKDAY_TO_NUMBER[day] === avail.weekday);
          if (dayName) {
              weeklyHours[dayName] = {
                  is_open: true,
                  start_time: avail.start_time,
                  end_time: avail.end_time,
                  created_at: avail.created_at,
                  updated_at: avail.updated_at
              };
          }
      });
      
      return res.status(200).json({
          data: {
              weekly_hours: weeklyHours
          }
      });
      
  } catch (error) {
      console.error('getSalonHours error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};

// BS 1.0 - Set salon operating hours
exports.setSalonHours = async (req, res) => {
  const db = connection.promise();
  
  
  try {
      const { weekly_hours } = req.body;
      const owner_user_id = req.user?.user_id;
      
      if (!weekly_hours || typeof weekly_hours !== 'object') {
          return res.status(400).json({
              message: 'weekly_hours object is required'
          });
      }
      
      const getSalonQuery = 'SELECT salon_id, timezone FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);
    
      const salon_id = salonResult[0].salon_id;
      const salonTimezone = salonResult[0].timezone || 'America/New_York';
      
      const results = [];
      const errors = [];
      
      // Process each day
      for (const [weekday, hours] of Object.entries(weekly_hours)) {
          try {
            //Safety check
              if (!VALID_WEEKDAYS.includes(weekday.toUpperCase())) {
                  errors.push(`${weekday}: Invalid weekday`);
                  continue;
              }
              
              const shouldDelete = hours === null || 
                                   hours === false || 
                                   (typeof hours === 'object' && Object.keys(hours).length === 0) ||
                                   (hours && hours.is_open === false);
              
              if (shouldDelete) {
                  const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
                  
                  const checkBookingsQuery = `
                      SELECT b.booking_id, b.scheduled_start
                      FROM bookings b
                      WHERE b.salon_id = ?
                        AND b.status NOT IN ('CANCELED', 'NO_SHOW')
                      LIMIT 1000
                  `;
                  const [allBookings] = await db.execute(checkBookingsQuery, [salon_id]);
                  
                  let hasBookingsOnWeekday = false;
                  for (const booking of allBookings) {
                      const bookingStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
                      const bookingStartInSalonTz = bookingStart.setZone(salonTimezone);
                      const bookingWeekday = luxonWeekdayToDb(bookingStartInSalonTz.weekday);
                      
                      if (bookingWeekday === weekdayNumber) {
                          hasBookingsOnWeekday = true;
                          break;
                      }
                  }
                  
                  if (hasBookingsOnWeekday) {
                      errors.push(`${weekday}: Cannot delete salon hours. There are existing bookings on this day. Please cancel or reschedule all bookings first.`);
                      continue;
                  }
                  
                  const deleteQuery = `
                      DELETE FROM salon_availability 
                      WHERE salon_id = ? AND weekday = ?
                  `;
                  await db.execute(deleteQuery, [salon_id, weekdayNumber]);
                  results.push({ weekday: weekday.toUpperCase(), action: 'removed' });
                  continue;
              }
              
              if (!hours.start_time || !hours.end_time) {
                  errors.push(`${weekday}: start_time and end_time are required`);
                  continue;
              }
              
              // Validate times using Luxon
              const today = DateTime.now().toFormat('yyyy-MM-dd');
              const startDt = DateTime.fromISO(`${today}T${hours.start_time}`);
              const endDt = DateTime.fromISO(`${today}T${hours.end_time}`);
              
              if (!startDt.isValid || !endDt.isValid) {
                  errors.push(`${weekday}: Invalid time format`);
                  continue;
              }
              
              if (startDt >= endDt) {
                  errors.push(`${weekday}: start_time must be before end_time`);
                  continue;
              }
              
              // Format times for SQL (HH:MM:SS)
              const normalizedStartTime = startDt.toFormat('HH:mm:ss');
              const normalizedEndTime = endDt.toFormat('HH:mm:ss');
              
               const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
               const checkExistingQuery = `
                   SELECT salon_availability_id FROM salon_availability 
                   WHERE salon_id = ? AND weekday = ?
               `;
               const [existingResult] = await db.execute(checkExistingQuery, [salon_id, weekdayNumber]);
              
               //if the day already exists, update it
              if (existingResult.length > 0) {
                  const nowUtc = toMySQLUtc(DateTime.utc());
                  const updateQuery = `
                      UPDATE salon_availability 
                      SET start_time = ?, end_time = ?, updated_at = ?
                      WHERE salon_availability_id = ?
                  `;
                  await db.execute(updateQuery, [normalizedStartTime, normalizedEndTime, nowUtc, existingResult[0].salon_availability_id]);
                  results.push({ 
                      weekday: weekday.toUpperCase(), 
                      action: 'updated',
                      start_time: normalizedStartTime,
                      end_time: normalizedEndTime
                  });
               } 
               //if the day doesn't exist, create it
               else {
                   const nowUtc = toMySQLUtc(DateTime.utc());
                   const insertQuery = `
                       INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                   `;
                   await db.execute(insertQuery, [salon_id, weekdayNumber, normalizedStartTime, normalizedEndTime, nowUtc, nowUtc]);
                   results.push({ 
                       weekday: weekday.toUpperCase(), 
                       action: 'created',
                       start_time: normalizedStartTime,
                       end_time: normalizedEndTime
                   });
              }
              
          } catch (dayError) {
              errors.push(`${weekday}: ${dayError.message}`);
          }
      }
      
       if (errors.length > 0) {
           return res.status(400).json({
               message: 'Salon hours update failed'
           });
       }
       
       return res.status(200).json({
           message: 'Salon hours updated successfully',
           data: {
               results
           }
       });
      
  } catch (error) {
      console.error('setSalonHours error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};

// BS 1.0 - Set employee availability (Owner only)
exports.setEmployeeAvailability = async (req, res) => {
  const db = connection.promise();
  
  try {
      const { employeeId } = req.params;
      const { weekly_availability } = req.body;
      const owner_user_id = req.user?.user_id;
      
      if (!weekly_availability || typeof weekly_availability !== 'object') {
          return res.status(400).json({
              message: 'weekly_availability object is required'
          });
      }
      
     
      const getSalonQuery = 'SELECT salon_id, timezone FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);
      
   
      
       const salon_id = salonResult[0].salon_id;
       const salonTimezone = salonResult[0].timezone || 'America/New_York';
       
       // Get salon operating hours for validation
      const getSalonHoursQuery = `
          SELECT weekday, start_time, end_time 
          FROM salon_availability 
          WHERE salon_id = ?
      `;
      const [salonHoursResult] = await db.execute(getSalonHoursQuery, [salon_id]);
      
      const salonHours = {};
      salonHoursResult.forEach(hour => {
          const dayName = Object.keys(WEEKDAY_TO_NUMBER).find(day => WEEKDAY_TO_NUMBER[day] === hour.weekday);
          if (dayName) {
              salonHours[dayName] = {
                  start_time: hour.start_time,
                  end_time: hour.end_time
              };
          }
      });
      
      const results = [];
      const errors = [];
      
      // Process each day
      for (const [weekday, availability] of Object.entries(weekly_availability)) {
          try {
              // Safety check
              if (!VALID_WEEKDAYS.includes(weekday.toUpperCase())) {
                  errors.push(`${weekday}: Invalid weekday`);
                  continue;
              }
              
            
              const shouldDelete = availability === null || 
                                   availability === false || 
                                   (typeof availability === 'object' && Object.keys(availability).length === 0) ||
                                   (availability && availability.is_available === false);
              
              if (shouldDelete) {
                  const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
                  
                  const checkBookingsQuery = `
                      SELECT b.booking_id, b.scheduled_start
                      FROM bookings b
                      JOIN booking_services bs ON b.booking_id = bs.booking_id
                      WHERE bs.employee_id = ?
                        AND b.status NOT IN ('CANCELED', 'NO_SHOW')
                      LIMIT 1000
                  `;
                  const [employeeBookings] = await db.execute(checkBookingsQuery, [employeeId]);
                  
                  let hasBookingsOnWeekday = false;
                  for (const booking of employeeBookings) {
                      const bookingStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
                      const bookingStartInSalonTz = bookingStart.setZone(salonTimezone);
                      const bookingWeekday = luxonWeekdayToDb(bookingStartInSalonTz.weekday);
                      
                      if (bookingWeekday === weekdayNumber) {
                          hasBookingsOnWeekday = true;
                          break;
                      }
                  }
                  
                  if (hasBookingsOnWeekday) {
                      errors.push(`${weekday}: Cannot delete employee availability. This employee has existing bookings on this day. Please cancel or reschedule all bookings first.`);
                      continue;
                  }
                  
                  const deleteQuery = `
                      DELETE FROM employee_availability 
                      WHERE employee_id = ? AND weekday = ?
                  `;
                  await db.execute(deleteQuery, [employeeId, weekdayNumber]);
                  results.push({ weekday: weekday.toUpperCase(), action: 'removed' });
                  continue;
              }
              
              if (!availability.start_time || !availability.end_time) {
                  errors.push(`${weekday}: start_time and end_time are required`);
                  continue;
              }
              
              // Validate times using Luxon
              const today = DateTime.now().toFormat('yyyy-MM-dd');
              const startDt = DateTime.fromISO(`${today}T${availability.start_time}`);
              const endDt = DateTime.fromISO(`${today}T${availability.end_time}`);
              
              if (!startDt.isValid || !endDt.isValid) {
                  errors.push(`${weekday}: Invalid time format`);
                  continue;
              }
              
              if (startDt >= endDt) {
                  errors.push(`${weekday}: start_time must be before end_time`);
                  continue;
              }
              
              // Check if salon is open on this day
              const dayName = weekday.toUpperCase();
              if (!salonHours[dayName]) {
                  errors.push(`${weekday}: Salon is not open on this day`);
                  continue;
              }
              
              // Validate employee availability is within salon hours
              const salonStart = DateTime.fromISO(`${today}T${salonHours[dayName].start_time}`);
              const salonEnd = DateTime.fromISO(`${today}T${salonHours[dayName].end_time}`);
              
              if (startDt < salonStart || endDt > salonEnd) {
                  errors.push(`${weekday}: Employee availability must be within salon operating hours (${salonHours[dayName].start_time} - ${salonHours[dayName].end_time})`);
                  continue;
              }
              
              // Format times for SQL (HH:MM:SS)
              const normalizedStartTime = startDt.toFormat('HH:mm:ss');
              const normalizedEndTime = endDt.toFormat('HH:mm:ss');
              
              const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
              const checkExistingQuery = `
                  SELECT availability_id FROM employee_availability 
                  WHERE employee_id = ? AND weekday = ?
              `;
              const [existingResult] = await db.execute(checkExistingQuery, [employeeId, weekdayNumber]);
              
              // If the day already exists, update it
              if (existingResult.length > 0) {
                  const nowUtc = toMySQLUtc(DateTime.utc());
                  const updateQuery = `
                      UPDATE employee_availability 
                      SET start_time = ?, end_time = ?, slot_interval_minutes = ?, updated_at = ?
                      WHERE availability_id = ?
                  `;
                  await db.execute(updateQuery, [
                      normalizedStartTime, 
                      normalizedEndTime, 
                      availability.slot_interval_minutes || 30,
                      nowUtc,
                      existingResult[0].availability_id
                  ]);
                  
                  results.push({ 
                      weekday: weekday.toUpperCase(), 
                      action: 'updated',
                      start_time: normalizedStartTime,
                      end_time: normalizedEndTime,
                      slot_interval_minutes: availability.slot_interval_minutes || 30
                  });
              } 
              // If the day doesn't exist, create it
              else {
                  const nowUtc = toMySQLUtc(DateTime.utc());
                  const insertQuery = `
                      INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                  `;
                  await db.execute(insertQuery, [
                      employeeId, 
                      weekdayNumber, 
                      normalizedStartTime, 
                      normalizedEndTime,
                      availability.slot_interval_minutes || 30,
                      nowUtc,
                      nowUtc
                  ]);
                  results.push({ 
                      weekday: weekday.toUpperCase(), 
                      action: 'created',
                      start_time: normalizedStartTime,
                      end_time: normalizedEndTime,
                      slot_interval_minutes: availability.slot_interval_minutes || 30
                  });
              }
              
          } catch (dayError) {
              errors.push(`${weekday}: ${dayError.message}`);
          }
      }
      
      if (errors.length > 0) {
          return res.status(400).json({
              message: 'Employee availability update failed',
              errors: errors
          });
      }
      
       return res.status(200).json({
           message: 'Employee availability updated successfully',
           data: {
               results
           }
       });
      
  } catch (error) {
      console.error('setEmployeeAvailability error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};

// BS 1.0 - Get employee availability (Owner only)
exports.getEmployeeAvailability = async (req, res) => {
  const db = connection.promise();
  
  try {
      const { employeeId } = req.params;
      const owner_user_id = req.user?.user_id;
      

      const getSalonQuery = 'SELECT salon_id FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);

       const salon_id = salonResult[0].salon_id;
       
       // Get employee availability
      const getAvailabilityQuery = `
          SELECT availability_id, employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at
          FROM employee_availability 
          WHERE employee_id = ?
          ORDER BY weekday
      `;
      const [availabilityResult] = await db.execute(getAvailabilityQuery, [employeeId]);
      
      // Get salon operating hours for context
      const getSalonHoursQuery = `
          SELECT weekday, start_time, end_time 
          FROM salon_availability 
          WHERE salon_id = ?
      `;
      const [salonHoursResult] = await db.execute(getSalonHoursQuery, [salon_id]);
      
      const salonHours = {};
      salonHoursResult.forEach(hour => {
          const dayName = Object.keys(WEEKDAY_TO_NUMBER).find(day => WEEKDAY_TO_NUMBER[day] === hour.weekday);
          if (dayName) {
              salonHours[dayName] = {
                  start_time: hour.start_time,
                  end_time: hour.end_time
              };
          }
      });
      
      const weeklyAvailability = {};
      
      VALID_WEEKDAYS.forEach(day => {
          weeklyAvailability[day] = {
              is_available: false,
              start_time: null,
              end_time: null,
              slot_interval_minutes: null,
              salon_hours: salonHours[day] || null
          };
      });
      
      availabilityResult.forEach(avail => {
          const dayName = Object.keys(WEEKDAY_TO_NUMBER).find(day => WEEKDAY_TO_NUMBER[day] === avail.weekday);
          if (dayName) {
              weeklyAvailability[dayName] = {
                  is_available: true,
                  start_time: avail.start_time,
                  end_time: avail.end_time,
                  slot_interval_minutes: avail.slot_interval_minutes,
                  created_at: avail.created_at,
                  updated_at: avail.updated_at,
                  salon_hours: salonHours[dayName] || null
              };
          }
      });
      
       return res.status(200).json({
           data: {
               employee_id: employeeId,
               weekly_availability: weeklyAvailability
           }
       });
      
  } catch (error) {
      console.error('getEmployeeAvailability error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};

// BS 1.0 - Get all employees for owner 
// a duplicate of viewEmployees technically, need to determine which to remove.
exports.getEmployees = async (req, res) => {
  const db = connection.promise();
  
  try {
      const owner_user_id = req.user?.user_id;
      
      const getSalonQuery = 'SELECT salon_id FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);
      

      const salon_id = salonResult[0].salon_id;
      
  
       const getEmployeesQuery = `
           SELECT e.employee_id, e.title, e.active,
                  u.full_name, u.email, u.phone, u.profile_picture_url
           FROM employees e 
           JOIN users u ON e.user_id = u.user_id 
           WHERE e.salon_id = ? AND e.active = 1
           ORDER BY u.full_name ASC
       `;
      const [employeesResult] = await db.execute(getEmployeesQuery, [salon_id]);
      
      return res.status(200).json({
          data: {
              salon_id: salon_id,
              employees: employeesResult
          }
      });
      
  } catch (error) {
      console.error('getEmployees error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};

// BS 1.1 - Get available stylists for a salon (Customer view)
exports.getAvailableStylists = async (req, res) => {
  const db = connection.promise();
  
  try {
      const { salon_id } = req.params;
      
      if (!salon_id || isNaN(salon_id)) {
          return res.status(400).json({ message: 'Invalid salon_id' });
      }
      
      // Get salon information
      const getSalonQuery = 'SELECT salon_id, name, status FROM salons WHERE salon_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [salon_id]);
      
      //Should never occur but just in case
      if (salonResult.length === 0) {
          return res.status(404).json({ message: 'Salon not found' });
      }
      
      
      // Get active stylists for this salon
      const getStylistsQuery = `
          SELECT e.employee_id, e.title, e.active,
                 u.full_name, u.email, u.phone, u.profile_picture_url
          FROM employees e 
          JOIN users u ON e.user_id = u.user_id 
          WHERE e.salon_id = ? AND e.active = 1
          ORDER BY u.full_name ASC
      `;
      const [stylistsResult] = await db.execute(getStylistsQuery, [salon_id]);
      
      return res.status(200).json({
          data: {
              salon: {
                  salon_id: salonResult[0].salon_id,
                  name: salonResult[0].name,
                  status: salonResult[0].status
              },
              stylists: stylistsResult
          }
      });
      
  } catch (error) {
      console.error('getAvailableStylists error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};


// BS 1.1 - Get available time slots for a stylist (multiple days)
exports.getAvailableTimeSlotsRange = async (req, res) => {
  const db = connection.promise();
  
  try {
      const { salon_id, employee_id } = req.params;
      const { start_date, end_date, days = 7, service_duration = 30 } = req.query;
      
      if (!salon_id || isNaN(salon_id) || !employee_id || isNaN(employee_id)) {
          return res.status(400).json({ message: 'Missing required fields: salon_id or employee_id' });
      }
      
      const serviceDurationMinutes = parseInt(service_duration);
      if (isNaN(serviceDurationMinutes) || serviceDurationMinutes <= 0) {
          return res.status(400).json({ message: 'Invalid service_duration. Must be a positive number (minutes)' });
      }
    
      // Get salon timezone FIRST
      const getSalonQuery = 'SELECT salon_id, name, status, timezone FROM salons WHERE salon_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [salon_id]);
      
      if (salonResult.length === 0) {
          return res.status(404).json({ message: 'Salon not found' });
      }
      //This should never occur but just in case
      if (salonResult[0].status !== 'APPROVED') {
          return res.status(403).json({ message: 'Salon is not available for booking' });
      }
      
      const salonTimezone = salonResult[0].timezone || 'America/New_York';
      
      // Get today's date string in salon timezone for comparison
      const todayInSalonTz = DateTime.now().setZone(salonTimezone);
      const todayDateStr = todayInSalonTz.toFormat('yyyy-MM-dd');
      
      // Determine date range - use UTC for processing
      let startDate, endDate;
      
      if (start_date && end_date) {
          startDate = DateTime.fromISO(start_date + 'T00:00:00Z', { zone: 'utc' });
          endDate = DateTime.fromISO(end_date + 'T00:00:00Z', { zone: 'utc' });
      } else if (start_date) {
          startDate = DateTime.fromISO(start_date + 'T00:00:00Z', { zone: 'utc' });
          endDate = startDate.plus({ days: parseInt(days) - 1 });
      } else {
          // Default to next 7 days from today (UTC)
          const todayUTC = DateTime.utc().startOf('day');
          startDate = todayUTC;
          endDate = todayUTC.plus({ days: parseInt(days) - 1 });
      }
      
      // Validate dates
      if (!startDate.isValid || !endDate.isValid) {
          return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
      }
      
      // Compare date strings (both normalized to salon timezone)
      if (start_date && start_date < todayDateStr) {
          return res.status(400).json({ message: 'Start date cannot be in the past' });
      }
      
      if (endDate < startDate) {
          return res.status(400).json({ message: 'End date must be on or after start date' });
      }
      
      // Limit to max range (30 days)
      const maxDays = 30;
      const daysDiff = endDate.diff(startDate, 'days').days + 1;
      if (daysDiff > maxDays) {
          return res.status(400).json({ message: `Date range cannot exceed ${maxDays} days` });
      }
      
      // Verify stylist exists and is active
      const getEmployeeQuery = `
          SELECT e.employee_id, e.title, u.full_name
          FROM employees e 
          JOIN users u ON e.user_id = u.user_id 
          WHERE e.employee_id = ? AND e.salon_id = ? AND e.active = 1
      `;
      const [employeeResult] = await db.execute(getEmployeeQuery, [employee_id, salon_id]);
      
      if (employeeResult.length === 0) {
          return res.status(404).json({ message: 'Stylist not found or not available' });
      }
      
      // Get all employee availability
      const getAvailabilityQuery = `
          SELECT weekday, start_time, end_time, slot_interval_minutes
          FROM employee_availability 
          WHERE employee_id = ?
          ORDER BY weekday
      `;
      const [availabilityResult] = await db.execute(getAvailabilityQuery, [employee_id]);
      
      // Get all employee unavailability
      const getUnavailabilityQuery = `
          SELECT weekday, start_time, end_time
          FROM employee_unavailability 
          WHERE employee_id = ?
          ORDER BY weekday, start_time
      `;
      const [unavailabilityResult] = await db.execute(getUnavailabilityQuery, [employee_id]);
      
      // Get existing bookings for the date range
      // Use DATE_FORMAT to return SQL format (YYYY-MM-DD HH:mm:ss) instead of ISO
      const getBookingsQuery = `
          SELECT DISTINCT 
              DATE_FORMAT(b.scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
              DATE_FORMAT(b.scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
              b.status
          FROM bookings b
          JOIN booking_services bs ON b.booking_id = bs.booking_id
          WHERE bs.employee_id = ? 
          AND b.scheduled_start < ? 
          AND b.scheduled_end > ?
          AND b.status NOT IN ('CANCELED', 'NO_SHOW')
          ORDER BY scheduled_start
      `;
      const startDateUtc = toMySQLUtc(startDate);
      const endDateUtc = toMySQLUtc(endDate.endOf('day')); // End of day
      const [bookingsResult] = await db.execute(getBookingsQuery, [employee_id, endDateUtc, startDateUtc]);
      
      // Create availability map by weekday
      const availabilityMap = {};
      availabilityResult.forEach(avail => {
          availabilityMap[avail.weekday] = avail;
      });
      
      // Create unavailability map by weekday
      const unavailabilityMap = {};
      unavailabilityResult.forEach(unavail => {
          if (!unavailabilityMap[unavail.weekday]) {
              unavailabilityMap[unavail.weekday] = [];
          }
          unavailabilityMap[unavail.weekday].push(unavail);
      });
      
      // Parse all bookings once - we'll check ALL bookings against ALL slots
      const allBookings = [];
      bookingsResult.forEach(booking => {
          const bookingStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
          const bookingEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
          if (bookingStart.isValid && bookingEnd.isValid) {
              allBookings.push({
                  start: bookingStart,
                  end: bookingEnd,
                  status: booking.status
              });
          }
      });
      
      // Generate time slots for each day
      const dailySlots = {};
      let currentDate = startDate;
      
      while (currentDate <= endDate) {
          const dateStr = currentDate.toFormat('yyyy-MM-dd');
          // Convert Luxon weekday to database weekday
          const dayOfWeek = luxonWeekdayToDb(currentDate.weekday);
          const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
          
          const availability = availabilityMap[dayOfWeek];
          const unavailability = unavailabilityMap[dayOfWeek] || [];
          
          if (!availability) {
              dailySlots[dateStr] = {
                  date: dateStr,
                  day_name: dayName,
                  available_slots: [],
                  message: 'No availability set for this day'
              };
          } else {
              const allSlots = [];
              const availabilityStart = localAvailabilityToUtc(availability.start_time, dateStr, salonTimezone);
              const availabilityEnd = localAvailabilityToUtc(availability.end_time, dateStr, salonTimezone);
              const slotIntervalMinutes = availability.slot_interval_minutes || 30;
              
              logUtcDebug(`getAvailableTimeSlotsRange ${dateStr} availabilityStart`, availabilityStart);
              logUtcDebug(`getAvailableTimeSlotsRange ${dateStr} availabilityEnd`, availabilityEnd);
              
              // Collect all blocked time ranges with their types
              const blockedTimes = [];
              
              // Track unavailability blocks
              unavailability.forEach(block => {
                  blockedTimes.push({
                      start: localAvailabilityToUtc(block.start_time, dateStr, salonTimezone),
                      end: localAvailabilityToUtc(block.end_time, dateStr, salonTimezone),
                      type: 'blocked' // unavailability block
                  });
              });
              
              // Track bookings - check ALL bookings, not just ones for this date
              // A booking can overlap with slots on any day in the range
              allBookings.forEach(booking => {
                  blockedTimes.push({
                      start: booking.start,
                      end: booking.end,
                      type: 'booked' // existing booking
                  });
              });
              
              const getSlotBlockReason = (slotStart, slotEnd) => {
                  const slotStartUtc = slotStart.toUTC();
                  const slotEndUtc = slotEnd.toUTC();
                  
                  for (const blocked of blockedTimes) {
                      const blockedStartUtc = blocked.start.toUTC();
                      const blockedEndUtc = blocked.end.toUTC();
                      
                      const overlaps = (slotStartUtc < blockedEndUtc) && (blockedStartUtc < slotEndUtc);
                      
                      if (overlaps) {
                          logUtcDebug(`getAvailableTimeSlotsRange ${dateStr} slot blocked`, {
                              slotStart: slotStartUtc.toISO(),
                              slotEnd: slotEndUtc.toISO(),
                              blockedStart: blockedStartUtc.toISO(),
                              blockedEnd: blockedEndUtc.toISO(),
                              type: blocked.type
                          });
                          return blocked.type; // Return 'booked' or 'blocked'
                      }
                  }
                  return null; // Slot is available
              };
              
              const now = DateTime.utc();
              const todayStr = now.toFormat('yyyy-MM-dd');
              const isCurrentDay = dateStr === todayStr;
              
              // Generate all possible slots within availability window
              let slotStart = availabilityStart;
              
              // If current day, skip past slots
              if (isCurrentDay && slotStart < now) {
                  // Round up to next slot interval
                  const minutesSinceStartOfHour = now.minute + (now.second / 60);
                  const roundedMinutes = Math.ceil(minutesSinceStartOfHour / slotIntervalMinutes) * slotIntervalMinutes;
                  const roundedNow = now.startOf('hour').plus({ minutes: roundedMinutes });
                  slotStart = roundedNow > slotStart ? roundedNow : slotStart;
              }
              
              // Generate all slots from start to end
              // Slots are spaced by serviceDurationMinutes (non-overlapping)
              while (slotStart < availabilityEnd) {
                  const slotEnd = slotStart.plus({ minutes: serviceDurationMinutes });
                  
                  // Skip this slot if it extends past the availability end time
                  if (slotEnd > availabilityEnd) {
                      break;
                  }
                  
                  // Check if this slot is blocked and get the reason
                  const blockReason = getSlotBlockReason(slotStart, slotEnd);
                  const isBlocked = blockReason !== null;
                  
                  // Convert to salon local timezone for display
                  const slotStartLocal = slotStart.setZone(salonTimezone);
                  const slotEndLocal = slotEnd.setZone(salonTimezone);
                  
                  // Build slot object
                  const slot = {
                      start_time: slotStart.toISO(),
                      end_time: slotEnd.toISO(),
                      display_start_time: slotStartLocal.toISO(),
                      display_end_time: slotEndLocal.toISO(),
                      available: !isBlocked
                  };
                  
                  // Add unavailable_reason if slot is not available
                  if (!isBlocked) {
                      // Slot is available, no reason needed
                  } else {
                      // Slot is unavailable, add reason
                      slot.unavailable_reason = blockReason || 'unavailable';
                  }
                  
                  allSlots.push(slot);
                  
                  // Move to next slot - use serviceDurationMinutes for spacing
                  slotStart = slotStart.plus({ minutes: serviceDurationMinutes });
              }
              
              dailySlots[dateStr] = {
                  date: dateStr,
                  day_name: dayName,
                  availability: {
                      start_time: availability.start_time,
                      end_time: availability.end_time
                  },
                  available_slots: allSlots,
                  total_slots: allSlots.length
              };
          }
          
          currentDate = currentDate.plus({ days: 1 });
      }
      
      return res.status(200).json({
          data: {
              stylist: {
                  employee_id: employee_id,
                  name: employeeResult[0].full_name,
                  title: employeeResult[0].title
              },
              date_range: {
                  start_date: startDate.toFormat('yyyy-MM-dd'),
                  end_date: endDate.toFormat('yyyy-MM-dd'),
                  total_days: daysDiff
              },
              daily_slots: dailySlots
          }
      });
      
  } catch (error) {
      console.error('getAvailableTimeSlotsRange error:', error);
      return res.status(500).json({
          message: 'Internal server error'
      });
  }
};

// BS 1.01 - Stylist creates a service and adds it to their profile
exports.createAndAddServiceToStylist = async (req, res) => {
  const db = connection.promise();
  
  try {
    const { name, description, duration_minutes, price } = req.body;
    const user_id = req.user?.user_id; //Need to fix

    
    
    if (!name || !description || !duration_minutes || !price) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    if (typeof name !== 'string' || typeof description !== 'string') {
      return res.status(400).json({ message: 'Name and description must be strings' });
    }
    
    if (isNaN(duration_minutes) || duration_minutes <= 0) {
      return res.status(400).json({ message: 'Duration must be a positive number' });
    }
    
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ message: 'Price must be a positive number' });
    }
    
    const getEmployeeQuery = `
      SELECT e.employee_id, e.salon_id 
      FROM employees e 
      WHERE e.user_id = ? AND e.active = 1
    `;
    const [employeeResult] = await db.execute(getEmployeeQuery, [user_id]);
    
    const employee_id = employeeResult[0].employee_id;
    const salon_id = employeeResult[0].salon_id;
    
    // Check if employee already has a service with this name (fuzzy matching)
    // Get all existing services for this employee
    const getAllServicesQuery = `
      SELECT s.name
      FROM employee_services es
      JOIN services s ON es.service_id = s.service_id
      WHERE es.employee_id = ?
    `;
    const [existingServices] = await db.execute(getAllServicesQuery, [employee_id]);
    
    // Normalize the new service name
    const normalizedNewName = normalizeServiceName(name);
    
    // Check if any existing service normalizes to the same name
    const duplicateService = existingServices.find(service => 
      normalizeServiceName(service.name) === normalizedNewName
    );
    
    if (duplicateService) {
      return res.status(409).json({ 
        message: 'You already have a service with this name in your profile',
        data: {
          existing_service: duplicateService.name
        }
      });
    }
    
    await db.query('START TRANSACTION');
    
    try {
      const nowUtc = toMySQLUtc(DateTime.utc());
      const createServiceQuery = `
        INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `;
      const [serviceResult] = await db.execute(createServiceQuery, [
        salon_id, 
        name, 
        description, 
        duration_minutes, 
        price,
        nowUtc,
        nowUtc
      ]);
      
      const service_id = serviceResult.insertId;
      
      const linkServiceQuery = `
        INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `;
      await db.execute(linkServiceQuery, [employee_id, service_id, nowUtc, nowUtc]);
      
      await db.query('COMMIT');
      
      return res.status(201).json({
        message: 'Service created and added to profile successfully',
        data: {
          service: {
            service_id: service_id,
            salon_id: salon_id,
            name: name,
            description: description,
            duration_minutes: duration_minutes,
            price: parseFloat(price),
            active: true
          },
          employee: {
            employee_id: employee_id
          }
        }
      });
      
    } catch (transactionError) {
      await db.query('ROLLBACK');
      throw transactionError;
    }
    
  } catch (error) {
    console.error('createAndAddServiceToStylist error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};

// BS 1.01 - Stylist removes services from their profile
exports.removeServiceFromStylist = async (req, res) => {
  const db = connection.promise();
  
  try {
    const { service_id } = req.params;
    const user_id = req.user?.user_id;
    
    if (!service_id || isNaN(service_id)) {
      return res.status(400).json({ message: 'Invalid service_id' });
    }
    
    const getEmployeeQuery = `
      SELECT e.employee_id, e.salon_id 
      FROM employees e 
      WHERE e.user_id = ? AND e.active = 1
    `;
    const [employeeResult] = await db.execute(getEmployeeQuery, [user_id]);
    

    const employee_id = employeeResult[0].employee_id;
    
    const getServiceLinkQuery = `
      SELECT s.name as service_name
      FROM employee_services es
      JOIN services s ON es.service_id = s.service_id
      WHERE es.employee_id = ? AND es.service_id = ?
    `;
    const [serviceLinkResult] = await db.execute(getServiceLinkQuery, [employee_id, service_id]);
    
    if (serviceLinkResult.length === 0) {
      return res.status(404).json({ message: 'Service not found in your profile' });
    }
    
    const checkActiveBookingsQuery = `
      SELECT b.booking_id, b.scheduled_start, b.status
      FROM bookings b
      JOIN booking_services bs ON b.booking_id = bs.booking_id
      WHERE bs.service_id = ? 
      AND b.status NOT IN ('CANCELED', 'COMPLETED')
      LIMIT 1
    `;
    const [activeBookings] = await db.execute(checkActiveBookingsQuery, [service_id]);
    
    if (activeBookings.length > 0) {
      logUtcDebug('salonController.removeServiceFromStylist raw scheduled_start', activeBookings[0].scheduled_start);
      return res.status(409).json({ 
        message: 'Cannot remove service that has active bookings. Please cancel or complete all related bookings first.',
        data: {
          booking_id: activeBookings[0].booking_id,
          scheduled_start: formatDateTime(activeBookings[0].scheduled_start),
          status: activeBookings[0].status
        }
      });
    }
    
    await db.query('START TRANSACTION');
    
    try {
      const deleteEmployeeServiceQuery = `
        DELETE FROM employee_services 
        WHERE employee_id = ? AND service_id = ?
      `;
      const [result] = await db.execute(deleteEmployeeServiceQuery, [employee_id, service_id]);
      
      if (result.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ message: 'Service could not be removed' });
      }
      
      try {
        await db.execute(
          'DELETE FROM services WHERE service_id = ?',
          [service_id]
        );
      } catch (deleteServiceError) {
        await db.query('ROLLBACK');
        console.error('Error deleting service from services table:', deleteServiceError);
        return res.status(500).json({ 
          message: 'Failed to delete service from services table',
          error: deleteServiceError.message
        });
      }
      
      await db.query('COMMIT');
      
      return res.status(200).json({
        message: 'Service removed from profile successfully',
        data: {
          employee_id: employee_id,
          service: {
            service_id: parseInt(service_id),
            name: serviceLinkResult[0].service_name
          }
        }
      });
      
    } catch (transactionError) {
      await db.query('ROLLBACK');
      throw transactionError;
    }
    
  } catch (error) {
    console.error('removeServiceFromStylist error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};

// BS 1.01 - Stylist updates a service in their profile
exports.updateServiceFromStylist = async (req, res) => {
  const db = connection.promise();
  
  try {
    const { service_id } = req.params;
    const user_id = req.user?.user_id;
    
    if (!service_id || isNaN(service_id)) {
      return res.status(400).json({ message: 'Invalid service_id' });
    }
    
    // Handle missing or empty request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'Request body is required' });
    }
    
    const { name, description, duration_minutes, price } = req.body;
    
    // Validate that at least one field is provided
    if (!name && !description && !duration_minutes && !price) {
      return res.status(400).json({ message: 'At least one field must be provided for update' });
    }
    
    // Validate provided fields
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ message: 'Name must be a string' });
    }
    
    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({ message: 'Description must be a string' });
    }
    
    if (duration_minutes !== undefined && (isNaN(duration_minutes) || duration_minutes <= 0)) {
      return res.status(400).json({ message: 'Duration must be a positive number' });
    }
    
    if (price !== undefined && (isNaN(price) || price <= 0)) {
      return res.status(400).json({ message: 'Price must be a positive number' });
    }
    
    const getEmployeeQuery = `
      SELECT e.employee_id, e.salon_id 
      FROM employees e 
      WHERE e.user_id = ? AND e.active = 1
    `;
    const [employeeResult] = await db.execute(getEmployeeQuery, [user_id]);
    
    if (employeeResult.length === 0) {
      return res.status(404).json({ message: 'Employee profile not found' });
    }
    
    const employee_id = employeeResult[0].employee_id;
    const salon_id = employeeResult[0].salon_id;
    
    // Check if service exists and is linked to this stylist
    const getServiceQuery = `
      SELECT s.service_id, s.name, s.description, s.duration_minutes, s.price, s.salon_id
      FROM employee_services es
      JOIN services s ON es.service_id = s.service_id
      WHERE es.employee_id = ? AND es.service_id = ?
    `;
    const [serviceResult] = await db.execute(getServiceQuery, [employee_id, service_id]);
    
    if (serviceResult.length === 0) {
      return res.status(404).json({ message: 'Service not found in your profile' });
    }
    
    // Verify the service belongs to this salon
    if (serviceResult[0].salon_id !== salon_id) {
      return res.status(403).json({ message: 'Service does not belong to your salon' });
    }
    
    // Build the update query dynamically based on provided fields
    const updateFields = [];
    const updateValues = [];
    
    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }
    if (duration_minutes !== undefined) {
      updateFields.push('duration_minutes = ?');
      updateValues.push(duration_minutes);
    }
    if (price !== undefined) {
      updateFields.push('price = ?');
      updateValues.push(price);
    }
    
    const nowUtc = toMySQLUtc(DateTime.utc());
    updateFields.push('updated_at = ?');
    updateValues.push(nowUtc);
    updateValues.push(service_id);
    
    const updateQuery = `
      UPDATE services 
      SET ${updateFields.join(', ')}
      WHERE service_id = ?
    `;
    
    const [updateResult] = await db.execute(updateQuery, updateValues);
    
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ message: 'Service could not be updated' });
    }
    
    // Get the updated service
    const getUpdatedServiceQuery = `
      SELECT s.service_id, s.salon_id, s.name, s.description, s.duration_minutes, s.price, s.active
      FROM services s
      WHERE s.service_id = ?
    `;
    const [updatedService] = await db.execute(getUpdatedServiceQuery, [service_id]);
    
    return res.status(200).json({
      message: 'Service updated successfully',
      data: {
        employee_id: employee_id,
        service: {
          service_id: updatedService[0].service_id,
          salon_id: updatedService[0].salon_id,
          name: updatedService[0].name,
          description: updatedService[0].description,
          duration_minutes: updatedService[0].duration_minutes,
          price: parseFloat(updatedService[0].price),
          active: updatedService[0].active
        }
      }
    });
    
  } catch (error) {
    console.error('updateServiceFromStylist error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};

// BS 1.01/1.1 - Get stylist services (works for both authenticated stylist and browsing customers)
//Can always split but for now keeping it all in one function
exports.getStylistServices = async (req, res) => {
  const db = connection.promise();
  
  try {
    const { salon_id: param_salon_id, employee_id: param_employee_id } = req.params;
    const employee_user_id = req.user?.user_id;
    const userRole = req.user?.role; //Required to check if customer or stylist is viewing
    //Different because:
    //customer needs salon_id to browse services
    //and stylist only needs their user_id to view their own services
    
    let employee_id, salon_id, employeeData;
    // If employee_id is provided in params, we're browsing (customer view)
    if (param_employee_id && param_salon_id) {
      if (isNaN(param_employee_id) || isNaN(param_salon_id)) {
        return res.status(400).json({ message: 'Invalid salon_id or employee_id' });
      }
      
      // Verify salon exists and is approved (only for customer browsing)
      if (userRole === 'CUSTOMER') {
        const getSalonQuery = 'SELECT status FROM salons WHERE salon_id = ?';
        const [salonResult] = await db.execute(getSalonQuery, [param_salon_id]);
        
        if (salonResult.length === 0) {
          return res.status(404).json({ message: 'Salon not found' });
        }
        
        if (salonResult[0].status !== 'APPROVED') {
          return res.status(403).json({ message: 'Salon is not available' });
        }
      }
      
      const getEmployeeQuery = `
        SELECT e.employee_id, e.title, u.full_name, e.salon_id
        FROM employees e
        JOIN users u ON e.user_id = u.user_id
        WHERE e.employee_id = ? AND e.salon_id = ? AND e.active = 1
      `;
      const [employeeResult] = await db.execute(getEmployeeQuery, [param_employee_id, param_salon_id]);
      
      if (employeeResult.length === 0) {
        return res.status(404).json({ message: 'Stylist not found or not available' });
      }
      
      employee_id = param_employee_id;
      salon_id = employeeResult[0].salon_id;
      employeeData = {
        employee_id: employeeResult[0].employee_id,
        name: employeeResult[0].full_name,
        title: employeeResult[0].title
      };
    } 
    // Authenticated stylist viewing their own services
    else {
      const getEmployeeQuery = `
        SELECT e.employee_id, e.salon_id, e.title 
        FROM employees e 
        WHERE e.user_id = ? AND e.active = 1
      `;
      const [employeeResult] = await db.execute(getEmployeeQuery, [employee_user_id]);
      
      if (employeeResult.length === 0) {
        return res.status(404).json({ message: 'Employee profile not found' });
      }
      
      employee_id = employeeResult[0].employee_id;
      salon_id = employeeResult[0].salon_id;
      employeeData = {
        employee_id: employee_id,
        title: employeeResult[0].title,
        salon_id: salon_id
      };
    }
    
    const getServicesQuery = `
      SELECT s.service_id, s.name, s.description, s.duration_minutes, s.price, s.active,
             es.created_at, es.updated_at
      FROM employee_services es
      JOIN services s ON es.service_id = s.service_id
      WHERE es.employee_id = ?
      ORDER BY s.name ASC
    `;
    const [servicesResult] = await db.execute(getServicesQuery, [employee_id]);
    
    const responseData = {
      ...(param_employee_id ? { stylist: employeeData } : { employee: employeeData }),
      services: servicesResult.map(service => ({
        service_id: service.service_id,
        name: service.name,
        description: service.description,
        duration_minutes: service.duration_minutes,
        price: service.price,
        // Include active field for customer browse views
        ...(param_employee_id && { active: service.active })
      })),
      total_services: servicesResult.length
    };
    
    return res.status(200).json({
      data: responseData
    });
    
  } catch (error) {
    console.error('getStylistServices error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};
// Get all services available at a salon (for customers to browse)
exports.browseSalonServices = async (req, res) => {
  const db = connection.promise();
  
  try {
    const { salon_id } = req.params;
    
    if (!salon_id || isNaN(salon_id)) {
      return res.status(400).json({ message: 'Invalid salon_id' });
    }
    
    const getSalonQuery = 'SELECT salon_id, name, status FROM salons WHERE salon_id = ?';
    const [salonResult] = await db.execute(getSalonQuery, [salon_id]);
    
    if (salonResult.length === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }
    
    
    const getServicesQuery = `
      SELECT service_id, name, description, duration_minutes, price, active, created_at, updated_at
      FROM services 
      WHERE salon_id = ? AND active = 1
      ORDER BY name ASC
    `;
    const [servicesResult] = await db.execute(getServicesQuery, [salon_id]);
    
    return res.status(200).json({
      data: {
        salon: {
          salon_id: salonResult[0].salon_id,
          name: salonResult[0].name
        },
        services: servicesResult.map(service => ({
          service_id: service.service_id,
          name: service.name,
          description: service.description,
          duration_minutes: service.duration_minutes,
          price: service.price
        })),
        total_services: servicesResult.length
      }
    });
    
  } catch (error) {
    console.error('browseSalonServices error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};


// BS 1.1 - Book a time slot for a customer
exports.bookTimeSlot = async (req, res) => {
  const db = connection.promise();

  try {
    const { salon_id, employee_id } = req.params;
    const { scheduled_start, services, notes = ''} = req.body;
    const customer_user_id = req.user?.user_id;



    if (!salon_id || isNaN(salon_id) || !employee_id || isNaN(employee_id)) {
      return res.status(400).json({ message: 'Invalid salon_id or employee_id' });
    }
    if (!scheduled_start) {
      return res.status(400).json({ message: 'scheduled_start is required' });
    }
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ message: 'At least one service is required' });
    }

    let startDate;
    if (typeof scheduled_start === 'string') {
      const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(scheduled_start);
      if (!hasTimezone) {
        return res.status(400).json({
          message: 'scheduled_start must include a timezone offset (e.g., 2025-11-12T09:00:00-05:00 or 2025-11-12T14:00:00Z)'
        });
      }
      startDate = DateTime.fromISO(scheduled_start);
    } else {
      return res.status(400).json({
        message: 'scheduled_start must be a string in ISO 8601 format with timezone'
      });
    }

    if (!startDate.isValid) {
      return res.status(400).json({
        message: `Invalid scheduled_start: ${startDate.invalidReason || 'Invalid format'}. Provide a valid ISO 8601 datetime with timezone.`
      });
    }
    
    // Convert to UTC for consistent processing
    startDate = startDate.toUTC();
    
    const [salonTimezoneResult] = await db.execute(
      'SELECT timezone FROM salons WHERE salon_id = ?',
      [salon_id]
    );
    const salonTimezone = salonTimezoneResult[0]?.timezone || 'America/New_York';
    
    const now = DateTime.utc();
    if (startDate < now) {
      return res.status(400).json({ message: 'Cannot book appointments in the past' });
    }

    const serviceIds = services.map(s => s.service_id);
    const placeholders = serviceIds.map(() => '?').join(',');
    const [serviceDetails] = await db.execute(
      `SELECT service_id, duration_minutes, price, salon_id, name
       FROM services
       WHERE service_id IN (${placeholders})`,
      serviceIds
    );

    if (serviceDetails.length !== serviceIds.length) {
      return res.status(400).json({ message: 'One or more services not found' });
    }

    for (const s of serviceDetails) {
      if (s.salon_id !== parseInt(salon_id)) {
        return res.status(400).json({ message: `Service ${s.name} does not belong to this salon` });
      }
    }

    const totalDurationMinutes = serviceDetails.reduce((sum, s) => sum + s.duration_minutes, 0);
    const endDate = startDate.plus({ minutes: totalDurationMinutes });

    // Create detailsById mapping for later use
    const detailsById = {};
    serviceDetails.forEach(s => { detailsById[s.service_id] = s; });

    const [employeeResult] = await db.execute(
      `SELECT e.employee_id, e.title, u.full_name
       FROM employees e
       JOIN users u ON e.user_id = u.user_id
       WHERE e.employee_id = ? AND e.salon_id = ? AND e.active = 1`,
      [employee_id, salon_id]
    );
    
    if (employeeResult.length === 0) {
      return res.status(404).json({ message: 'Employee not found or inactive' });
    }

    const [employeeServices] = await db.execute(
      `SELECT service_id FROM employee_services WHERE employee_id = ? AND service_id IN (${placeholders})`,
      [employee_id, ...serviceIds]
    );

    if (employeeServices.length !== serviceIds.length) {
      const offeredServiceIds = employeeServices.map(es => es.service_id);
      const missingServices = serviceIds.filter(sid => !offeredServiceIds.includes(sid));
      const missingServiceNames = serviceDetails
        .filter(s => missingServices.includes(s.service_id))
        .map(s => s.name);
      
      return res.status(400).json({ 
        message: `This employee does not offer the following service(s): ${missingServiceNames.join(', ')}` 
      });
    }

    // Pull all weekday availability for stylist
    const [availabilityResult] = await db.execute(
      `SELECT weekday, start_time, end_time
       FROM employee_availability
       WHERE employee_id = ?`,
      [employee_id]
    );
    if (availabilityResult.length === 0) {
      return res.status(400).json({ message: 'Stylist has no availability set' });
    }

    //Get the day of the week for the booking in SALON timezone (not UTC!)
    const startDateInSalonTz = startDate.setZone(salonTimezone);
    const bookingDayOfWeek = luxonWeekdayToDb(startDateInSalonTz.weekday);
    
    const dayAvailability = availabilityResult.find(a => a.weekday === bookingDayOfWeek);
    if (!dayAvailability) {
      return res.status(400).json({ message: 'Stylist is not available on this day' });
    }

    // Build YYYY-MM-DD for the booking date in SALON timezone (not UTC!)
    const dayStr = startDateInSalonTz.toFormat('yyyy-MM-dd');

    // Convert availability to UTC using salon timezone (not request offset)
    const availStart = localAvailabilityToUtc(dayAvailability.start_time, dayStr, salonTimezone);
    const availEnd   = localAvailabilityToUtc(dayAvailability.end_time, dayStr, salonTimezone);
    
    logUtcDebug('salonController.bookTimeSlot availStart (UTC)', availStart);
    logUtcDebug('salonController.bookTimeSlot availEnd (UTC)', availEnd);
    
    if (startDate < availStart || endDate > availEnd) {
      return res.status(400).json({
        message: `Booking time must be within stylist's availability (${dayAvailability.start_time} - ${dayAvailability.end_time})`
      });
    }

    // Unavailability overlap
    const [unavailabilityResult] = await db.execute(
      `SELECT start_time, end_time
       FROM employee_unavailability
       WHERE employee_id = ? AND weekday = ?`,
      [employee_id, bookingDayOfWeek]
    );

    const hasUnavailabilityConflict = unavailabilityResult.some(block => {
      const blockStart = localAvailabilityToUtc(block.start_time, dayStr, salonTimezone);
      const blockEnd   = localAvailabilityToUtc(block.end_time, dayStr, salonTimezone);
      return (startDate < blockEnd) && (blockStart < endDate);
    });

    if (hasUnavailabilityConflict) {
      return res.status(409).json({ message: 'Stylist is unavailable during this time slot' });
    }

    logUtcDebug('salonController.bookTimeSlot computed startDate', startDate);
    logUtcDebug('salonController.bookTimeSlot computed endDate', endDate);

    // Format as UTC for database storage
    const requestStartStr = toMySQLUtc(startDate);
    const requestEndStr   = toMySQLUtc(endDate);
    logUtcDebug('salonController.bookTimeSlot requestStartStr', requestStartStr);
    logUtcDebug('salonController.bookTimeSlot requestEndStr', requestEndStr);

    // Check conflicts with existing bookings
    const [conflictsResult] = await db.execute(
      `SELECT b.booking_id, b.scheduled_start, b.scheduled_end
       FROM bookings b
       JOIN booking_services bs ON b.booking_id = bs.booking_id
       WHERE bs.employee_id = ?
         AND b.status NOT IN ('CANCELED', 'NO_SHOW')
         AND b.scheduled_start < ?
         AND b.scheduled_end > ?`,
      [employee_id, requestEndStr, requestStartStr]
    );

    if (conflictsResult.length > 0) {
      const conflictStart = DateTime.fromSQL(conflictsResult[0].scheduled_start, { zone: 'utc' });
      logUtcDebug('salonController.bookTimeSlot raw scheduled_start', conflictStart);
      return res.status(409).json({
        message: 'Time slot is no longer available. Please select a different time.',
        conflicting_booking: {
          booking_id: conflictsResult[0].booking_id,
          scheduled_start: formatDateTime(conflictsResult[0].scheduled_start),
          scheduled_end: formatDateTime(conflictsResult[0].scheduled_end)
        }
      });
    }

    await db.query('START TRANSACTION');
    try {

      logUtcDebug('salonController.bookTimeSlot inserting booking scheduled_start', requestStartStr);
      logUtcDebug('salonController.bookTimeSlot inserting booking scheduled_end', requestEndStr);

      const nowUtc = toMySQLUtc(DateTime.utc());
      const [bookingResult] = await db.execute(
        `INSERT INTO bookings
           (salon_id, customer_user_id, scheduled_start, scheduled_end, status, notes, created_at, updated_at)
         VALUES
           (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        [salon_id, customer_user_id, requestStartStr, requestEndStr, notes, nowUtc, nowUtc]
      );

      const booking_id = bookingResult.insertId;

      // Link services to booking
      for (const s of services) {
        const sd = detailsById[s.service_id];
        await db.execute(
          `INSERT INTO booking_services
             (booking_id, employee_id, service_id, price, duration_minutes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [booking_id, employee_id, s.service_id, sd.price, sd.duration_minutes, nowUtc, nowUtc]
        );
      }

      const totalPrice = services.reduce((sum, s) => sum + Number(detailsById[s.service_id].price), 0);

      logUtcDebug('salonController.bookTimeSlot response scheduled_start', startDate);
      logUtcDebug('salonController.bookTimeSlot response scheduled_end', endDate);

      await db.query('COMMIT');

      return res.status(201).json({
        message: 'Appointment booked successfully',
        data: {
          booking_id,
          stylist: {
            employee_id: parseInt(employee_id),
            name: employeeResult[0].full_name,
            title: employeeResult[0].title
          },
          appointment: {
            scheduled_start: formatDateTime(startDate),
            scheduled_end: formatDateTime(endDate),
            duration_minutes: Math.round(endDate.diff(startDate, 'minutes').minutes),
            status: 'PENDING'
          },
          services: services.map(s => ({
            service_id: s.service_id,
            service_name: detailsById[s.service_id].name,
            duration_minutes: detailsById[s.service_id].duration_minutes,
            price: Number(detailsById[s.service_id].price)
          })),
          total_price: totalPrice,
          notes,
          created_at: DateTime.utc().toISO()
        }
      });

    } catch (DBerror) {
      await db.query('ROLLBACK');
      throw DBerror;
    }

  } catch (error) {
    console.error('bookTimeSlot error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


// Get Salon Information
exports.getSalonInfo = async (req, res) => {
  const db = connection.promise();

  try {
    const { salon_id } = req.params; 
    const [salonResult] = await db.execute(
      'SELECT salon_id, name, description, category, phone, email, address, city, state, postal_code, country FROM salons WHERE salon_id = ?',
      [salon_id]
    );
    if (salonResult.length === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }
    return res.status(200).json({ data: salonResult[0] });
  } catch (error) {
    console.error('getSalonInfo error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// BS 1.1 - Get Salon Information for Owner
exports.getSalonInformation = async (req, res) => {
  const db = connection.promise();
  
  try {
    const user_id = req.user?.user_id;
    
  
    const [salonResult] = await db.execute(
      'SELECT salon_id, name, description, category, phone, email, address, city, state, postal_code, country, status FROM salons WHERE owner_user_id = ?',
      [user_id]
    );
    
    if (salonResult.length === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }
    
    const salon_id = salonResult[0].salon_id;
    
    const getAvailabilityQuery = `
        SELECT salon_availability_id, weekday, start_time, end_time
        FROM salon_availability 
        WHERE salon_id = ?
        ORDER BY weekday
    `;
    const [availabilityResult] = await db.execute(getAvailabilityQuery, [salon_id]);
    
    const weeklyHours = {};
    
    VALID_WEEKDAYS.forEach(day => {
        weeklyHours[day] = {
            is_open: false,
            start_time: null,
            end_time: null
        };
    });
    
    availabilityResult.forEach(avail => {
        const dayName = Object.keys(WEEKDAY_TO_NUMBER).find(day => WEEKDAY_TO_NUMBER[day] === avail.weekday);
        if (dayName) {
            weeklyHours[dayName] = {
                is_open: true,
                start_time: avail.start_time,
                end_time: avail.end_time
            };
        }
    });
    
    return res.status(200).json({ 
      data: {
        ...salonResult[0],
        weekly_hours: weeklyHours
      }
    });
  } catch (error) {
    console.error('getSalonInformation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// AFDV 1.1 Track Salon Event
exports.trackSalonEvent = async (req, res) => {
  const db = connection.promise();

  try {
    const { salon_id, event_name, amount } = req.body; 
    
    if (!salon_id || !event_name || isNaN(amount)) {
      return res.status(400).json({ message: 'Invalid fields.' });
    }

    const trackSalonEventQuery = 
    `INSERT INTO salon_clicks (event_name, salon_id, clicks)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE clicks = clicks + VALUES(clicks);`;

    const [salonResult] = await db.execute(trackSalonEventQuery, [event_name, salon_id, amount]);

    return res.status(200).json({ 
      message: 'Event tracked successfully.'
    });
    
  } catch (error) {
    console.error('trackSalonEvent error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// PLR 1.2 View Salon Metrics
exports.getTopSalonMetrics = async (req, res) => {
  const db = connection.promise();

  try {
    const owner_user_id = req.user?.user_id;

    if (!owner_user_id) {
      return res.status(401).json({ message: 'Invalid fields.' });
    }

    // Calculate week start using Luxon (Monday of current week)
    const now = DateTime.utc();
    const weekStart = now.startOf('week'); // Monday
    // Calculate each day of the week
    const mondayStr = weekStart.plus({ days: 0 }).toFormat('yyyy-MM-dd');
    const tuesdayStr = weekStart.plus({ days: 1 }).toFormat('yyyy-MM-dd');
    const wednesdayStr = weekStart.plus({ days: 2 }).toFormat('yyyy-MM-dd');
    const thursdayStr = weekStart.plus({ days: 3 }).toFormat('yyyy-MM-dd');
    const fridayStr = weekStart.plus({ days: 4 }).toFormat('yyyy-MM-dd');
    const saturdayStr = weekStart.plus({ days: 5 }).toFormat('yyyy-MM-dd');
    const sundayStr = weekStart.plus({ days: 6 }).toFormat('yyyy-MM-dd');

    const topSalonStylistQuery = 
          `SELECT
          u.full_name AS stylist_name,
          s.name AS salon_name,

          COALESCE(SUM(p.amount), 0) AS total_revenue,
          COALESCE(COUNT(DISTINCT bs.booking_id), 0) AS total_bookings,

          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS monday_revenue,
          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS tuesday_revenue,
          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS wednesday_revenue,
          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS thursday_revenue,
          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS friday_revenue,
          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS saturday_revenue,
          COALESCE(SUM(CASE WHEN DATE(b.scheduled_start) = ? THEN p.amount END), 0) AS sunday_revenue

      FROM employees e
      JOIN users u ON e.user_id = u.user_id
      JOIN salons s ON e.salon_id = s.salon_id

      LEFT JOIN booking_services bs ON bs.employee_id = e.employee_id
      LEFT JOIN bookings b ON bs.booking_id = b.booking_id
      LEFT JOIN payments p 
          ON p.booking_id = b.booking_id 
          AND p.status = 'SUCCEEDED'

      WHERE s.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
      GROUP BY e.employee_id, u.full_name, s.name
      ORDER BY total_revenue DESC;`;

    const [topSalonStylistResults] = await db.execute(topSalonStylistQuery, [
      mondayStr, tuesdayStr, wednesdayStr, thursdayStr, fridayStr, saturdayStr, sundayStr,
      owner_user_id
    ]);

    const salonServicesQuery = 
    `SELECT 
        sv.name AS service_name,
        s.name AS salon_name,
        COALESCE(COUNT(DISTINCT bs.booking_id), 0) AS times_booked,
        COALESCE(SUM(p.amount), 0) AS total_revenue
    FROM payments p
    JOIN bookings b ON p.booking_id = b.booking_id
    JOIN booking_services bs ON b.booking_id = bs.booking_id
    JOIN services sv ON bs.service_id = sv.service_id
    JOIN salons s ON sv.salon_id = s.salon_id
    WHERE p.status = 'SUCCEEDED' AND s.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
    GROUP BY sv.service_id, sv.name, s.name
    ORDER BY total_revenue DESC, times_booked DESC;`;

    const [salonServicesResults] = await db.execute(salonServicesQuery, [owner_user_id]);

    const productRevenueQuery = 
    `SELECT 
      pr.name AS product_name,
      pr.price AS listing_price,
      COALESCE(SUM(oi.quantity), 0) AS units_sold,
      COALESCE(SUM(oi.quantity * oi.purchase_price), 0) AS total_revenue
    FROM order_items oi
    JOIN products pr ON oi.product_id = pr.product_id
    JOIN orders o ON oi.order_id = o.order_id
    JOIN salons s ON s.salon_id = pr.salon_id
    WHERE s.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
    GROUP BY pr.product_id, pr.name, pr.price, s.name
    ORDER BY total_revenue DESC, units_sold DESC;`;
    const [productRevenueResults] = await db.execute(productRevenueQuery, [owner_user_id]);

    const totalProductRevenueQuery = 
    `SELECT COALESCE(SUM(oi.quantity * oi.purchase_price), 0) AS total_product_revenue
    FROM order_items oi
    JOIN products pr ON oi.product_id = pr.product_id
    JOIN orders o ON oi.order_id = o.order_id
    JOIN salons s ON s.salon_id = pr.salon_id
    WHERE s.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
    GROUP BY s.salon_id, s.name;`;
    const [totalProductRevenueResults] = await db.execute(totalProductRevenueQuery, [owner_user_id]);


    const totalSalonRevenueQuery =
    `SELECT 
        COALESCE(SUM(p.amount), 0) AS total_revenue
    FROM payments p
    JOIN bookings b ON p.booking_id = b.booking_id
    JOIN salons s ON b.salon_id = s.salon_id
    WHERE p.status = 'SUCCEEDED' AND s.salon_id = (SELECT salon_id FROM salons WHERE owner_user_id = ?)
    GROUP BY s.salon_id, s.name;`;
    const [totalSalonRevenueResults] = await db.execute(totalSalonRevenueQuery, [owner_user_id]);

    return res.status(200).json({
      stylists: topSalonStylistResults,
      totalProductRevenue: totalProductRevenueResults[0].total_product_revenue,
      totalSalonRevenue: totalSalonRevenueResults[0].total_revenue,
      services: salonServicesResults,
      productsRevenue: productRevenueResults
    });

  } catch (err) {
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

