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

// Handle connection events
connection.on('error', (err) => {
    console.error('Database connection error event:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        console.error('Database connection lost. Reconnection may be needed.');
    }
});

connection.on('connect', () => {
    console.log('Database connection established');
    setUtcTimezone();
});

connection.connect((err) => {
    if (err) {
        console.error('Database connection error:', err);
        console.error('Connection config:', {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            database: process.env.DB_NAME || '',
            port: process.env.DB_PORT || 3306
        });
        return;
    }
    setUtcTimezone();
});

if (connection.state === 'authenticated') {
    setUtcTimezone();
}

module.exports = connection;
