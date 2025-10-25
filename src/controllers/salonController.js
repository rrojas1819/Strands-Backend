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
