const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const defaultEnvFile = path.resolve(process.cwd(), '.env.test');

if (fs.existsSync(defaultEnvFile)) {
    dotenv.config({ path: defaultEnvFile, override: true });
} else {
    dotenv.config({ override: true });
}

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_NAME || process.env.TEST_DB_NAME || 'localTest';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.BCRYPT_SALT = process.env.BCRYPT_SALT || '10';
process.env.NOTIFICATION_ENCRYPTION_KEY = process.env.NOTIFICATION_ENCRYPTION_KEY
    || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.TEST_USE_EXTERNAL_TRANSACTIONS = 'true';

