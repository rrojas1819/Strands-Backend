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

// UPH 1.6 Before and After File Upload
router.post('/upload-before-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), upload.single("file"), uploadBeforePhoto);
router.post('/upload-after-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), upload.single("file"), uploadAfterPhoto);

// UPH 1.6 Delete File
router.delete('/delete-photo', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE']), deletePhoto);

// UPH 1.6 Get Photo
router.get('/get-photo', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), getPhoto);

// UPH 1.6 Check if photo attached
router.get('/check-if-photo-attached', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), checkIfPhotoAttached);

// UPH 1.6 Get Salon Gallery
router.get('/get-salon-gallery', authenticateToken, roleAuthorization(['CUSTOMER','EMPLOYEE','OWNER']), getSalonGallery);

module.exports = router;
