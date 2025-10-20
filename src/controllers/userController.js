require('dotenv').config();
const bcrypt = require('bcrypt');
const connection = require('../config/databaseConnection');
const { generateToken } = require('../middleware/auth.middleware');

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
        const emailRegex = /^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
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

        // Generate JWT token
        const tokenPayload = {
            user_id: userId,
            role: role.toUpperCase(),
            full_name: full_name
        };
        
        const token = generateToken(tokenPayload);

        // Return success response with token
        res.status(201).json({
            message: "User signed up successfully",
            data: {
                user_id: userId,
                full_name: full_name,
                role: role.toUpperCase(),
                token: token
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


