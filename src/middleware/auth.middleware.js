const jwt = require("jsonwebtoken");

// JWT Functions
const generateToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '2h'
    });
};

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
        console.error('authenticateToken error:', error);
        }
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Role Authorization
const roleAuthorization = (roles) => {
    return (req, res, next) => {

        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!req.user.role) {
            return res.status(403).json({ error: 'No role assigned to user' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
};

module.exports = {
    generateToken,
    authenticateToken,
    roleAuthorization
};
