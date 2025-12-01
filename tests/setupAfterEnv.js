const connection = require('../src/config/databaseConnection');

const db = connection.promise();

beforeEach(async () => {
    await db.beginTransaction();
});

afterEach(async () => {
    try {
        await db.rollback();
    } catch (error) {
        console.error('Test rollback failed:', error);
    }
    jest.clearAllMocks();
    jest.restoreAllMocks();
});

afterAll(async () => {
    await connection.end();
});

