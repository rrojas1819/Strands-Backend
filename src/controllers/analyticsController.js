require('dotenv').config();
const connection = require('../config/databaseConnection');

// AFDV 1.5 User demographics
exports.demographics = async (req, res) => {
    const db = connection.promise();

    try {
        const checkUserQuery = 'SELECT u.role, COUNT(*) as count FROM users u GROUP BY u.role';
        const [results] = await db.execute(checkUserQuery);

        // Format the data
        const demographics = {};
        results.forEach(row => {
            demographics[row.role] = row.count;
        });

        res.status(200).json({
            data: demographics
        });
    } catch (error) {
        res.status(500).json({
            message: "Internal server error"
        });
    }
    
    
    
    
    
    
    
    
    
};


