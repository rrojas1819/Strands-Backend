const path = require('path');
const dotenv = require('dotenv');

const envPath = process.env.NODE_ENV === 'test'
    ? path.resolve(process.cwd(), '.env.test')
    : path.resolve(process.cwd(), '.env');

dotenv.config({ path: envPath, override: false });

const db = require('../src/config/databaseConnection');
const { DateTime } = require('luxon');

function waitForConnection(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        // Check if already connected
        if (db.state === 'authenticated' || db.state === 'connected') {
            // Verify with a test query
            return testConnection().then(resolve).catch(() => {
                // If test fails, wait for reconnection
                waitForConnectionWithTest(timeoutMs).then(resolve).catch(reject);
            });
        }
        
        // Wait for connection and test it
        waitForConnectionWithTest(timeoutMs).then(resolve).catch(reject);
    });
}

function waitForConnectionWithTest(timeoutMs) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        
        const attemptConnection = () => {
            // First check state
            if (db.state === 'authenticated' || db.state === 'connected') {
                // Test the connection with a simple query
                return testConnection()
                    .then(resolve)
                    .catch((err) => {
                        if (Date.now() >= deadline) {
                            return reject(new Error(`Database connection test failed: ${err.message}`));
                        }
                        setTimeout(attemptConnection, 500);
                    });
            }
            
            // If not connected yet, wait and retry
            if (Date.now() >= deadline) {
                return reject(new Error(`Database connection timeout. Current state: ${db.state || 'unknown'}`));
            }
            
            setTimeout(attemptConnection, 200);
        };
        
        attemptConnection();
    });
}

function testConnection() {
    return new Promise((resolve, reject) => {
        db.query('SELECT 1 as test', (err) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

const {
    runTokenCleanup, 
    runBookingsAutoComplete, 
    runLoyaltySeenUpdate, 
    runAppointmentReminders, 
    runUnusedOffersReminders, 
    runExpirePromoCodes, 
    runTempCreditCardCleanup,
    runPendingBookingCleanup
} = require('../src/utils/utilies'); 

async function runScheduledJobs() {
    try {
        console.log('Waiting for database connection...');
        console.log('Initial connection state:', db.state || 'unknown');
        await waitForConnection();
        console.log('Database connection established. State:', db.state);
    } catch (error) {
        console.error('Failed to establish database connection:', error.message);
        console.error('Connection state:', db.state || 'unknown');
        console.error('DB_HOST:', process.env.DB_HOST || 'not set');
        console.error('DB_NAME:', process.env.DB_NAME || 'not set');
        console.error('DB_PORT:', process.env.DB_PORT || 'not set');
        process.exit(1);
    }
    
    // Check connection health before running jobs
    if (db.state !== 'authenticated' && db.state !== 'connected') {
        console.error('Database connection not ready, state:', db.state);
        process.exit(1);
    }
    
    const jobs = [
        { name: 'AppointmentReminders', fn: runAppointmentReminders },
        { name: 'BookingsAutoComplete', fn: runBookingsAutoComplete },
        { name: 'PendingBookingCleanup', fn: runPendingBookingCleanup },
        { name: 'LoyaltySeenUpdate', fn: runLoyaltySeenUpdate },
        { name: 'ExpirePromoCodes', fn: runExpirePromoCodes },
        { name: 'TokenCleanup', fn: runTokenCleanup },
        { name: 'TempCreditCardCleanup', fn: runTempCreditCardCleanup },
        { name: 'UnusedOffersReminders', fn: runUnusedOffersReminders }
    ];
    
    // Run jobs with individual error handling so one failure doesn't crash all
    const results = await Promise.allSettled(
        jobs.map(job => 
            job.fn(db).catch(error => {
                console.error(`${job.name} job failed:`, error);
                return { error: true, job: job.name };
            })
        )
    );
    
    const failed = results.filter(r => r.status === 'rejected' || (r.value && r.value.error));
    if (failed.length > 0) {
        console.warn(`${failed.length} job(s) failed, but continuing...`);
    }
    
    const successful = results.length - failed.length;
    if (successful > 0) {
        console.log(`Successfully completed ${successful} job(s)`);
    }
    
    process.exit(0);
}

runScheduledJobs().catch((err) => {
    console.error('Worker failed:', err);
    process.exit(1);
});
