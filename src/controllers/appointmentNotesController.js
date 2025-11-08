const connection = require('../config/databaseConnection');
const { formatDateTime } = require('../utils/utilies');

//helper function to check for pagination offset
function parseLimitOffset(q) {
    let { limit = 20, offset = 0 } = q || {};
    limit = Number.isFinite(+limit) ? Math.max(1, Math.min(+limit, 100)) : 20;
    offset = Number.isFinite(+offset) ? Math.max(0, +offset) : 0;
    return { limit, offset };
}

//helper function to get an employee's ID and their salon ID
async function employeeIdForUser(db, userId) {
    const [[row]] = await db.execute(`SELECT employee_id, salon_id FROM employees WHERE user_id = ? AND active = 1`, [userId]);
    return row || null;
}

//helper function to check if a booking exists
async function bookingExists(db, bookingId) {
    const [[row]] = await db.execute(`SELECT booking_id FROM bookings WHERE booking_id = ?`, [bookingId]);
    return !!row;
}

//helper function to check if this specific user (customer) can access this booking
async function canCustomerAccessBooking(db, userId, bookingId) {
    const [[row]] = await db.execute(`SELECT COUNT(*) AS cnt FROM bookings WHERE booking_id = ? AND customer_user_id = ?`, [bookingId, userId]);
    return (row?.cnt || 0) > 0;
}

//helper function to check if this specific employee (stylist) can access this booking
async function canEmployeeAccessBooking(db, userId, bookingId) {
    const myEmp = await employeeIdForUser(db, userId);
    if (!myEmp) return false;
    const [[row]] = await db.execute(`SELECT COUNT(*) AS cnt FROM booking_services
                                     WHERE booking_id = ? AND employee_id = ?`, [bookingId, myEmp.employee_id]
    );
    return (row?.cnt || 0) > 0;
}

//BS 1.6 as a user or stylist I want to create private notes for an appointment
exports.createNote = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        const role = req.user?.role;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validation
        const { booking_id, note } = req.body || {};
        const bid = parseInt(booking_id, 10);
        if (!Number.isInteger(bid) || bid <= 0) return res.status(400).json({ message: 'Invalid booking_id' });
        if (typeof note !== 'string' || !note.trim()) return res.status(400).json({ message: 'note is required' });
        if (note.length > 2000) return res.status(400).json({ message: 'note too long (max 2000 chars)' });

        if (!(await bookingExists(db, bid))) return res.status(404).json({ message: 'Booking not found' });

        let allowed = false; //checking if this specific user or employee is allowed to create a note on this booking
        if (role === 'CUSTOMER') {
            allowed = await canCustomerAccessBooking(db, authUserId, bid);
        } else if (role === 'EMPLOYEE') {
            allowed = await canEmployeeAccessBooking(db, authUserId, bid);
        } else {
            return res.status(403).json({ message: 'Only customers or stylists can add notes' });
        }
        if (!allowed) return res.status(403).json({ message: 'You do not have access to this booking' });

        //prevent duplicates
        const [[existing]] = await db.execute(`SELECT note_id FROM appointment_notes WHERE booking_id=? AND author_user_id=?`, [bid, authUserId]);
        if (existing) return res.status(409).json({ message: 'You already have a note for this booking' });

        //create the note
        const [ins] = await db.execute(`INSERT INTO appointment_notes (booking_id, author_user_id, note)
                                       VALUES (?, ?, ?)`, [bid, authUserId, note.trim()]
        );

        //fetch the note
        const [[row]] = await db.execute(`SELECT note_id, booking_id, author_user_id, note, created_at, updated_at
                                         FROM appointment_notes WHERE note_id = ?`, [ins.insertId]
        );

        return res.status(201).json({
            message: 'Note created',
            data: {
                note_id: row.note_id,
                booking_id: row.booking_id,
                note: row.note,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('createNote error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.6 as a user or stylist I want to update my private notes for an appointment
exports.updateNote = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const note_id = parseInt(req.params.note_id, 10);
        if (!Number.isInteger(note_id) || note_id <= 0) return res.status(400).json({ message: 'Invalid note_id' });

        //validation
        const { note } = req.body || {};
        if (note === undefined) return res.status(400).json({ message: 'Nothing to update' });
        if (typeof note !== 'string' || !note.trim()) return res.status(400).json({ message: 'note must be non-empty' });
        if (note.length > 2000) return res.status(400).json({ message: 'note too long (max 2000 chars)' });

        const [[own]] = await db.execute(`SELECT note_id, booking_id FROM appointment_notes
                                         WHERE note_id = ? AND author_user_id = ?`, [note_id, authUserId]
        );
        if (!own) return res.status(404).json({ message: 'Note not found' });
        if (!(await bookingExists(db, own.booking_id))) return res.status(404).json({ message: 'Booking not found' });

        //update the note
        await db.execute(`UPDATE appointment_notes SET note = ? WHERE note_id = ?`, [note.trim(), note_id]);

        //fetch the updated note
        const [[row]] = await db.execute(`SELECT note_id, booking_id, author_user_id, note, created_at, updated_at
                                         FROM appointment_notes WHERE note_id = ?`, [note_id]
        );

        return res.status(200).json({
            message: 'Note updated',
            data: {
                note_id: row.note_id,
                booking_id: row.booking_id,
                note: row.note,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('updateNote error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.6 as a user or stylist I want to delete my private notes for an appointment
exports.deleteNote = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const note_id = parseInt(req.params.note_id, 10);
        if (!Number.isInteger(note_id) || note_id <= 0) return res.status(400).json({ message: 'Invalid note_id' });

        const [[own]] = await db.execute(`SELECT note_id FROM appointment_notes WHERE note_id = ? AND author_user_id = ?`, [note_id, authUserId]);
        if (!own) return res.status(404).json({ message: 'Note not found' });

        //delete the note
        await db.execute(`DELETE FROM appointment_notes WHERE note_id = ?`, [note_id]);
        return res.status(200).json({ message: 'Note deleted' });

    } catch (err) {
        console.error('deleteNote error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//listing the notes made on a particular booking
exports.listMyNotesForBooking = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        const role = req.user?.role;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const booking_id = parseInt(req.params.booking_id, 10);
        if (!Number.isInteger(booking_id) || booking_id <= 0) return res.status(400).json({ message: 'Invalid booking_id' });

        if (!(await bookingExists(db, booking_id))) return res.status(404).json({ message: 'Booking not found' });

        let allowed = false; //checking if this specific user or employee is allowed to create a note on this booking
        if (role === 'CUSTOMER') {
            allowed = await canCustomerAccessBooking(db, authUserId, booking_id);
        } else if (role === 'EMPLOYEE') {
            allowed = await canEmployeeAccessBooking(db, authUserId, booking_id);
        } else {
            return res.status(403).json({ message: 'Only customers or stylists can view notes' });
        }
        if (!allowed) return res.status(403).json({ message: 'You do not have access to this booking' });

        const { limit, offset } = parseLimitOffset(req.query);
        const lim = Math.max(1, Math.min((+limit || 20), 100));
        const off = Math.max(0, (+offset || 0));

        //fetch the note on this booking
        const [rows] = await db.execute(`SELECT note_id, booking_id, note, created_at, updated_at
                                        FROM appointment_notes WHERE booking_id = ? AND author_user_id = ?
                                        ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, [booking_id, authUserId]
        );

        const data = rows.map(r => ({
            note_id: r.note_id,
            booking_id: r.booking_id,
            note: r.note,
            created_at: formatDateTime(r.created_at),
            updated_at: formatDateTime(r.updated_at)
        }));

        return res.status(200).json({
            data,
            meta: { limit: lim, offset: off, hasMore: data.length === lim }
        });
    } catch (err) {
        console.error('listMyNotesForBooking error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//listing the notes made on all bookings
exports.listMyNotes = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const { limit, offset } = parseLimitOffset(req.query);
        const lim = Math.max(1, Math.min((+limit || 20), 100));
        const off = Math.max(0, (+offset || 0));

        //fetch the notes on all bookings
        const [rows] = await db.execute(`SELECT note_id, booking_id, note, created_at, updated_at
                                        FROM appointment_notes WHERE author_user_id = ?
                                        ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, [authUserId]
        );

        const data = rows.map(r => ({
            note_id: r.note_id,
            booking_id: r.booking_id,
            note: r.note,
            created_at: formatDateTime(r.created_at),
            updated_at: formatDateTime(r.updated_at)
        }));

        return res.status(200).json({
            data,
            meta: { limit: lim, offset: off, hasMore: data.length === lim }
        });
    } catch (err) {
        console.error('listMyNotes error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};