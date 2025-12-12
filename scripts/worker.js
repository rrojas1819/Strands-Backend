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
    runTempCreditCardCleanup
} = require('../src/utils/utilies'); 

async function runScheduledJobs() {
    const now = DateTime.local();
    const currentMinute = now.minute;
    const currentHour = now.hour;
    const jobPromises = [];
    
    jobPromises.push(runAppointmentReminders(db)); 
    jobPromises.push(runBookingsAutoComplete(db));
    
    if (currentMinute % 2 === 0) {
        jobPromises.push(runLoyaltySeenUpdate(db));
    }
    
    if (currentMinute % 5 === 0) {
        jobPromises.push(runExpirePromoCodes(db)); 
    }
    
    if (currentMinute % 15 === 0) {
        jobPromises.push(runTokenCleanup(db)); 
    }
    
    if (currentMinute === 0) { 
        jobPromises.push(runTempCreditCardCleanup(db)); 
    }
    
    if (currentMinute === 0 && (currentHour === 0 || currentHour === 12)) {
         jobPromises.push(runUnusedOffersReminders(db)); 
    }
    
    try {
        await Promise.all(jobPromises);
        process.exit(0); 
    } catch (error) {
        console.error('Worker job failed:', error);
        process.exit(1);
    }
}

runScheduledJobs();
