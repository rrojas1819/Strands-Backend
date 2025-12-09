const request = require('supertest');
const app = require('../../src/app');
const { insertUserWithCredentials, generateTestToken } = require('./authTestUtils');

const baseSalonPayload = (overrides = {}) => ({
    name: overrides.name || 'Test Salon091384723',
    description: overrides.description !== undefined ? overrides.description : 'A test salon description',
    category: overrides.category || 'HAIR SALON',
    phone: overrides.phone !== undefined ? overrides.phone : '555-1234',
    email: overrides.email !== undefined ? overrides.email : 'salon@test.com',
    address: overrides.address !== undefined ? overrides.address : '123 Main Street',
    city: overrides.city !== undefined ? overrides.city : 'Test City',
    state: overrides.state !== undefined ? overrides.state : 'TS',
    postal_code: overrides.postal_code !== undefined ? overrides.postal_code : '12345',
    country: overrides.country !== undefined ? overrides.country : 'USA',
    ...overrides
});

const setupOwnerWithoutSalon = async () => {
    const password = 'Password123!';
    const owner = await insertUserWithCredentials({
        password,
        role: 'OWNER'
    });

    const token = generateTestToken(owner);

    return { owner, token, password };
};

module.exports = {
    baseSalonPayload,
    setupOwnerWithoutSalon
};
