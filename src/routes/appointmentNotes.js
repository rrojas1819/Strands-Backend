const express = require('express');
const router = express.Router();
const notes = require('../controllers/appointmentNotesController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/appointment-notes/create:
 *   post:
 *     summary: Create a private note for an appointment
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - booking_id
 *               - note_text
 *             properties:
 *               booking_id:
 *                 type: integer
 *               note_text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Note created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer or Employee role required
 */
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.createNote);

/**
 * @swagger
 * /api/appointment-notes/update/{note_id}:
 *   patch:
 *     summary: Update a private note for an appointment
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: note_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note_text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Note updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer or Employee role required
 */
router.patch('/update/:note_id', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.updateNote);

/**
 * @swagger
 * /api/appointment-notes/delete/{note_id}:
 *   delete:
 *     summary: Delete a private note for an appointment
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: note_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Note deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer or Employee role required
 */
router.delete('/delete/:note_id', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.deleteNote);

/**
 * @swagger
 * /api/appointment-notes/booking/{booking_id}/my-note:
 *   get:
 *     summary: List notes for a particular booking
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notes retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer or Employee role required
 */
router.get('/booking/:booking_id/my-note', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.listMyNotesForBooking);

/**
 * @swagger
 * /api/appointment-notes/my-notes:
 *   get:
 *     summary: List all notes made by the user
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notes retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer or Employee role required
 */
router.get('/my-notes', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.listMyNotes);

module.exports = router;
