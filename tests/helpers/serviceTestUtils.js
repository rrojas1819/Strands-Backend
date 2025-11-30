const connection = require('../../src/config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc } = require('../../src/utils/utilies');
const { insertUserWithCredentials } = require('./authTestUtils');

const db = connection.promise();

const setupServiceTestEnvironment = async (options = {}) => {
    const password = options.password || 'Password123!';
    const nowUtc = toMySQLUtc(DateTime.utc());

    const owner = await insertUserWithCredentials({
        password,
        role: 'OWNER'
    });

    const stylist = await insertUserWithCredentials({
        password,
        role: 'EMPLOYEE'
    });

    const [salonResult] = await db.execute(
        `INSERT INTO salons (owner_user_id, name, description, category, phone, email, 
         address, city, state, postal_code, country, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            owner.user_id,
            'Test Salon',
            'Test salon description',
            'HAIR SALON',
            '555-0100',
            'test-salon@test.com',
            '123 Main St',
            'Test City',
            'TS',
            '12345',
            'USA',
            'APPROVED',
            nowUtc,
            nowUtc
        ]
    );
    const salonId = salonResult.insertId;

    await db.execute(
        `INSERT INTO employees (salon_id, user_id, title, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [salonId, stylist.user_id, 'Senior Stylist', 1, nowUtc, nowUtc]
    );

    const [employeeResult] = await db.execute(
        `SELECT employee_id FROM employees WHERE user_id = ?`,
        [stylist.user_id]
    );
    const employeeId = employeeResult[0].employee_id;

    return {
        owner,
        stylist,
        salonId,
        employeeId,
        password
    };
};


const baseServicePayload = (overrides = {}) => ({
    name: overrides.name || 'Haircut & Style',
    description: overrides.description || 'Professional haircut and styling service',
    duration_minutes: overrides.duration_minutes !== undefined ? overrides.duration_minutes : 60,
    price: overrides.price !== undefined ? overrides.price : 75
});

module.exports = {
    setupServiceTestEnvironment,
    baseServicePayload
};



