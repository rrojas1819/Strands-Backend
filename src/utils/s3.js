require('dotenv').config();
const connection = require('../config/databaseConnection');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
	region: process.env.AWS_REGION,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
	}
});

async function uploadUniqueFile(fileBuffer, mimetype) {
	const bucket = (process.env.AWS_S3_BUCKET || '').trim();

	if (!bucket || !fileBuffer || !mimetype)
		throw new Error('Missing S3 bucket name or file buffer or mimetype');

	const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
	const ext = (mimetype.split('/')[1] || 'bin').toLowerCase();
	const key = `${process.env.AWS_S3_DEFAULT_PREFIX}/${hash}.${ext}`;

	// Check if file exists
	try {
		await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		return {
			message: 'File already exists'
		};
	} catch (err) {
		if (err?.$metadata?.httpStatusCode && err.$metadata.httpStatusCode !== 404 && err.name !== 'NotFound') {
			throw err;
		}
	}

	// Upload new object
	await s3.send(new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		Body: fileBuffer,
		ContentType: mimetype
	}));

	const db = connection.promise();
	const [result] = await db.execute('INSERT INTO pictures (s3_key, created_at, updated_at) VALUES ( ?, NOW(), NOW())', [key]);

	return {
		message: 'File uploaded successfully',
		picture_id: result.insertId
	};
}

async function deleteFile(key) {
	const bucket = (process.env.AWS_S3_BUCKET || '').trim();

	if (!bucket || !key)
		return {error: 'Missing key'};

	await s3.send(new DeleteObjectCommand({
		Bucket: bucket,
		Key: key
	}));

	return { message: 'File deleted successfully' };
}

module.exports = {
	s3,
	uploadUniqueFile,
	deleteFile
};

