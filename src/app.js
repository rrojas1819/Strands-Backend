const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables as early as possible
const envPath = process.env.NODE_ENV === 'test'
    ? path.resolve(process.cwd(), '.env.test')
    : path.resolve(process.cwd(), '.env');

dotenv.config({ path: envPath, override: false });

const healthRoutes = require('./routes/health');
const userRoutes = require('./routes/user');
const salonsRoutes = require('./routes/salons');
const analyticsRoutes = require('./routes/analytics');
const unavailabilityRoutes = require('./routes/unavailability');
const bookingsRoutes = require('./routes/bookings');
const productsRoutes = require('./routes/products');
const paymentsRoutes = require('./routes/payments');
const reviewRoutes = require('./routes/reviews');
const staffReviewsRoutes = require('./routes/staffReviews');
const appointmentNotesRoutes = require('./routes/appointmentNotes');
const promotionsRoutes = require('./routes/promotions');
const fileUploadRoutes = require('./routes/fileUpload');
const notificationsRoutes = require('./routes/notifications');

const app = express();

app.use(cors());
app.use(express.json());


app.use('/api', healthRoutes);
app.use('/api/user', userRoutes);
app.use('/api/salons', salonsRoutes);
app.use('/api/file', fileUploadRoutes);
app.use('/api/admin/analytics', analyticsRoutes);
app.use('/api/unavailability', unavailabilityRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/staff-reviews', staffReviewsRoutes);
app.use('/api/appointment-notes', appointmentNotesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/promotions', promotionsRoutes);

module.exports = app;

