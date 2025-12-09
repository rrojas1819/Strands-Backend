const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadBeforePhoto, uploadAfterPhoto, deletePhoto, getPhoto, checkIfPhotoAttached, getSalonGallery, uploadSalonPhoto, getSalonPhoto, deleteSalonPhoto } = require('../controllers/fileController');
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
 * /api/file/upload-before-photo:
 *   post:
 *     summary: Upload a 'before' photo for a booking
 *     description: Upload a before photo for a booking (one per booking)
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
 *                 description: Image file (PNG, JPEG, WebP, max 10MB)
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Photo uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: File uploaded successfully.
 *                 booking_photo_id:
 *                   type: integer
 *                   description: ID of the created booking photo record
 *       400:
 *         description: Missing booking_id, no file uploaded, or photo already attached
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER or EMPLOYEE role required
 *       409:
 *         description: File already exists
 *       500:
 *         description: Failed to upload file
 */
router.post('/upload-before-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), upload.single("file"), uploadBeforePhoto);

/**
 * @swagger
 * /api/file/upload-after-photo:
 *   post:
 *     summary: Upload an 'after' photo for a booking
 *     description: Upload an after photo for a booking (one per booking)
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
 *                 description: Image file (PNG, JPEG, WebP, max 10MB)
 *               booking_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Photo uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: File uploaded successfully.
 *                 booking_photo_id:
 *                   type: integer
 *                   description: ID of the created booking photo record
 *       400:
 *         description: Missing booking_id, no file uploaded, or photo already attached
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER or EMPLOYEE role required
 *       409:
 *         description: File already exists
 *       500:
 *         description: Failed to upload file
 */
router.post('/upload-after-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), upload.single("file"), uploadAfterPhoto);

/**
 * @swagger
 * /api/file/delete-photo:
 *   delete:
 *     summary: Delete a booking photo
 *     description: Delete a before or after photo from a booking
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
 *               - booking_id
 *               - type
 *             properties:
 *               booking_id:
 *                 type: integer
 *               type:
 *                 type: string
 *                 enum: [BEFORE, AFTER]
 *     responses:
 *       200:
 *         description: Photo deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: File deleted successfully.
 *       400:
 *         description: Missing booking_id, type, or invalid type
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER or EMPLOYEE role required
 *       404:
 *         description: Booking photo not found
 *       500:
 *         description: Failed to delete file
 */
router.delete('/delete-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), deletePhoto);

/**
 * @swagger
 * /api/file/get-photo:
 *   get:
 *     summary: Get before and after photos for a booking
 *     description: Get pre-signed URLs for before and after photos of a booking
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Photo URLs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 before:
 *                   type: string
 *                   description: Pre-signed URL for before photo (empty if not exists)
 *                 after:
 *                   type: string
 *                   description: Pre-signed URL for after photo (empty if not exists)
 *       400:
 *         description: Missing booking_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No photo found for this booking
 *       500:
 *         description: Failed to generate S3 pre-signed URL
 */
router.get('/get-photo', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), getPhoto);

/**
 * @swagger
 * /api/file/check-if-photo-attached:
 *   get:
 *     summary: Check if photos are attached to a booking
 *     description: Check if any photos exist for a booking
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Photos exist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Photos exist.
 *       400:
 *         description: Missing booking_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No photo found for this booking
 *       500:
 *         description: Internal server error
 */
router.get('/check-if-photo-attached', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), checkIfPhotoAttached);

/**
 * @swagger
 * /api/file/get-salon-gallery:
 *   get:
 *     summary: Get salon gallery (before/after photos)
 *     description: Get paginated gallery of before and after photos for a stylist at a salon
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
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Salon gallery retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 before:
 *                   type: array
 *                   description: Array of before photos with metadata
 *                   items:
 *                     type: object
 *                     properties:
 *                       url:
 *                         type: string
 *                         description: Pre-signed URL for the photo
 *                       service_name:
 *                         type: string
 *                         description: Name of the service performed
 *                       scheduled_end:
 *                         type: string
 *                         description: When the booking ended
 *                 after:
 *                   type: array
 *                   description: Array of after photos with metadata
 *                   items:
 *                     type: object
 *                     properties:
 *                       url:
 *                         type: string
 *                         description: Pre-signed URL for the photo
 *                       service_name:
 *                         type: string
 *                         description: Name of the service performed
 *                       scheduled_end:
 *                         type: string
 *                         description: When the booking ended
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                       description: Total number of photos
 *                     totalPages:
 *                       type: integer
 *                     hasNextPage:
 *                       type: boolean
 *                     hasPreviousPage:
 *                       type: boolean
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No photos found for this salon
 *       500:
 *         description: Failed to get salon gallery
 */
router.get('/get-salon-gallery', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), getSalonGallery);

/**
 * @swagger
 * /api/file/upload-salon-photo:
 *   post:
 *     summary: Upload a salon photo
 *     description: Upload a profile/header photo for the owner's salon (one per salon)
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
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Image file (PNG, JPEG, WebP, max 10MB)
 *     responses:
 *       200:
 *         description: Salon photo uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: File uploaded successfully.
 *                 salon_photo_id:
 *                   type: integer
 *                   description: ID of the created salon photo record
 *       400:
 *         description: No file uploaded or photo already attached
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER role required
 *       409:
 *         description: File already exists
 *       500:
 *         description: Failed to upload file
 */
router.post('/upload-salon-photo', authenticateToken, roleAuthorization(['OWNER']), upload.single("file"), uploadSalonPhoto);

/**
 * @swagger
 * /api/file/get-salon-photo:
 *   get:
 *     summary: Get salon photo
 *     description: Get pre-signed URL for a salon's profile photo
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Salon photo URL retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: Pre-signed URL for the salon photo
 *       400:
 *         description: Missing salon_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No photo found for this salon
 *       500:
 *         description: Failed to generate S3 pre-signed URL
 */
router.get('/get-salon-photo', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER','ADMIN']), getSalonPhoto);

/**
 * @swagger
 * /api/file/delete-salon-photo:
 *   delete:
 *     summary: Delete a salon photo
 *     description: Delete the owner's salon profile photo
 *     tags: [File Upload]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon photo deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: File deleted successfully.
 *       400:
 *         description: Missing owner user ID or key
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - OWNER role required
 *       404:
 *         description: Salon photo not found
 *       500:
 *         description: Failed to delete file
 */
router.delete('/delete-salon-photo', authenticateToken, roleAuthorization(['OWNER']), deleteSalonPhoto);

module.exports = router;
