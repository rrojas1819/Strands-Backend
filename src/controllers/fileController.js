const { uploadUniqueFile, deleteFile } = require('../utils/s3.js');
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

		res.status(200).json({
			message: "File uploaded successfully.",
			booking_photo_id: addPhotoToBookingServiceResults.insertId
		});

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
				
		res.status(200).json({
			message: "File uploaded successfully.",
			booking_photo_id: addPhotoToBookingServiceResults.insertId
		});

	} catch (error) {
		console.error("Upload Error:", error);
		res.status(500).json({ 
			error: "Failed to upload file." 
		});
	}
};

// UPH 1.6 Delete Photo
exports.deletePhoto = async (req, res) => {
	const db = connection.promise();

	try {
		const { booking_photo_id } = req.body;

		if (!booking_photo_id) {
			return res.status(400).json({ 
				error: "Booking Photo ID is required." 
			});
		}

		const getPictureIdQuery = `
			SELECT picture_id, s3_key FROM pictures WHERE picture_id = (SELECT picture_id FROM booking_photos WHERE booking_photo_id = ?);
		`;

		const [bookingPhotoRows] = await db.execute(getPictureIdQuery, [booking_photo_id]);

		if (bookingPhotoRows.length === 0) {
			return res.status(404).json({ message: 'Booking photo not found' });
		}

		await db.query('START TRANSACTION');

		const deleteBookingPhotoQuery = `
			DELETE FROM booking_photos WHERE booking_photo_id = ?;
		`;
		const [deleteBookingPhotoResults] = await db.execute(deleteBookingPhotoQuery, [booking_photo_id]);

		console.log(deleteBookingPhotoResults);

		if (deleteBookingPhotoResults.affectedRows === 0) {
			await db.query('ROLLBACK');
			return res.status(500).json({ 
				error: "Failed to delete booking photo." 
			});
		}

		const deletePhotoQuery = `
			DELETE FROM pictures WHERE picture_id = ?;
		`;
		const [deletePhotoResults] = await db.execute(deletePhotoQuery, [bookingPhotoRows[0].picture_id]);

		if (deletePhotoResults.affectedRows === 0) {
			await db.query('ROLLBACK');
			return res.status(500).json({ 
				error: "Failed to delete photo." 
			});
		}

		const result = await deleteFile(bookingPhotoRows[0].s3_key);

		if (result.error === 'Missing key') {
			await db.query('ROLLBACK');
			return res.status(400).json({ 
				error: "Missing key." 
			});
		}

		await db.query('COMMIT');

		if (result.message === 'Missing key') {
			return res.status(400).json({ 
				error: "Missing key." 
			});
		}


		res.status(200).json({ 
			error: "File deleted successfully." 
		});

	} catch (error) {
		console.error("Delete File Error:", error);
		res.status(500).json({ 
			error: "Failed to Delete file." 
		});
	}
};