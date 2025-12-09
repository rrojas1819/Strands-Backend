module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    setupFiles: ['<rootDir>/tests/setupEnv.js'],
    setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.js'],
    testTimeout: 30000,
    verbose: true,
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/server.js'
    ]
};

