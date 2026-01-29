const path = require('path');
const dotenv = require('dotenv');

const envPath = process.env.NODE_ENV === 'test'
    ? path.resolve(process.cwd(), '.env.test')
    : path.resolve(process.cwd(), '.env');

dotenv.config({ path: envPath, override: false });

const db = require('../src/config/databaseConnection');
const { DateTime } = require('luxon');

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
    // Give connection a moment to establish, then check
    await new Promise(resolve => setTimeout(resolve, 2000));
    
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
