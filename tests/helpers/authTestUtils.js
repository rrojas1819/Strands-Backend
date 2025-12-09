const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { DateTime } = require('luxon');
const connection = require('../../src/config/databaseConnection');
const { toMySQLUtc } = require('../../src/utils/utilies');

const db = connection.promise();

const ROLE_CASES = ['CUSTOMER', 'OWNER', 'EMPLOYEE', 'ADMIN'];

let commonPasswordHashCache = null;
const getCommonPasswordHash = async () => {
    if (!commonPasswordHashCache) {
        const saltRounds = Number(process.env.BCRYPT_SALT) || 4;
        commonPasswordHashCache = await bcrypt.hash('Password123!', saltRounds);
    }
    return commonPasswordHashCache;
};

const generateUniqueEmail = () =>
    `test_user_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

const baseSignupPayload = (overrides = {}) => ({
    full_name: overrides.full_name || `Test User ${Date.now()}`,
    email: overrides.email || generateUniqueEmail(),
    role: overrides.role || 'CUSTOMER',
    password: overrides.password || 'Password123!'
});

const insertUserWithCredentials = async (overrides = {}) => {
    const nowUtc = toMySQLUtc(DateTime.utc());
    const userData = {
        full_name: overrides.full_name || `Existing User ${Date.now()}`,
        email: overrides.email || generateUniqueEmail(),
        role: overrides.role || 'CUSTOMER',
        password: overrides.password || 'Password123!',
        active: overrides.active ?? 1
    };

    const [userResult] = await db.execute(
        `INSERT INTO users (full_name, email, phone, profile_picture_url, role, last_login_at, active, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        [
            userData.full_name,
            userData.email,
            userData.role,
            nowUtc,
            userData.active,
            nowUtc,
            nowUtc
        ]
    );

    const userId = userResult.insertId;
    let passwordHash = overrides.passwordHash;
    if (!passwordHash) {
        if (userData.password === 'Password123!') {
            passwordHash = await getCommonPasswordHash();
        } else {
            passwordHash = await bcrypt.hash(userData.password, Number(process.env.BCRYPT_SALT));
        }
    }

    await db.execute(
        `INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [userId, passwordHash, nowUtc, nowUtc]
    );

    return {
        ...userData,
        user_id: userId
    };
};

const generateTestToken = (user) => {
    return jwt.sign(
        { 
            user_id: user.user_id, 
            role: user.role, 
            email: user.email 
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
};

const generateFakeToken = (options = {}) => {
    return jwt.sign(
        { 
            user_id: options.user_id || 99999,
            role: options.role || 'CUSTOMER',
            email: options.email || `fake${options.role || 'CUSTOMER'}@test.com`
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
};

module.exports = {
    ROLE_CASES,
    baseSignupPayload,
    insertUserWithCredentials,
    generateTestToken,
    generateFakeToken
};

