const { uploadUniqueFile, deleteFile, getFilePresigned } = require('../utils/s3.js');
const connection = require('../config/databaseConnection');

// UPH 1.6 Upload After Photo
exports.uploadAfterPhoto = async (req, res) => {
	const db = connection.promise();

	try {
		const { booking_id } = req.body;

		if (!booking_id) {
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

		const checkPhotoAttachedQuery = `SELECT * FROM booking_photos WHERE booking_id = ? AND picture_type = 'AFTER'`;

		const [checkPhotoAttachedResults] = await db.execute(checkPhotoAttachedQuery, [booking_id]);

		if (checkPhotoAttachedResults.length > 0) {
			return res.status(400).json({ 
				error: "Photo already attached." 
			});
		}

		const { buffer, mimetype } = req.file;

		const result = await uploadUniqueFile(buffer, mimetype);
		if (result.message === 'File already exists') {
			return res.status(409).json({ 
				error: "File already exists." 
			});
		}

		const addPhotoToBookingServiceQuery = `
			INSERT INTO booking_photos (booking_id, picture_id, picture_type, created_at, updated_at) VALUES (?, ?, 'AFTER', NOW(), NOW())
		`;
		const [addPhotoToBookingServiceResults] = await db.execute(addPhotoToBookingServiceQuery, [booking_id, result.picture_id]);

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
		const { booking_id } = req.body;

		if (!booking_id) {
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

		const checkPhotoAttachedQuery = `SELECT * FROM booking_photos WHERE booking_id = ? AND picture_type = 'BEFORE'`;

		const [checkPhotoAttachedResults] = await db.execute(checkPhotoAttachedQuery, [booking_id]);

		if (checkPhotoAttachedResults.length > 0) {
			return res.status(400).json({ 
				error: "Photo already attached." 
			});
		}

		const { buffer, mimetype } = req.file;

		const result = await uploadUniqueFile(buffer, mimetype);
		if (result.message === 'File already exists') {
			return res.status(409).json({ 
				error: "File already exists." 
			});
		}

		const addPhotoToBookingServiceQuery = `
			INSERT INTO booking_photos (booking_id, picture_id, picture_type, created_at, updated_at) VALUES (?, ?, 'BEFORE', NOW(), NOW())
		`;
		const [addPhotoToBookingServiceResults] = await db.execute(addPhotoToBookingServiceQuery, [booking_id, result.picture_id]);

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
		const { booking_id, type } = req.body;

		if (!booking_id || !type) {
			return res.status(400).json({ 
				error: "Booking ID abd Type is required." 
			});
		}

		if (type !== 'BEFORE' && type !== 'AFTER') {
			return res.status(400).json({ 
				error: "Invalid type." 
			});
		}

		const getPictureIdQuery = `
			SELECT picture_id, s3_key FROM pictures WHERE  picture_id = (SELECT picture_id FROM booking_photos WHERE booking_id = ? AND picture_type = ?);
		`;

		const [bookingPhotoRows] = await db.execute(getPictureIdQuery, [booking_id, type]);

		console.log(bookingPhotoRows);

		if (bookingPhotoRows.length === 0) {
			return res.status(404).json({ message: 'Booking photo not found' });
		}

		await db.query('START TRANSACTION');

		const deleteBookingPhotoQuery = `
			DELETE FROM booking_photos WHERE booking_id = ? AND picture_type = ?;
		`;
		const [deleteBookingPhotoResults] = await db.execute(deleteBookingPhotoQuery, [booking_id, type]);

		console.log(deleteBookingPhotoResults);

		if (deleteBookingPhotoResults.affectedRows === 0) {
			await db.query('ROLLBACK');
			return res.status(404).json({ 
				error: "Failed to delete booking photo." 
			});
		}

		const deletePhotoQuery = `
			DELETE FROM pictures WHERE picture_id = ?;
		`;
		const [deletePhotoResults] = await db.execute(deletePhotoQuery, [bookingPhotoRows[0].picture_id]);

		if (deletePhotoResults.affectedRows === 0) {
			await db.query('ROLLBACK');
			return res.status(404).json({ 
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

// UPH 1.6 Get Photos
exports.getPhoto = async (req, res) => {
	const db = connection.promise();
  
	try {
		const { booking_id } = req.query;
  
	  	if (!booking_id) {
			return res.status(400).json({
				error: "Booking ID are required."
			});
		}
	  	const getPictureKeyQuery = `
		SELECT p.s3_key
		FROM booking_photos bp
		JOIN pictures p ON p.picture_id = bp.picture_id
		WHERE bp.booking_id = ?
		ORDER BY 
			CASE 
				WHEN UPPER(bp.picture_type) = 'BEFORE' THEN 1
				WHEN UPPER(bp.picture_type) = 'AFTER' THEN 2
				ELSE 3
			END;
		`;

		const [rows] = await db.execute(getPictureKeyQuery, [booking_id]);

		if (rows.length === 0) {
			return res.status(404).json({ message: "No photo found for this booking/type." });
		}

		let before = "";
		let after = "";

		if (rows[0]) {
			const { url, error } = await getFilePresigned(rows[0].s3_key);
			if (error) {
				return res.status(500).json({ error: "Failed to generate S3 pre-signed URL." });
			}
			before = url;
		}

		if (rows[1]) {
			const { url, error } = await getFilePresigned(rows[1].s3_key);
			if (error) {
				return res.status(500).json({ error: "Failed to generate S3 pre-signed URL." });
			}
			after = url;
		}

		return res.status(200).json({ before, after });
	} catch (err) {
	  console.error("getPhoto error:", err);
	  return res.status(500).json({
		message: "Internal server error retrieving photo."
	  });
	}
};

// UPH 1.6 Check if photo attached
exports.checkIfPhotoAttached = async (req, res) => {
	const db = connection.promise();

	try {
		const { booking_id } = req.query;

		if (!booking_id) {
			return res.status(400).json({
				error: "Booking ID are required."
			});
		}

	  	const getPictureKeyQuery = `
		SELECT s3_key 
		FROM pictures 
		WHERE picture_id IN (
			SELECT picture_id 
			FROM booking_photos 
			WHERE booking_id = ?);
		`;

		const [rows] = await db.execute(getPictureKeyQuery, [booking_id]);

		if (rows.length === 0) {
			return res.status(404).json({ message: "No photo found for this booking." });
		}

		return res.status(200).json({
			message: "Photos exist."
		});
	}
	catch (error) {
		console.error("Check if photo attached error:", error);
		res.status(500).json({ 
			error: "Failed to check if photo attached." 
		});
	}
};
  