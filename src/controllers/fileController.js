const { uploadUniqueFile, deleteFile, getFilePresigned } = require('../utils/s3.js');
const connection = require('../config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../utils/utilies');

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
			if (process.env.UTC_DEBUG === '1') {
				console.log("No file attched.");
			}
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

		const nowUtc = toMySQLUtc(DateTime.utc());
		const addPhotoToBookingServiceQuery = `
			INSERT INTO booking_photos (booking_id, picture_id, picture_type, created_at, updated_at) VALUES (?, ?, 'AFTER', ?, ?)
		`;
		const [addPhotoToBookingServiceResults] = await db.execute(addPhotoToBookingServiceQuery, [booking_id, result.picture_id, nowUtc, nowUtc]);

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
			if (process.env.UTC_DEBUG === '1') {
				console.log("No file attched.");
			}
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

		const nowUtc = toMySQLUtc(DateTime.utc());
		const addPhotoToBookingServiceQuery = `
			INSERT INTO booking_photos (booking_id, picture_id, picture_type, created_at, updated_at) VALUES (?, ?, 'BEFORE', ?, ?)
		`;
		const [addPhotoToBookingServiceResults] = await db.execute(addPhotoToBookingServiceQuery, [booking_id, result.picture_id, nowUtc, nowUtc]);

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

		if (process.env.UTC_DEBUG === '1') {
			console.log(bookingPhotoRows);
		}

		if (bookingPhotoRows.length === 0) {
			return res.status(404).json({ message: 'Booking photo not found' });
		}

		await db.query('START TRANSACTION');

		const deleteBookingPhotoQuery = `
			DELETE FROM booking_photos WHERE booking_id = ? AND picture_type = ?;
		`;
		const [deleteBookingPhotoResults] = await db.execute(deleteBookingPhotoQuery, [booking_id, type]);

		if (process.env.UTC_DEBUG === '1') {
			console.log(deleteBookingPhotoResults);
		}

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
		SELECT
			MAX(CASE WHEN UPPER(bp.picture_type) = 'BEFORE' THEN p.s3_key END) AS before_key,
			MAX(CASE WHEN UPPER(bp.picture_type) = 'AFTER' THEN p.s3_key END) AS after_key
		FROM booking_photos bp
		JOIN pictures p ON p.picture_id = bp.picture_id
		WHERE bp.booking_id = ?;
		`;

		const [rows] = await db.execute(getPictureKeyQuery, [booking_id]);

		if (rows.length === 0) {
			return res.status(404).json({ message: "No photo found for this booking/type." });
		}

		let before = "";
		let after = "";

		const beforeKey = rows[0]?.before_key;
		if (beforeKey) {
			const { url, error } = await getFilePresigned(beforeKey);
			if (error) {
				return res.status(500).json({ error: "Failed to generate S3 pre-signed URL." });
			}
			before = url;
		}

		const afterKey = rows[0]?.after_key;
		if (afterKey) {
			const { url, error } = await getFilePresigned(afterKey);
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
  
exports.getSalonGallery = async (req, res) => {
	const db = connection.promise();

	try {
		const { salon_id, employee_id, limit, offset } = req.query;

		if (!salon_id || !employee_id || isNaN(limit) || isNaN(offset)) {
			return res.status(400).json({
				error: "Fields missing or invalid."
			});
		}

		const limitNum = parseInt(limit);
		const offsetNum = parseInt(offset);
		const currentPage = Math.floor(offsetNum / limitNum) + 1;

		const getSalonGalleryQuery = `
			SELECT p.s3_key, bp.picture_type, s.name, b.scheduled_end
			FROM booking_photos bp 
			JOIN bookings b ON bp.booking_id = b.booking_id
			JOIN booking_services bs ON bs.booking_id = b.booking_id
  			JOIN services s ON bs.service_id = s.service_id
			JOIN employees e ON bs.employee_id = e.employee_id
			JOIN pictures p On bp.picture_id = p.picture_id
			WHERE e.employee_id = ? AND bp.booking_id IN (SELECT booking_id FROM bookings WHERE salon_id = ?)

			LIMIT ${limit} OFFSET ${offset};
		`;

		const getCountQuery = `
			SELECT COUNT(*) as total
			FROM booking_photos bp 
			JOIN bookings b ON bp.booking_id = b.booking_id
			JOIN booking_services bs ON bs.booking_id = b.booking_id
			JOIN employees e ON bs.employee_id = e.employee_id
			WHERE e.employee_id = ? AND b.salon_id = ?;
		`;

		const [[rows], [countRows]] = await Promise.all([
			db.execute(getSalonGalleryQuery, [employee_id, salon_id]),
			db.execute(getCountQuery, [employee_id, salon_id])
		]);

		const total = countRows[0]?.total || 0;
		const totalPages = Math.ceil(total / limitNum);

		if (rows.length === 0) {
			return res.status(404).json({ message: "No photos found for this salon." });
		}

		// Build before and after arrays with metadata
		const before = [];
		const after = [];
		
		await Promise.all(rows.map(async (row) => {
			const { url, error } = await getFilePresigned(row.s3_key);
			if (error || !url) return;
			
			const item = {
				url,
				service_name: row.name,
				scheduled_end: row.scheduled_end
			};
			
			const pictureType = (row.picture_type || '').toUpperCase();
			if (pictureType === 'BEFORE') {
				before.push(item);
			} else if (pictureType === 'AFTER') {
				after.push(item);
			}
		}));

		return res.status(200).json({
			before,
			after,
			pagination: {
				currentPage,
				limit: limitNum,
				offset: offsetNum,
				total,
				totalPages,
				hasNextPage: currentPage < totalPages,
				hasPreviousPage: currentPage > 1
			}
		});

	} catch (error) {
		console.error("getSalonGallery error:", error);
		res.status(500).json({ 
			error: "Failed to get salon gallery." 
		});
	}

	
  }