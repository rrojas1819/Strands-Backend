const express = require('express');
const cors = require('cors');
require('dotenv').config();


process.on('unhandledRejection', (err, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});


// Get Routes
const healthRoutes = require('./routes/health');

// Database Connection
const db = require('./config/databaseConnection');

// Set up Express and CORS
const app = express();

app.use(cors());
app.use(express.json());


//Use Routes
app.use('/api', healthRoutes);


// Start Server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// Error Handling
server.on('error', (err) => {
    console.error('Server error:', err);
});
