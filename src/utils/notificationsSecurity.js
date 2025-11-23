require('dotenv').config();
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.NOTIFICATION_ENCRYPTION_KEY;

// Encrypt notification message
exports.encryptMessage = (message) => {
    if (!message || typeof message !== 'string') {
        throw new Error('Invalid message: must be a non-empty string');
    }

    if (!ENCRYPTION_KEY) {
        throw new Error('NOTIFICATION_ENCRYPTION_KEY is not set in environment variables');
    }

    if (ENCRYPTION_KEY.length !== 64) {
        throw new Error('NOTIFICATION_ENCRYPTION_KEY must be 64 characters (32 bytes in hex)');
    }

    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(message, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
};

// Decrypt notification message
exports.decryptMessage = (encryptedData) => {
    if (!encryptedData || typeof encryptedData !== 'string') {
        throw new Error('Invalid encrypted data: must be a non-empty string');
    }

    if (!ENCRYPTION_KEY) {
        throw new Error('NOTIFICATION_ENCRYPTION_KEY is not set in environment variables');
    }

    if (ENCRYPTION_KEY.length !== 64) {
        throw new Error('NOTIFICATION_ENCRYPTION_KEY must be 64 characters (32 bytes in hex)');
    }

    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format: expected iv:encrypted:authTag');
    }
    
    const [ivHex, encrypted, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
};

