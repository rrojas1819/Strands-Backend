const { uploadUniqueFile, deleteFile, getFile, getFileStream } = require('../utils/s3.js');
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
				error: "Booking Photo ID is required." 
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

// UPH 1.6 Get Photos
exports.getPhoto = async (req, res) => {
	const db = connection.promise();
	try {
		const { booking_id, type } = req.body;

		const getPictureKeyQuery = 
		`SELECT s3_key FROM pictures WHERE picture_id = (SELECT picture_id FROM booking_photos WHERE booking_id = ? AND picture_type = ?);`;

		const [getPictureKeyResults] = await db.execute(getPictureKeyQuery, [booking_id, type]);

		if (getPictureKeyResults.length === 0) {
			return res.status(404).json({ message: 'Picture key not found' });
		}

		const file = await getFileStream(getPictureKeyResults[0].s3_key);
		if (file.error) {
			return res.status(400).json({ 
				message: file.error 
			});
		}

		res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
		if (file.contentLength) res.setHeader('Content-Length', String(file.contentLength));

		file.stream.on('error', (err) => {
			console.error('S3 stream error', err);
			if (!res.headersSent) {
				res.status(500).end('Stream error');
			} else {
				res.end();
			}
		});

		file.stream.pipe(res);
	} catch (err) {
		console.error('getPhoto error:', err);
		return res.status(500).json({ 
			message: 'Failed to fetch file' 
		});
	}
};