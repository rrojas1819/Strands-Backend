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


