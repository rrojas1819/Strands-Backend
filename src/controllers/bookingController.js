const connection = require('../config/databaseConnection'); //db connection


exports.cancelBooking = async (req, res) => {
    const db = connection.promise();

    try {
        //get authenticated user
        const authUserId = req.user?.user_id;
        const { booking_id } = req.body;

        //validate booking ID and user ID
        const bookingId = parseInt(booking_id, 10);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({ message: 'Invalid booking id' });
        }
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //db interactions
        await db.beginTransaction();

        //finding the booking (appointment) to cancel and locking it
        const [rows] = await db.execute(`SELECT booking_id, customer_user_id, scheduled_start, status
                                    FROM bookings WHERE booking_id = ? AND customer_user_id = ?
                                    FOR UPDATE`, [bookingId, authUserId]
        );

        if (!rows.length) {
            await db.rollback();
            return res.status(404).json({ message: 'Booking not found' });
        }

        const booking = rows[0];

        //check to only cancel SCHEDULED appointments
        if (booking.status !== 'SCHEDULED') {
            await db.rollback();
            return res.status(400).json({ message: `Cannot cancel a ${booking.status.toLowerCase()} booking` });
        }

        //update booking to CANCELLED in bookings
        await db.execute(`UPDATE bookings SET status = 'CANCELED', updated_at = NOW() WHERE booking_id = ?`, [bookingId]);

        //update booking to CANCELLED in booking_services
        await db.execute(`UPDATE booking_services SET status = 'CANCELED', updated_at = NOW() WHERE booking_id = ?`, [bookingId]);

        //commit all db changes only if this point is reached, if a rollback is triggered then all changes do not take affect to keep synergy in db
        await db.commit();

        return res.status(200).json({
            message: 'Booking canceled',
            data: {
                booking_id: booking.booking_id,
                previous_status: 'SCHEDULED',
                new_status: 'CANCELED',
                canceled_at: new Date().toISOString()
            }
        });
    } catch (err) {
        try { await connection.promise().rollback(); } catch (_) { }
        return res.status(500).json({ message: 'Internal server error' });
    }
};