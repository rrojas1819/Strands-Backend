require('dotenv').config();
const connection = require('../config/databaseConnection');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('./utilies');

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
	const nowUtc = toMySQLUtc(DateTime.utc());
	const [result] = await db.execute('INSERT INTO pictures (s3_key, created_at, updated_at) VALUES ( ?, ?, ?)', [key, nowUtc, nowUtc]);

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

async function streamToBuffer(stream) {
	return await new Promise((resolve, reject) => {
		const chunks = [];
		stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(chunks)));
	});
}


async function getFileStream(key) {
	const bucket = (process.env.AWS_S3_BUCKET || '').trim();

	if (!bucket || !key)
		return { error: 'Missing key' };

	// Abort the request if it takes too long
	const ac = new AbortController();
	const timeoutMs = Number(process.env.S3_GET_TIMEOUT_MS || 15000);
	const timer = setTimeout(() => ac.abort(), timeoutMs);

	try {
		const resp = await s3.send(new GetObjectCommand({
			Bucket: bucket,
			Key: key
		}), { abortSignal: ac.signal });
		clearTimeout(timer);

		return {
			stream: resp.Body,
			contentType: resp.ContentType,
			contentLength: resp.ContentLength
		};
	} catch (err) {
		clearTimeout(timer);
		throw err;
	}
}


async function getFilePresigned(key) {
	try {
		const command = new GetObjectCommand({
		  Bucket: process.env.AWS_S3_BUCKET,
		  Key: key
		});
	
		const url = await getSignedUrl(s3, command, { expiresIn: 120 });
		return { url };
	  } catch (err) {
		console.error("Presigned error:", err);
		return { error: "Failed to generate presigned URL" };
	  }
};

module.exports = {
	s3,
	uploadUniqueFile,
	deleteFile,
	getFileStream,
	getFilePresigned
};

