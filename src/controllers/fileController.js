const { uploadUniqueFile } = require('../utils/s3.js');
const connection = require('../config/databaseConnection');

// UPH 1.6 Upload After Photo
exports.uploadAfterPhoto = async (req, res) => {
	const db = connection.promise();

	try {
		const { booking_service_id } = req.body;

		if (!booking_service_id) {
			return res.status(400).json({ 
				error: "Booking ID is required." 
			});
		}

		if (!req.file) {
			console.log("No file attched.");
			return res.status(400).json({ 
				error: "No file uploaded." 
			});
		}

		const { buffer, mimetype } = req.file;

		const result = await uploadUniqueFile(buffer, mimetype);
		if (result.message === 'File already exists') {
			return res.status(400).json({ 
				error: "File already exists." 
			});
		}

		const addPhotoToBookingServiceQuery = `
			INSERT INTO booking_photos (booking_id, picture_id, picture_type, created_at, updated_at) VALUES (?, ?, 'AFTER', NOW(), NOW())
		`;
		const [addPhotoToBookingServiceResults] = await db.execute(addPhotoToBookingServiceQuery, [booking_service_id, result.picture_id]);

		if (addPhotoToBookingServiceResults.affectedRows === 0) {
			return res.status(500).json({ 
				error: "Failed to add photo to booking service." 
			});
		}
		res.status(200).json(result);
	} catch (error) {
		console.error("Upload Error:", error);
		res.status(500).json({ 
			error: "Failed to upload file." 
		});
	}
};

// UPH 1.6 Upload Before Photo
exports.uploadBeforePhoto = async (req, res) => {
	const db = connection.promise();

	try {
		const { booking_service_id } = req.body;

		if (!booking_service_id) {
			return res.status(400).json({ 
				error: "Booking ID is required." 
			});
		}

		if (!req.file) {
			console.log("No file attched.");
			return res.status(400).json({ 
				error: "No file uploaded." 
			});
		}

		const { buffer, mimetype } = req.file;

		const result = await uploadUniqueFile(buffer, mimetype);
		if (result.message === 'File already exists') {
			return res.status(400).json({ 
				error: "File already exists." 
			});
		}

		const addPhotoToBookingServiceQuery = `
			INSERT INTO booking_photos (booking_id, picture_id, picture_type, created_at, updated_at) VALUES (?, ?, 'BEFORE', NOW(), NOW())
		`;
		const [addPhotoToBookingServiceResults] = await db.execute(addPhotoToBookingServiceQuery, [booking_service_id, result.picture_id]);

		if (addPhotoToBookingServiceResults.affectedRows === 0) {
			return res.status(500).json({ 
				error: "Failed to add photo to booking service." 
			});
		}
		res.status(200).json(result);
	} catch (error) {
		console.error("Upload Error:", error);
		res.status(500).json({ 
			error: "Failed to upload file." 
		});
	}
};