const connection = require('../config/databaseConnection'); //db connection

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
    const [rows] = await db.execute('SELECT salon_id FROM salons WHERE owner_user_id = ? LIMIT 1', [owner_user_id]);

    const hasSalon = rows.length > 0;
    return res.status(200).json({ hasSalon });
  } catch (err) {
    console.error('checkOwnerHasSalon error:', err);
    return res.status(500).json({ message: 'Internal server error' })
  }
}

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
    const {
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