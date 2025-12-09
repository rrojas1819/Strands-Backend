const express = require('express');
const router = express.Router();
const notes = require('../controllers/appointmentNotesController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/appointment-notes/create:
 *   post:
 *     summary: Create an appointment note
 *     description: Customer or employee creates a private note for an appointment
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
 *               - note
 *             properties:
 *               booking_id:
 *                 type: integer
 *               note:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Note created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Note created
 *                 data:
 *                   type: object
 *                   properties:
 *                     note_id:
 *                       type: integer
 *                     booking_id:
 *                       type: integer
 *                     note:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *       400:
 *         description: Invalid booking_id or note
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied to this booking
 *       404:
 *         description: Booking not found
 *       409:
 *         description: Already have a note for this booking
 *       500:
 *         description: Internal server error
 */
router.post('/create', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.createNote);

/**
 * @swagger
 * /api/appointment-notes/update/{note_id}:
 *   patch:
 *     summary: Update an appointment note
 *     description: Customer or employee updates their own note
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
 *             required:
 *               - note
 *             properties:
 *               note:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Note updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Note updated
 *                 data:
 *                   type: object
 *                   properties:
 *                     note_id:
 *                       type: integer
 *                     booking_id:
 *                       type: integer
 *                     note:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *       400:
 *         description: Invalid note_id or note
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Note or booking not found
 *       500:
 *         description: Internal server error
 */
router.patch('/update/:note_id', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.updateNote);

/**
 * @swagger
 * /api/appointment-notes/delete/{note_id}:
 *   delete:
 *     summary: Delete an appointment note
 *     description: Customer or employee deletes their own note
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Note deleted
 *       400:
 *         description: Invalid note_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Note not found
 *       500:
 *         description: Internal server error
 */
router.delete('/delete/:note_id', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.deleteNote);

/**
 * @swagger
 * /api/appointment-notes/booking/{booking_id}/my-note:
 *   get:
 *     summary: Get my notes for a specific booking
 *     description: Customer or employee gets their own notes for a specific booking
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Notes for booking retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       note_id:
 *                         type: integer
 *                       booking_id:
 *                         type: integer
 *                       note:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *                 meta:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       400:
 *         description: Invalid booking_id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied to this booking
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Internal server error
 */
router.get('/booking/:booking_id/my-note', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.listMyNotesForBooking);

/**
 * @swagger
 * /api/appointment-notes/my-notes:
 *   get:
 *     summary: Get all my appointment notes
 *     description: Customer or employee gets all their notes across all bookings
 *     tags: [Appointment Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: All notes retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       note_id:
 *                         type: integer
 *                       booking_id:
 *                         type: integer
 *                       note:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *                 meta:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/my-notes', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE']), notes.listMyNotes);

module.exports = router;
