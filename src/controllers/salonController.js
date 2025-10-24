const connection = require('../config/databaseConnection'); //db connection
const { validateEmail } = require('../utils/utilies');

//allowed salon categories
const ALLOWED_CATEGORIES = new Set([
  'NAIL SALON', 'HAIR SALON', 'EYELASH STUDIO',
  'SPA & WELLNESS', 'BARBERSHOP', 'FULL SERVICE BEAUTY'
]);

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
    const { salon_id, email, title } = req.body;

    if (!salon_id || !email || !title) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const checkEmployeeExistsQuery = `SELECT user_id FROM users WHERE email = ?`;
    
    const [existingEmployee] = await db.execute(checkEmployeeExistsQuery, [email]);

    if (existingEmployee.length === 0) {
      return res.status(409).json({ message: 'Employee does not exist.' });
    }

    const assignEmployeeQuery = 
    `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
    VALUES(?, (SELECT user_id FROM users WHERE email = ?), ?, 1, NOW(), NOW());`;

    const [result] = await db.execute(assignEmployeeQuery, [salon_id, email, title]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    res.status(200).json({
      message: `Employee ${email} has been added to salon ${salon_id}.`
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
    const { salon_id, email } = req.body;

    if (!salon_id || !email) { 
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
    ) AND salon_id = ?`;

    const [result] = await db.execute(removeEmployeeQuery, [email, salon_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    res.status(200).json({
      message: `Employee ${email} has been removed from salon ${salon_id}.`
    });

  } catch (err) {
    console.error('removeEmployee error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};