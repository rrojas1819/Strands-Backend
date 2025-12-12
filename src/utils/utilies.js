const { DateTime } = require('luxon');
const notificationSecurity = require('./notificationsSecurity');

function logUtcDebug(label, value) {
   if (process.env.UTC_DEBUG === '1') {
       const type = value instanceof DateTime ? 'DateTime' : typeof value;
       const printable = value instanceof DateTime ? value.toISO() : value;
       console.log(`[UTC DEBUG] ${label}:`, printable, `(type: ${type})`);
   }
}

const validateEmail = (email) => {
   const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
   return emailRegex.test(email);
};

function toMySQLUtc(dt) {
   if (!(dt instanceof DateTime)) {
       throw new Error('toMySQLUtc requires a DateTime object');
   }
   return dt.toUTC().toFormat('yyyy-MM-dd HH:mm:ss');
}

function localAvailabilityToUtc(availabilityTime, dateStr, timezone) {
   if (!availabilityTime || !dateStr || !timezone) {
       throw new Error('localAvailabilityToUtc requires availabilityTime, dateStr, and timezone');
   }

   const [hours, minutes] = availabilityTime.split(':').map(Number);

   if (isNaN(hours) || isNaN(minutes)) {
       throw new Error(`Invalid time format: ${availabilityTime}`);
   }

   const localDt = DateTime.fromObject(
       {
           year: parseInt(dateStr.split('-')[0]),
           month: parseInt(dateStr.split('-')[1]),
           day: parseInt(dateStr.split('-')[2]),
           hour: hours,
           minute: minutes,
           second: 0,
           millisecond: 0
       },
       { zone: timezone }
   );

   if (!localDt.isValid) {
       throw new Error(`Invalid date or time: ${dateStr} ${availabilityTime} - ${localDt.invalidReason}`);
   }

   return localDt.toUTC();
}

const formatDateTime = (dt) => {
   if (!dt) return null;
  
   let dateTime;
  
   if (dt instanceof DateTime) {
       dateTime = dt;
   } else if (typeof dt === 'string') {
       const isNaiveMySQL = dt.includes(' ') && !dt.includes('T') && !/[zZ]|[+-]\d{2}:\d{2}$/.test(dt);
       if (isNaiveMySQL) {
           dateTime = DateTime.fromSQL(dt, { zone: 'utc' });
       } else {
           dateTime = DateTime.fromISO(dt);
       }
   } else {
       return String(dt);
   }
  
   if (!dateTime || !dateTime.isValid) {
       return String(dt);
   }
  
   return dateTime.toISO();
};

function utcToLocalDateString(dt, timezone) {
   if (!(dt instanceof DateTime)) {
       throw new Error('utcToLocalDateString requires a DateTime object');
   }
   return dt.setZone(timezone).toFormat('yyyy-MM-dd');
}

// Helper to convert Luxon weekday (1-7, Monday=1, Sunday=7) to database weekday (0-6, Sunday=0, Saturday=6)
function luxonWeekdayToDb(luxonWeekday) {
   // Luxon: 1=Monday, 2=Tuesday, ..., 6=Saturday, 7=Sunday
   // DB: 0=Sunday, 1=Monday, 2=Tuesday, ..., 6=Saturday
   return luxonWeekday === 7 ? 0 : luxonWeekday;
}

async function runTokenCleanup(connection) {
   try {
       const db = connection.promise();
       const currentUtc = toMySQLUtc(DateTime.utc());
      
       const getExpiredUsersQuery = `
           SELECT user_id
           FROM auth_credentials
           WHERE token_expires_at IS NOT NULL
           AND token_expires_at < ?
       `;
       const [expiredUsers] = await db.execute(getExpiredUsersQuery, [currentUtc]);
      
       if (expiredUsers.length > 0) {
           const expiredUserIds = expiredUsers.map(user => user.user_id);
           const placeholders = expiredUserIds.map(() => '?').join(',');// Placeholders for the query
          
           const deactivateUsersQuery = `
               UPDATE users
               SET active = 0
               WHERE user_id IN (${placeholders})
               AND active = 1
           `;
           //const [userResult] =
           await db.execute(deactivateUsersQuery, expiredUserIds);
          
           const clearTokensQuery = `
               UPDATE auth_credentials
               SET token_expires_at = NULL
               WHERE user_id IN (${placeholders})
               AND token_expires_at IS NOT NULL
           `;
           //const [tokenResult] =
           await db.execute(clearTokensQuery, expiredUserIds);
          
           //console.log(`Cleanup: Deactivated ${userResult.affectedRows} users and cleared ${tokenResult.affectedRows} expired tokens`);
       }
   } catch (error) {
       console.error('Token cleanup job failed:', error);
   }
}



// Cleanup job to auto-complete finished bookings every 1 hour
async function runBookingsAutoComplete(connection) {
   try {
       const db = connection.promise();
       const nowMinusGrace = DateTime.utc().minus({ minutes: 0.1 });
       const currentUtc = toMySQLUtc(nowMinusGrace);

       const updateQuery = `
           UPDATE bookings
           SET status = 'COMPLETED'
           WHERE status = 'SCHEDULED'
             AND scheduled_end IS NOT NULL
             AND scheduled_end < ?
       `;
       await db.execute(updateQuery, [currentUtc]);
   } catch (error) {
       console.error('Bookings auto-complete job failed:', error);
   }
}


// Job to update loyalty_seen for completed bookings with past end times every 15 minutes
async function runLoyaltySeenUpdate(connection) {
   try {
       const db = connection.promise();
       const currentUtc = toMySQLUtc(DateTime.utc());


       const getCompletedBookingsQuery = `
           SELECT booking_id, customer_user_id, salon_id
           FROM bookings
           WHERE status = 'COMPLETED'
             AND (loyalty_seen = 0 OR loyalty_seen IS NULL)
             AND scheduled_end IS NOT NULL
             AND scheduled_end < ?
       `;
       const [completedBookings] = await db.execute(getCompletedBookingsQuery, [currentUtc]);


       for (const booking of completedBookings) {
           try {
               await db.beginTransaction();
              
               const checkMembershipQuery = `
                   SELECT membership_id, visits_count
                   FROM loyalty_memberships
                   WHERE user_id = ? AND salon_id = ?
                   FOR UPDATE
               `;
               const [membership] = await db.execute(checkMembershipQuery, [booking.customer_user_id, booking.salon_id]);


               if (membership.length === 0) {
                   const nowUtc = toMySQLUtc(DateTime.utc());
                   const insertMembershipQuery = `
                       INSERT INTO loyalty_memberships (user_id, salon_id, visits_count, total_visits_count, created_at, updated_at)
                       VALUES (?, ?, 0, 0, ?, ?)
                   `;
                   await db.execute(insertMembershipQuery, [booking.customer_user_id, booking.salon_id, nowUtc, nowUtc]);
               }


               const nowUtc = toMySQLUtc(DateTime.utc());
               const incrementVisitsQuery = `
                   UPDATE loyalty_memberships
                   SET visits_count = visits_count + 1,
                       total_visits_count = COALESCE(total_visits_count, 0) + 1,
                       updated_at = ?
                   WHERE user_id = ? AND salon_id = ?
               `;
               await db.execute(incrementVisitsQuery, [nowUtc, booking.customer_user_id, booking.salon_id]);


               const getLoyaltyProgramQuery = `
                   SELECT target_visits, discount_percentage, note
                   FROM loyalty_programs
                   WHERE salon_id = ? AND active = 1
               `;
               const [loyaltyProgram] = await db.execute(getLoyaltyProgramQuery, [booking.salon_id]);


               if (loyaltyProgram.length > 0) {
                   const program = loyaltyProgram[0];
                   const target_visits = program.target_visits;


                   const [updatedMembership] = await db.execute(
                       `SELECT visits_count FROM loyalty_memberships WHERE user_id = ? AND salon_id = ?`,
                       [booking.customer_user_id, booking.salon_id]
                   );


                   if (updatedMembership.length > 0) {
                       const current_visits = updatedMembership[0].visits_count;


                       if (current_visits >= target_visits) {
                           const new_visits_count = current_visits - target_visits;


                           const currentUtc = toMySQLUtc(DateTime.utc());
                           const insertRewardQuery = `
                               INSERT INTO available_rewards
                               (user_id, salon_id, active, discount_percentage, note, redeemed_at, creationDate, created_at, updated_at)
                               VALUES (?, ?, 1, ?, ?, NULL, ?, ?, ?)
                           `;
                           await db.execute(insertRewardQuery, [
                               booking.customer_user_id,
                               booking.salon_id,
                               program.discount_percentage,
                               program.note,
                               currentUtc,
                               currentUtc,
                               currentUtc
                           ]);


                           const resetVisitsQuery = `
                               UPDATE loyalty_memberships
                               SET visits_count = ?, updated_at = ?
                               WHERE user_id = ? AND salon_id = ?
                           `;
                           await db.execute(resetVisitsQuery, [
                               new_visits_count,
                               currentUtc,
                               booking.customer_user_id,
                               booking.salon_id
                           ]);
                       }
                   }
               }


               const updateBookingQuery = `
                   UPDATE bookings
                   SET loyalty_seen = 1
                   WHERE booking_id = ?
               `;
               await db.execute(updateBookingQuery, [booking.booking_id]);


               await db.commit();
           } catch (bookingError) {
               console.error('Loyalty seen update job - booking error:', bookingError);
               await db.rollback();
           }
       }


       const updateCanceledQuery = `
           UPDATE bookings
           SET loyalty_seen = 2
           WHERE status = 'CANCELED'
             AND (loyalty_seen != 2 OR loyalty_seen IS NULL)
       `;
       await db.execute(updateCanceledQuery);
   } catch (error) {
       console.error('Loyalty seen update job failed:', error);
   }
}




// NC 1.1 - Job to send appointment reminders (24h, 1h, 15min before)
async function runAppointmentReminders(connection) {
   try {
       const db = connection.promise();
           const now = DateTime.utc();
          
           const queryStart = toMySQLUtc(now);
           const queryEnd = toMySQLUtc(now.plus({ hours: 25 }));
          
           const [bookings] = await db.execute(
               `SELECT
                   b.booking_id,
                   b.customer_user_id,
                   b.salon_id,
                   DATE_FORMAT(b.scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
                   DATE_FORMAT(b.scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
                   b.scheduled_start AS scheduled_start_raw,
                   u.email,
                   s.name AS salon_name,
                   s.timezone AS salon_timezone
                FROM bookings b
                JOIN users u ON b.customer_user_id = u.user_id
                JOIN salons s ON b.salon_id = s.salon_id
                WHERE b.status = 'SCHEDULED'
                  AND b.scheduled_start > ?
                  AND b.scheduled_start <= ?`,
               [queryStart, queryEnd]
           );


           for (const booking of bookings) {
               const scheduledStart = DateTime.fromSQL(booking.scheduled_start, { zone: 'utc' });
               const scheduledEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
               if (!scheduledStart.isValid) continue;


               const diffMinutes = scheduledStart.diff(now, 'minutes').minutes;


               let reminderType = null;
               let timeUntil = '';
               let shouldSend = false;
               const windowSize = 3; // 3-minute window

               if (diffMinutes >= (1440 - windowSize) && diffMinutes <= 1440) {
                   reminderType = 'APPOINTMENT_REMINDER_24H';
                   timeUntil = '24 hours';
                   shouldSend = true;
               }
               else if (diffMinutes >= (60 - windowSize) && diffMinutes <= 60) {
                   reminderType = 'APPOINTMENT_REMINDER_1H';
                   timeUntil = '1 hour';
                   shouldSend = true;
               }
               else if (diffMinutes >= (15 - windowSize) && diffMinutes <= 15) {
                   reminderType = 'APPOINTMENT_REMINDER_15MIN';
                   timeUntil = '15 minutes';
                   shouldSend = true;
               }


               if (shouldSend && reminderType) {
                   const [existing] = await db.execute(
                       `SELECT notification_id
                        FROM notifications_inbox
                        WHERE booking_id = ?
                          AND type_code = ?
                          AND user_id = ?`,
                       [booking.booking_id, reminderType, booking.customer_user_id]
                   );


                   if (existing.length === 0) {
                       const [services] = await db.execute(
                           `SELECT
                               s.name AS service_name,
                               bs.duration_minutes
                            FROM booking_services bs
                            JOIN services s ON bs.service_id = s.service_id
                            WHERE bs.booking_id = ?
                            ORDER BY s.name`,
                           [booking.booking_id]
                       );


                       const [stylistResult] = await db.execute(
                           `SELECT DISTINCT u.full_name AS stylist_name
                            FROM booking_services bs
                            JOIN employees e ON bs.employee_id = e.employee_id
                            JOIN users u ON e.user_id = u.user_id
                            WHERE bs.booking_id = ?
                            LIMIT 1`,
                           [booking.booking_id]
                       );
                       const stylistName = stylistResult.length > 0 ? stylistResult[0].stylist_name : null;


                       const salonTimezone = booking.salon_timezone || 'America/New_York';
                      
                       const bookingStartLocal = scheduledStart.setZone(salonTimezone);
                       const bookingEndLocal = scheduledEnd.setZone(salonTimezone);
                      
                       const appointmentDate = bookingStartLocal.toFormat('EEEE, MMMM d, yyyy');
                       const appointmentTime = bookingStartLocal.toFormat('h:mm a');
                       const appointmentEndTime = bookingEndLocal.toFormat('h:mm a');
                      
                       let message = `Reminder: You have an appointment at ${booking.salon_name}${stylistName ? ` with ${stylistName}` : ''} in ${timeUntil}.\n\n`;
                       message += `Date: ${appointmentDate}\n`;
                       message += `Time: ${appointmentTime} - ${appointmentEndTime}\n`;
                      
                       if (services.length > 0) {
                           message += `\nServices:\n`;
                           services.forEach((service) => {
                               message += `- ${service.service_name}`;
                               if (service.duration_minutes) {
                                   message += ` (${service.duration_minutes} min)`;
                               }
                               message += `\n`;
                           });
                       }


                       if (message.length > 500) {
                           message = message.substring(0, 497) + '...';
                       }


                       let encryptedMessage;
                       try {
                           encryptedMessage = notificationSecurity.encryptMessage(message.trim());
                       } catch (encryptError) {
                           console.error('Failed to encrypt appointment reminder notification message:', encryptError);
                           throw new Error('Failed to encrypt notification message');
                       }


                       const nowUtc = toMySQLUtc(now);
                       await db.execute(
                           `INSERT INTO notifications_inbox
                            (user_id, salon_id, email, booking_id, type_code, status, message, sender_email, created_at)
                            VALUES (?, ?, ?, ?, ?, 'UNREAD', ?, 'SYSTEM', ?)`,
                           [
                               booking.customer_user_id,
                               booking.salon_id,
                               booking.email,
                               booking.booking_id,
                               reminderType,
                               encryptedMessage,
                               nowUtc
                           ]
                       );
                   }
               }
           }
   } catch (error) {
       console.error('Appointment reminders job failed:', error);
   }
}


// NC 1.3 - Job to send notifications about unused promos and rewards every 12 hours
async function runUnusedOffersReminders(connection) {
   try {
       const db = connection.promise();
       const notificationsController = require('../controllers/notificationsController');
       await notificationsController.sendUnusedOffersNotifications(db);
   } catch (error) {
       console.error('Unused offers reminders job failed:', error);
   }
}

async function runExpirePromoCodes(connection) {
   try {
       const db = connection.promise();
       const now = DateTime.utc();
       const nowUtc = toMySQLUtc(now);


       const [result] = await db.execute(
           `UPDATE user_promotions
            SET status = 'EXPIRED'
            WHERE status = 'ISSUED'
              AND expires_at IS NOT NULL
              AND expires_at <= ?`,
           [nowUtc]
       );


       if (result.affectedRows > 0 && process.env.NODE_ENV !== 'test') {
           console.log(`Expired ${result.affectedRows} promo code(s) at ${now.toISO()}`);
       }
   } catch (error) {
       console.error('Expire promo codes job failed:', error);
   }
}


// Job to delete temporary credit cards after all associated bookings have passed
async function runTempCreditCardCleanup(connection) {
   try {
       const db = connection.promise();
       const now = DateTime.utc();
       const nowUtc = toMySQLUtc(now);


           // Find all temporary credit cards
           const [tempCards] = await db.execute(
               `SELECT credit_card_id, user_id
                FROM credit_cards
                WHERE is_temporary = TRUE`
           );


       if (tempCards.length === 0) {
           return; // No temporary cards to process
       }


       const cardsToDelete = [];


       for (const card of tempCards) {
           const [paymentsWithBookings] = await db.execute(
               `SELECT DISTINCT p.booking_id
                FROM payments p
                WHERE p.credit_card_id = ?
                  AND p.booking_id IS NOT NULL`,
               [card.credit_card_id]
           );


           if (paymentsWithBookings.length === 0) {
               const [anyPayments] = await db.execute(
                   `SELECT payment_id
                    FROM payments
                    WHERE credit_card_id = ?
                    LIMIT 1`,
                   [card.credit_card_id]
               );


             
               if (anyPayments.length === 0) {
                   cardsToDelete.push(card.credit_card_id);
               }
               continue;
           }


           const bookingIds = paymentsWithBookings.map(p => p.booking_id);
           const placeholders = bookingIds.map(() => '?').join(',');
          
           const [bookings] = await db.execute(
               `SELECT booking_id,
                       status,
                       DATE_FORMAT(scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end
                FROM bookings
                WHERE booking_id IN (${placeholders})`,
               bookingIds
           );


           let allBookingsPassed = true;
           for (const booking of bookings) {
               if (booking.status === 'COMPLETED') {
                   continue;
               }
              
               const bookingEnd = DateTime.fromSQL(booking.scheduled_end, { zone: 'utc' });
               if (bookingEnd.isValid && bookingEnd > now) {
                   allBookingsPassed = false;
                   break;
               }
           }


           if (allBookingsPassed && bookings.length > 0) {
               cardsToDelete.push(card.credit_card_id);
           }
       }


       if (cardsToDelete.length > 0) {
           const deletePlaceholders = cardsToDelete.map(() => '?').join(',');
           const [deleteResult] = await db.execute(
               `DELETE FROM credit_cards
                WHERE credit_card_id IN (${deletePlaceholders})
                  AND is_temporary = TRUE`,
               cardsToDelete
           );


           if (deleteResult.affectedRows > 0 && process.env.NODE_ENV !== 'test') {
               console.log(`Deleted ${deleteResult.affectedRows} temporary credit card(s) at ${now.toISO()}`);
           }
       }
   } catch (error) {
       console.error('Temp credit card cleanup job failed:', error);
   }
}

module.exports = {
   validateEmail,
   runTokenCleanup,
   runBookingsAutoComplete,
   toMySQLUtc,
   formatDateTime,
   runLoyaltySeenUpdate,
   runAppointmentReminders,
   runUnusedOffersReminders,
   runExpirePromoCodes,
   runTempCreditCardCleanup,
   logUtcDebug,
   localAvailabilityToUtc,
   utcToLocalDateString,
   luxonWeekdayToDb
};
