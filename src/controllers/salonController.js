const connection = require('../config/databaseConnection'); //db connection
const { validateEmail } = require('../utils/utilies');

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
    const insertSql = `INSERT INTO salons
                      (owner_user_id, name, description, category, phone, email,
                      address, city, state, postal_code, country, status, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), NOW())`;

    const params = [
      owner_user_id, name, description, category, phone, email,
      address, city, state, postal_code, country
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

    const updateSalonQuery = 
      `UPDATE salons 
        SET status = ?,
        approval_date = IF(? = 'APPROVED', NOW(), approval_date)
      WHERE salon_id = ?;`;

    const [result] = await db.execute(updateSalonQuery, [status, status, salon_id]);

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
    
    //returning salons
    return res.status(200).json({
      data: rows,
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

    const assignEmployeeQuery = 
    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
    VALUES((SELECT salon_id FROM salons WHERE owner_user_id = ?), (SELECT user_id FROM users WHERE email = ?), ?, 1, NOW(), NOW());`;

    const [result] = await db.execute(assignEmployeeQuery, [owner_user_id, email, title]);

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

    console.log(owner_user_id);

    if (!target_visits || !discount_percentage) { 
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const insertLoyaltyProgramQuery = 
    `INSERT INTO loyalty_programs (salon_id, target_visits, discount_percentage, note, created_at, updated_at, active) VALUES ((SELECT salon_id FROM salons WHERE owner_user_id = ?), ?, ?, ?, NOW(), NOW(), ?);`;

    const [result] = await db.execute(insertLoyaltyProgramQuery, [owner_user_id, target_visits, discount_percentage, note, active]);

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
      
      const getSalonQuery = 'SELECT salon_id FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);
    
      const salon_id = salonResult[0].salon_id;
      
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
              //if the day is not open, delete it
               if (!hours || hours === false || Object.keys(hours).length === 0) {
                   const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
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
              
              // Validate times using Date
              const today = new Date().toISOString().split('T')[0]; 
              const startDate = new Date(`${today}T${hours.start_time}`);
              const endDate = new Date(`${today}T${hours.end_time}`);
              
              if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                  errors.push(`${weekday}: Invalid time format`);
                  continue;
              }
              
              if (startDate >= endDate) {
                  errors.push(`${weekday}: start_time must be before end_time`);
                  continue;
              }
              
              // Format times for SQL (HH:MM:SS)
              const normalizedStartTime = startDate.toTimeString().split(' ')[0];
              const normalizedEndTime = endDate.toTimeString().split(' ')[0];
              
               const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
               const checkExistingQuery = `
                   SELECT salon_availability_id FROM salon_availability 
                   WHERE salon_id = ? AND weekday = ?
               `;
               const [existingResult] = await db.execute(checkExistingQuery, [salon_id, weekdayNumber]);
              
               //if the day already exists, update it
              if (existingResult.length > 0) {
                  const updateQuery = `
                      UPDATE salon_availability 
                      SET start_time = ?, end_time = ?, updated_at = NOW()
                      WHERE salon_availability_id = ?
                  `;
                  await db.execute(updateQuery, [normalizedStartTime, normalizedEndTime, existingResult[0].salon_availability_id]);
                  results.push({ 
                      weekday: weekday.toUpperCase(), 
                      action: 'updated',
                      start_time: normalizedStartTime,
                      end_time: normalizedEndTime
                  });
               } 
               //if the day doesn't exist, create it
               else {
                   const insertQuery = `
                       INSERT INTO salon_availability (salon_id, weekday, start_time, end_time, created_at, updated_at)
                       VALUES (?, ?, ?, ?, NOW(), NOW())
                   `;
                   await db.execute(insertQuery, [salon_id, weekdayNumber, normalizedStartTime, normalizedEndTime]);
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
      
     
      const getSalonQuery = 'SELECT salon_id FROM salons WHERE owner_user_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [owner_user_id]);
      
   
      
       const salon_id = salonResult[0].salon_id;
       
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
              
              // If the day is not available, delete it
              if (!availability || availability === false || Object.keys(availability).length === 0) {
                  const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
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
              
              // Validate times using Date
              const today = new Date().toISOString().split('T')[0]; 
              const startDate = new Date(`${today}T${availability.start_time}`);
              const endDate = new Date(`${today}T${availability.end_time}`);
              
              if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                  errors.push(`${weekday}: Invalid time format`);
                  continue;
              }
              
              if (startDate >= endDate) {
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
              const salonStart = new Date(`${today}T${salonHours[dayName].start_time}`);
              const salonEnd = new Date(`${today}T${salonHours[dayName].end_time}`);
              
              if (startDate < salonStart || endDate > salonEnd) {
                  errors.push(`${weekday}: Employee availability must be within salon operating hours (${salonHours[dayName].start_time} - ${salonHours[dayName].end_time})`);
                  continue;
              }
              
              // Format times for SQL (HH:MM:SS)
              const normalizedStartTime = startDate.toTimeString().split(' ')[0];
              const normalizedEndTime = endDate.toTimeString().split(' ')[0];
              
              const weekdayNumber = WEEKDAY_TO_NUMBER[weekday.toUpperCase()];
              const checkExistingQuery = `
                  SELECT availability_id FROM employee_availability 
                  WHERE employee_id = ? AND weekday = ?
              `;
              const [existingResult] = await db.execute(checkExistingQuery, [employeeId, weekdayNumber]);
              
              // If the day already exists, update it
              if (existingResult.length > 0) {
                  const updateQuery = `
                      UPDATE employee_availability 
                      SET start_time = ?, end_time = ?, slot_interval_minutes = ?, updated_at = NOW()
                      WHERE availability_id = ?
                  `;
                  await db.execute(updateQuery, [
                      normalizedStartTime, 
                      normalizedEndTime, 
                      availability.slot_interval_minutes || 30,
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
                  const insertQuery = `
                      INSERT INTO employee_availability (employee_id, weekday, start_time, end_time, slot_interval_minutes, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
                  `;
                  await db.execute(insertQuery, [
                      employeeId, 
                      weekdayNumber, 
                      normalizedStartTime, 
                      normalizedEndTime,
                      availability.slot_interval_minutes || 30
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
      const { start_date, end_date, days = 7 } = req.query;
      
      if (!salon_id || isNaN(salon_id) || !employee_id || isNaN(employee_id)) {
          return res.status(400).json({ message: 'Missing required fields: salon_id or employee_id' });
      }
    
      
      // Determine date range
      let startDate, endDate;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayInMs = 24 * 60 * 60 * 1000;
      
      if (start_date && end_date) {
          startDate = new Date(start_date + 'T00:00:00');
          endDate = new Date(end_date + 'T00:00:00');
      } else if (start_date) {
          startDate = new Date(start_date + 'T00:00:00');
          endDate = new Date(startDate.getTime() + (parseInt(days) - 1) * dayInMs);
      } else {
          // Default to next 7 days from today
          startDate = new Date(today);
          endDate = new Date(today.getTime() + (parseInt(days) - 1) * dayInMs);
      }
      
      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
      }
      
      if (startDate < today) {
          return res.status(400).json({ message: 'Start date cannot be in the past' });
      }
      
      if (endDate < startDate) {
          return res.status(400).json({ message: 'End date must be on or after start date' });
      }
      
      // Limit to max range (30 days)
      const maxDays = 30;
      const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      if (daysDiff > maxDays) {
          return res.status(400).json({ message: `Date range cannot exceed ${maxDays} days` });
      }
      
      // Verify salon exists and is approved
      const getSalonQuery = 'SELECT salon_id, name, status FROM salons WHERE salon_id = ?';
      const [salonResult] = await db.execute(getSalonQuery, [salon_id]);
      
      if (salonResult.length === 0) {
          return res.status(404).json({ message: 'Salon not found' });
      }
      //This should never occur but just in case
      if (salonResult[0].status !== 'APPROVED') {
          return res.status(403).json({ message: 'Salon is not available for booking' });
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
      const getBookingsQuery = `
          SELECT DISTINCT b.scheduled_start, b.scheduled_end, b.status
          FROM bookings b
          JOIN booking_services bs ON b.booking_id = bs.booking_id
          WHERE bs.employee_id = ? 
          AND b.scheduled_start >= ? 
          AND b.scheduled_start < DATE_ADD(?, INTERVAL 1 DAY)
          AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
          ORDER BY b.scheduled_start
      `;
      const [bookingsResult] = await db.execute(getBookingsQuery, [employee_id, startDate.toISOString().split('T')[0] + ' 00:00:00', endDate.toISOString().split('T')[0] + ' 00:00:00']);
      
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
      
      // Create bookings map by date
      const bookingsMap = {};
      bookingsResult.forEach(booking => {
          // Extract date without timezone conversion to avoid date shifting
          const bookingDateObj = new Date(booking.scheduled_start);
          const bookingDate = bookingDateObj.toISOString().split('T')[0];
          (bookingsMap[bookingDate] ||= []).push(booking);
      });
      
      // Generate time slots for each day
      const dailySlots = {};
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const dayOfWeek = currentDate.getDay();
          const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
          
          const availability = availabilityMap[dayOfWeek];
          const unavailability = unavailabilityMap[dayOfWeek] || [];
          const bookings = bookingsMap[dateStr] || [];
          
          if (!availability) {
              dailySlots[dateStr] = {
                  date: dateStr,
                  day_name: dayName,
                  available_slots: [],
                  message: 'No availability set for this day'
              };
          } else {
              const availableSlots = [];
              const slotInterval = availability.slot_interval_minutes || 30;
              
              const startTime = new Date(`${dateStr}T${availability.start_time}`);
              const endTime = new Date(`${dateStr}T${availability.end_time}`);
              
              let currentTime = new Date(startTime);
              
              while (currentTime < endTime) {
                  const slotStart = new Date(currentTime);
                  const slotEnd = new Date(currentTime.getTime() + slotInterval * 60000);
                  
                  // Check conflict with unavailability
                  const isBlocked = unavailability.some(block => {
                      const blockStart = new Date(`${dateStr}T${block.start_time}`);
                      const blockEnd = new Date(`${dateStr}T${block.end_time}`);
                      return slotStart < blockEnd && slotEnd > blockStart;
                  });
                  
                  // Check conflict with existing bookings
                  const isBooked = bookings.some(booking => {
                      const bookingStart = new Date(booking.scheduled_start);
                      const bookingEnd = new Date(booking.scheduled_end);
                      return slotStart < bookingEnd && slotEnd > bookingStart;
                  });
                  
                  // Check if this slot is in the past (for current day or past dates)
                  const now = new Date();
                  const todayStr = now.toISOString().split('T')[0];
                  const isCurrentDay = dateStr === todayStr;
                  const isPastDate = dateStr < todayStr;
                  const isPastSlot = (isCurrentDay && slotStart < now) || isPastDate;
                  
                  if (!isBlocked && !isBooked && !isPastSlot) {
                      const timeStr = slotStart.toTimeString().split(' ')[0].substring(0, 5);
                      const endTimeStr = slotEnd.toTimeString().split(' ')[0].substring(0, 5);
                      availableSlots.push({
                          start_time: timeStr,
                          end_time: endTimeStr,
                          available: true
                      });
                  }
                  
                  currentTime = new Date(currentTime.getTime() + slotInterval * 60000);
              }
              
              dailySlots[dateStr] = {
                  date: dateStr,
                  day_name: dayName,
                  availability: {
                      start_time: availability.start_time,
                      end_time: availability.end_time,
                      slot_interval_minutes: slotInterval
                  },
                  available_slots: availableSlots,
                  total_slots: availableSlots.length
              };
          }
          
          currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return res.status(200).json({
          data: {
              stylist: {
                  employee_id: employee_id,
                  name: employeeResult[0].full_name,
                  title: employeeResult[0].title
              },
              date_range: {
                  start_date: startDate.toISOString().split('T')[0],
                  end_date: endDate.toISOString().split('T')[0],
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
      const createServiceQuery = `
        INSERT INTO services (salon_id, name, description, duration_minutes, price, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
      `;
      const [serviceResult] = await db.execute(createServiceQuery, [
        salon_id, 
        name, 
        description, 
        duration_minutes, 
        price
      ]);
      
      const service_id = serviceResult.insertId;
      
      const linkServiceQuery = `
        INSERT INTO employee_services (employee_id, service_id, created_at, updated_at)
        VALUES (?, ?, NOW(), NOW())
      `;
      await db.execute(linkServiceQuery, [employee_id, service_id]);
      
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
    
    const deleteQuery = `
      DELETE FROM employee_services 
      WHERE employee_id = ? AND service_id = ?
    `;
    const [result] = await db.execute(deleteQuery, [employee_id, service_id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Service could not be removed' });
    }
    
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
    
    updateFields.push('updated_at = NOW()');
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
    const { scheduled_start, scheduled_end, services, notes = '' } = req.body;
    const customer_user_id = req.user?.user_id;



    if (!salon_id || isNaN(salon_id) || !employee_id || isNaN(employee_id)) {
      return res.status(400).json({ message: 'Invalid salon_id or employee_id' });
    }
    if (!scheduled_start || !scheduled_end) {
      return res.status(400).json({ message: 'scheduled_start and scheduled_end are required' });
    }
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ message: 'At least one service is required' });
    }



    // Parse as Date and keep everything in LOCAL time (same as weekly schedule)
    const startDate = new Date(scheduled_start);
    const endDate   = new Date(scheduled_end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        message: 'Invalid date format. EX: "2025-10-28T13:00:00"'
      });
    }
    if (startDate >= endDate) {
      return res.status(400).json({ message: 'scheduled_start must be before scheduled_end' });
    }
    const now = new Date();
    if (startDate < now) {
      return res.status(400).json({ message: 'Cannot book appointments in the past' });
    }

    

    const [employeeResult] = await db.execute(
      `SELECT e.employee_id, e.title, u.full_name
       FROM employees e
       JOIN users u ON e.user_id = u.user_id
       WHERE e.employee_id = ? AND e.salon_id = ? AND e.active = 1`,
      [employee_id, salon_id]
    );
    

    // Pull all weekday availability for stylist
    const [availabilityResult] = await db.execute(
      `SELECT weekday, start_time, end_time, slot_interval_minutes
       FROM employee_availability
       WHERE employee_id = ?`,
      [employee_id]
    );
    if (availabilityResult.length === 0) {
      return res.status(400).json({ message: 'Stylist has no availability set' });
    }


    //Get the day of the week for the booking
    const bookingDayOfWeek = startDate.getDay();
    const dayAvailability = availabilityResult.find(a => a.weekday === bookingDayOfWeek);
    if (!dayAvailability) {
      return res.status(400).json({ message: 'Stylist is not available on this day' });
    }


    // Build local YYYY-MM-DD for the booking date
    const y  = startDate.getFullYear();
    const m  = String(startDate.getMonth() + 1).padStart(2, '0');
    const d  = String(startDate.getDate()).padStart(2, '0');
    const dayStr = `${y}-${m}-${d}`;


    // Compare within availability window using Date objects on the SAME local date
    const availStart = new Date(`${dayStr}T${dayAvailability.start_time}`);
    const availEnd   = new Date(`${dayStr}T${dayAvailability.end_time}`);
    if (startDate < availStart || endDate > availEnd) {
      return res.status(400).json({
        message: `Booking time must be within stylist's availability (${dayAvailability.start_time} - ${dayAvailability.end_time})`
      });
    }


    // Slot Availability Check/alignment check
    if (dayAvailability.slot_interval_minutes && Number(dayAvailability.slot_interval_minutes) > 0) {
      const stepMs = Number(dayAvailability.slot_interval_minutes) * 60_000;
      const baseMs = availStart.getTime();

      // Check start time aligns with the slot interval
      const startAligned = (startDate.getTime() - baseMs) % stepMs === 0;

      // Check the duration aligns with the slot interval
      const durationMs = endDate.getTime() - startDate.getTime();
      const durationAligned = durationMs % stepMs === 0;
      
      if (!startAligned || !durationAligned) {
        return res.status(400).json({
          message: `Requested time must align with ${dayAvailability.slot_interval_minutes}-minute slots (start time and duration must be multiples of ${dayAvailability.slot_interval_minutes} minutes)`
        });
      }
    }

    // Unavailability overlap
    const [unavailabilityResult] = await db.execute(
      `SELECT start_time, end_time
       FROM employee_unavailability
       WHERE employee_id = ? AND weekday = ?`,
      [employee_id, bookingDayOfWeek]
    );

    const hasUnavailabilityConflict = unavailabilityResult.some(block => {
      const blockStart = new Date(`${dayStr}T${block.start_time}`);
      const blockEnd   = new Date(`${dayStr}T${block.end_time}`);
      return (startDate < blockEnd) && (blockStart < endDate);
    });

    if (hasUnavailabilityConflict) {
      return res.status(409).json({ message: 'Stylist is unavailable during this time slot' });
    }

    // Format local DATETIME strings
    const toLocalSQL = (dt) => {
      const Y  = dt.getFullYear();
      const M  = String(dt.getMonth() + 1).padStart(2, '0');
      const D  = String(dt.getDate()).padStart(2, '0');
      const H  = String(dt.getHours()).padStart(2, '0');
      const MI = String(dt.getMinutes()).padStart(2, '0');
      const S  = String(dt.getSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${H}:${MI}:${S}`;
    };  

    const requestStartStr = toLocalSQL(startDate);
    const requestEndStr   = toLocalSQL(endDate);

    // Check conflicts with existing bookings
    const [conflictsResult] = await db.execute(
      `SELECT b.booking_id, b.scheduled_start, b.scheduled_end
       FROM bookings b
       JOIN booking_services bs ON b.booking_id = bs.booking_id
       WHERE bs.employee_id = ?
         AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
         AND b.scheduled_start < ?
         AND b.scheduled_end > ?`,
      [employee_id, requestEndStr, requestStartStr]
    );

    if (conflictsResult.length > 0) {
      // Convert database datetime to local time
      const formatConflictTime = (timeStr) => {
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

      return res.status(409).json({
        message: 'Time slot is no longer available. Please select a different time.',
        conflicting_booking: {
          booking_id: conflictsResult[0].booking_id,
          scheduled_start: formatConflictTime(conflictsResult[0].scheduled_start),
          scheduled_end: formatConflictTime(conflictsResult[0].scheduled_end)
        }
      });
    }

    await db.query('START TRANSACTION');
    try {

      const [bookingResult] = await db.execute(
        `INSERT INTO bookings
           (salon_id, customer_user_id, scheduled_start, scheduled_end, status, notes, created_at, updated_at)
         VALUES
           (?, ?, ?, ?, 'SCHEDULED', ?, NOW(), NOW())`,
        [salon_id, customer_user_id, requestStartStr, requestEndStr, notes]
      );

      const booking_id = bookingResult.insertId;
      const serviceIds = services.map(s => s.service_id);
      const placeholders = serviceIds.map(() => '?').join(',');
      const [serviceDetails] = await db.execute(
        `SELECT service_id, duration_minutes, price, salon_id, name
         FROM services
         WHERE service_id IN (${placeholders})`,
        serviceIds
      );
      
      const detailsById = {};
      serviceDetails.forEach(s => { detailsById[s.service_id] = s; });

      // Link services to booking
      for (const s of services) {
        //Valid check because it requires the frontend to send a service_id
        if (!s.service_id) throw new Error('Each service must have a service_id'); 
        const sd = detailsById[s.service_id];
        if (!sd) throw new Error(`Service ${s.service_id} not found`);
        if (sd.salon_id !== parseInt(salon_id)) {
          throw new Error(`Service ${sd.name} does not belong to this salon`);
        }
        await db.execute(
          `INSERT INTO booking_services
             (booking_id, employee_id, service_id, price, duration_minutes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [booking_id, employee_id, s.service_id, sd.price, sd.duration_minutes]
        );
      }

      
      const totalPrice = services.reduce((sum, s) => sum + Number(detailsById[s.service_id].price), 0);

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
            scheduled_start: requestStartStr.replace(' ', 'T'),
            scheduled_end: requestEndStr.replace(' ', 'T'),
            duration_minutes: Math.round((endDate - startDate) / (1000 * 60)),
            status: 'SCHEDULED'
          },
          services: services.map(s => ({
            service_id: s.service_id,
            service_name: detailsById[s.service_id].name,
            price: Number(detailsById[s.service_id].price)
          })),
          total_price: totalPrice,
          notes,
          created_at: new Date().toISOString()
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