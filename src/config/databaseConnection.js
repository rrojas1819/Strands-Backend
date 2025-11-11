const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    port: process.env.DB_PORT || 3306,
    timezone: 'Z'
});

const setUtcTimezone = () => {
    connection.query("SET time_zone = '+00:00'", (err) => {
        if (err) {
            console.error('Failed to set timezone to UTC:', err);
        }
    });
};

connection.connect((err) => {
    if (err) {
        console.error('Database connection error:', err);
        return;
    }
    setUtcTimezone();
});

if (connection.state === 'authenticated') {
    setUtcTimezone();
}

module.exports = connection;
