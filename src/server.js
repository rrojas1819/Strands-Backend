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
const userRoutes = require('./routes/user');
const salonsRoutes = require('./routes/salons');
const analyticsRoutes = require('./routes/analytics');
const unavailabilityRoutes = require('./routes/unavailability');
const bookingsRoutes = require('./routes/bookings');
const productsRoutes = require('./routes/products');
const paymentsRoutes = require('./routes/payments');
const reviewRoutes = require('./routes/reviews');

// Database Connection
const db = require('./config/databaseConnection');

// Get utilities and get start Token Cleanup
const { startTokenCleanup, startBookingsAutoComplete } = require('./utils/utilies');

// Set up Express and CORS
const app = express();

startTokenCleanup(db);
startBookingsAutoComplete(db);
app.use(cors());
app.use(express.json());


//Use Routes
app.use('/api', healthRoutes);
app.use('/api/user', userRoutes);
app.use('/api/salons', salonsRoutes);

app.use('/api/admin/analytics', analyticsRoutes);
app.use('/api/unavailability', unavailabilityRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/reviews', reviewRoutes);

// Start Server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// Error Handling
server.on('error', (err) => {
    console.error('Server error:', err);
});
