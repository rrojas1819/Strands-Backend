const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadBeforePhoto, uploadAfterPhoto, deletePhoto, getPhoto, checkIfPhotoAttached, getSalonGallery } = require('../controllers/fileController');
const { authenticateToken, roleAuthorization } = require('../middleware/auth.middleware');


const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Invalid file type."));
    }

    cb(null, true);
  },
});

/**
 * @swagger
 * /api/file-upload/upload-before-photo:
 *   post:
 *     summary: Upload before photo
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - booking_id
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Photo uploaded successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner or Employee role required
 */
router.post('/upload-before-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), upload.single("file"), uploadBeforePhoto);

/**
 * @swagger
 * /api/file-upload/upload-after-photo:
 *   post:
 *     summary: Upload after photo
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - booking_id
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Photo uploaded successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner or Employee role required
 */
router.post('/upload-after-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), upload.single("file"), uploadAfterPhoto);

/**
 * @swagger
 * /api/file-upload/delete-photo:
 *   delete:
 *     summary: Delete photo
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - picture_id
 *             properties:
 *               picture_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Photo deleted successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner or Employee role required
 */
router.delete('/delete-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), deletePhoto);

/**
 * @swagger
 * /api/file-upload/get-photo:
 *   get:
 *     summary: Get photo
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: picture_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Photo retrieved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.get('/get-photo', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), getPhoto);

/**
 * @swagger
 * /api/file-upload/check-if-photo-attached:
 *   get:
 *     summary: Check if photo is attached
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: picture_type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [BEFORE, AFTER]
 *     responses:
 *       200:
 *         description: Photo attachment status retrieved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.get('/check-if-photo-attached', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), checkIfPhotoAttached);

/**
 * @swagger
 * /api/file-upload/get-salon-gallery:
 *   get:
 *     summary: Get salon gallery with pagination
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: employee_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Salon gallery retrieved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.get('/get-salon-gallery', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), getSalonGallery);

module.exports = router;
