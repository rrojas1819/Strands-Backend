const express = require('express');
const router = express.Router();
const notes = require('../controllers/appointmentNotesController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

//BS 1.6 as a user or stylist I want to CRUD my private notes for an appointment
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.createNote);
router.patch('/update/:note_id', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.updateNote);
router.delete('/delete/:note_id', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.deleteNote);

//listing the notes made on a particular booking
router.get('/booking/:booking_id/my-note', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.listMyNotesForBooking);

//listing the notes made on all bookings
router.get('/my-notes', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.listMyNotes);

module.exports = router;