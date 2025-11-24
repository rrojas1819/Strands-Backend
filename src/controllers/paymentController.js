const connection = require('../config/databaseConnection');
const paymentSecurity = require('../utils/paymentSecurity');
const { toMySQLUtc, formatDateTime } = require('../utils/utilies');
const { DateTime } = require('luxon');
const { createNotification } = require('./notificationsController');

// PLR 1.5 Get available rewards for a salon
exports.getAvailableRewards = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { salon_id } = req.body;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!salon_id) {
            return res.status(400).json({ message: 'salon_id is required' });
        }

        const [availableRewards] = await db.execute(
            `SELECT reward_id, discount_percentage, note, creationDate
             FROM available_rewards
             WHERE user_id = ? AND salon_id = ? AND active = 1 AND redeemed_at IS NULL
             ORDER BY creationDate DESC`,
            [user_id, salon_id]
        );

        const [loyaltyProgram] = await db.execute(
            `SELECT target_visits, discount_percentage, note
             FROM loyalty_programs
             WHERE salon_id = ? AND active = 1`,
            [salon_id]
        );

        if (loyaltyProgram.length === 0) {
            return res.status(200).json({
                rewards: [],
                loyalty_program: null,
                message: 'No active loyalty program found for this salon'
            });
        }

        const programData = loyaltyProgram[0];

        const formattedRewards = availableRewards.map(reward => {
            // Parse creationDate from database (could be SQL format or ISO format)
            let createdAt;
            if (reward.creationDate) {
                const dateStr = String(reward.creationDate);
                // Check if it's SQL format (YYYY-MM-DD HH:mm:ss) or ISO format
                const isNaiveMySQL = dateStr.includes(' ') && !dateStr.includes('T') && !/[zZ]|[+-]\d{2}:\d{2}$/.test(dateStr);
                if (isNaiveMySQL) {
                    createdAt = DateTime.fromSQL(dateStr, { zone: 'utc' });
                } else {
                    createdAt = DateTime.fromISO(dateStr);
                }
            }
            return {
                ...reward,
                creationDate: formatDateTime(createdAt)
            };
        });

        return res.status(200).json({
            rewards: formattedRewards,
            loyalty_program: {
                target_visits: programData.target_visits,
                discount_percentage: programData.discount_percentage,
                note: programData.note
            },
            total_available: formattedRewards.length
        });

    } catch (error) {
        console.error('getAvailableRewards error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// PLR 1.1 Process a payment online
exports.processPayment = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { 
            credit_card_id,
            billing_address_id,
            amount,
            order_id,
            booking_id,
            use_loyalty_discount = false,
            reward_id,
            promo_code
        } = req.body;

        // Validate required fields
        if (!credit_card_id || !billing_address_id || !amount) {
            return res.status(400).json({ 
                message: 'Required fields: credit_card_id, billing_address_id, amount' 
            });
        }

        // Constraint requires exactly one of booking_id or order_id to be set
        if ((!booking_id && !order_id) || (booking_id && order_id)) {
            return res.status(400).json({ 
                message: 'Exactly one of booking_id or order_id must be provided' 
            });
        }

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Validate amount
        const paymentAmount = parseFloat(amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount. Must be a positive number' });
        }
        
        // Round to 2 decimal places for currency and ensure minimum amount
        const roundedAmount = Math.round(paymentAmount * 100) / 100;
        if (roundedAmount < 0.01) {
            return res.status(400).json({ message: 'Amount must be at least 0.01' });
        }

        // Validate credit card belongs to user
        const [cardRows] = await db.execute(
            'SELECT credit_card_id FROM credit_cards WHERE credit_card_id = ? AND user_id = ?',
            [credit_card_id, user_id]
        );
        if (cardRows.length === 0) {
            return res.status(404).json({ message: 'Credit card not found or does not belong to you' });
        }

        // Validate billing address belongs to user
        const [addressRows] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE billing_address_id = ? AND user_id = ?',
            [billing_address_id, user_id]
        );
        if (addressRows.length === 0) {
            return res.status(404).json({ message: 'Billing address not found or does not belong to you' });
        }

        if (use_loyalty_discount && promo_code) {
            return res.status(400).json({
                message: 'Cannot use both promo code and loyalty discount. Please choose one.'
            });
        }

        // If booking_id is provided, validate booking exists, belongs to user, and is in PENDING status
        let salon_id = null;
        let loyaltyEligible = false;
        let loyaltyDiscountPercentage = null;
        let rewardId = null;
        let promoEligible = false;
        let promoDiscountPercentage = null;
        let userPromoId = null;
        let promoCodeUsed = null;

        if (booking_id) {
            const [bookingRows] = await db.execute(
                'SELECT booking_id, status, customer_user_id, salon_id FROM bookings WHERE booking_id = ?',
                [booking_id]
            );
            
            if (bookingRows.length === 0) {
                return res.status(404).json({ message: 'Booking not found' });
            }
            
            if (bookingRows[0].customer_user_id !== user_id) {
                return res.status(403).json({ message: 'Booking does not belong to you' });
            }
            
            if (bookingRows[0].status !== 'PENDING') {
                return res.status(400).json({ 
                    message: `Cannot process payment for booking with status '${bookingRows[0].status}'. Booking must be in PENDING status.` 
                });
            }

            salon_id = bookingRows[0].salon_id;

            if (use_loyalty_discount) {
                if (!reward_id) {
                    return res.status(400).json({
                        message: 'reward_id is required when use_loyalty_discount is true'
                    });
                }

                const [availableRewards] = await db.execute(
                    `SELECT reward_id, discount_percentage
                     FROM available_rewards
                     WHERE reward_id = ? AND user_id = ? AND salon_id = ? AND active = 1 AND redeemed_at IS NULL`,
                    [reward_id, user_id, salon_id]
                );

                if (availableRewards.length > 0) {
                    loyaltyEligible = true;
                    loyaltyDiscountPercentage = availableRewards[0].discount_percentage;
                    rewardId = availableRewards[0].reward_id;
                } else {
                    return res.status(400).json({
                        message: 'The specified reward is not available to redeem. It may have already been redeemed or does not exist.'
                    });
                }
            }
        }

        if (promo_code) {
            if (!booking_id) {
                return res.status(400).json({
                    message: 'Promo code can only be used with booking_id payments'
                });
            }

            if (!salon_id) {
                return res.status(400).json({
                    message: 'Promo code requires a valid booking'
                });
            }

            const [promoRows] = await db.execute(
                `SELECT user_promo_id, user_id, salon_id, discount_pct, status, expires_at
                 FROM user_promotions
                 WHERE promo_code = ? AND user_id = ? AND salon_id = ? AND status = 'ISSUED'`,
                [promo_code, user_id, salon_id]
            );

            if (promoRows.length === 0) {
                return res.status(400).json({
                    message: 'Invalid promo code. The code may not exist, belong to another user, or is for a different salon.'
                });
            }

            const promo = promoRows[0];
            
            if (promo.expires_at) {
                const expiresAt = DateTime.fromSQL(promo.expires_at, { zone: 'utc' });
                const now = DateTime.utc();
                if (expiresAt < now) {
                    return res.status(400).json({
                        message: 'This promo code has expired.'
                    });
                }
            }

            promoEligible = true;
            promoDiscountPercentage = promo.discount_pct;
            userPromoId = promo.user_promo_id;
            promoCodeUsed = promo_code;
        }

        let finalAmount = roundedAmount;
        if (loyaltyEligible && use_loyalty_discount) {
            finalAmount = Math.round(roundedAmount * (1 - loyaltyDiscountPercentage / 100) * 100) / 100;
            if (finalAmount < 0.01) {
                return res.status(400).json({ message: 'Discounted amount must be at least 0.01' });
            }
        } else if (promoEligible && promo_code) {
            finalAmount = Math.round(roundedAmount * (1 - promoDiscountPercentage / 100) * 100) / 100;
            if (finalAmount < 0.01) {
                return res.status(400).json({ message: 'Discounted amount must be at least 0.01' });
            }
        }

 
        
        await db.query('START TRANSACTION');
        try {
            // Create payment record
            const nowUtc = toMySQLUtc(DateTime.utc());
            const insertPaymentQuery = `
                INSERT INTO payments 
                (credit_card_id, billing_address_id, amount, booking_id, order_id, reward_id, user_promo_id, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?)
            `;

            const [paymentResults] = await db.execute(insertPaymentQuery, [
                credit_card_id,
                billing_address_id,
                finalAmount,//rounded amount is now final amount
                booking_id || null,
                order_id || null,
                (use_loyalty_discount && loyaltyEligible && rewardId) ? rewardId : null,
                (promoEligible && userPromoId) ? userPromoId : null,
                nowUtc,
                nowUtc
            ]);

            if (paymentResults.affectedRows === 0) {
                await db.query('ROLLBACK');
                if (booking_id) {
                    try {
                        await db.execute(
                            `DELETE FROM bookings 
                             WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'`,
                            [booking_id, user_id]
                        );
                    } catch (_) {}
                }
                return res.status(500).json({ message: 'Failed to process payment' });
            }

            if (booking_id && use_loyalty_discount && loyaltyEligible && rewardId) {
                // Get reward details before redeeming for notification
                const [rewardDetails] = await db.execute(
                    `SELECT discount_percentage, note, s.name as salon_name
                     FROM available_rewards ar
                     JOIN salons s ON ar.salon_id = s.salon_id
                     WHERE ar.reward_id = ? AND ar.user_id = ? AND ar.salon_id = ?`,
                    [rewardId, user_id, salon_id]
                );
                
                const redeemedAt = toMySQLUtc(DateTime.utc());
                const [updateRewardResult] = await db.execute(
                    `UPDATE available_rewards
                     SET redeemed_at = ?, active = 0, updated_at = ?
                     WHERE reward_id = ? AND user_id = ? AND salon_id = ? AND active = 1 AND redeemed_at IS NULL`,
                    [redeemedAt, nowUtc, rewardId, user_id, salon_id]
                );

                if (updateRewardResult.affectedRows !== 1) {
                    await db.query('ROLLBACK');
                    if (booking_id) {
                        try {
                            await db.execute(
                                `DELETE FROM bookings 
                                 WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'`,
                                [booking_id, user_id]
                            );
                        } catch (_) {}
                    }
                    return res.status(400).json({ 
                        message: 'Cannot redeem loyalty discount: reward no longer available' 
                    });
                }
                
                if (rewardDetails.length > 0) {
                    const reward = rewardDetails[0];
                    const [userInfo] = await db.execute(
                        'SELECT email FROM users WHERE user_id = ?',
                        [user_id]
                    );
                    
                    if (userInfo.length > 0) {
                        try {
                            const rewardMessage = reward.note 
                                ? `You have successfully redeemed your ${reward.discount_percentage}% loyalty reward at ${reward.salon_name}. ${reward.note}`
                                : `You have successfully redeemed your ${reward.discount_percentage}% loyalty reward at ${reward.salon_name}. Thank you for your loyalty!`;
                            
                            await createNotification(db, {
                                user_id: user_id,
                                salon_id: salon_id,
                                payment_id: paymentResults.insertId,
                                email: userInfo[0].email,
                                type_code: 'LOYALTY_REWARD_REDEEMED',
                                message: rewardMessage,
                                sender_email: 'SYSTEM'
                            });
                        } catch (notifError) {
                            console.error('Failed to send loyalty reward redeemed notification:', notifError);
                        }
                    }
                }
            }

            // Redeem promo code if used
            if (promoEligible && userPromoId) {
                const redeemedAt = toMySQLUtc(DateTime.utc());
                const [updatePromoResult] = await db.execute(
                    `UPDATE user_promotions
                     SET status = 'REDEEMED', redeemed_at = ?
                     WHERE user_promo_id = ? AND user_id = ? AND salon_id = ? AND status = 'ISSUED'`,
                    [redeemedAt, userPromoId, user_id, salon_id]
                );

                if (updatePromoResult.affectedRows !== 1) {
                    await db.query('ROLLBACK');
                    if (booking_id) {
                        try {
                            await db.execute(
                                `DELETE FROM bookings 
                                 WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'`,
                                [booking_id, user_id]
                            );
                        } catch (_) {}
                    }
                    return res.status(400).json({ 
                        message: 'Cannot redeem promo code: code no longer available or already redeemed' 
                    });
                }

                // Create notification for promo code usage
                const [salonInfo] = await db.execute(
                    'SELECT name FROM salons WHERE salon_id = ?',
                    [salon_id]
                );
                const salonName = salonInfo.length > 0 ? salonInfo[0].name : 'the salon';

                // Get booking information
                let bookingInfo = null;
                let employeeId = null;
                let stylistName = null;
                
                if (booking_id) {
                    // Get salon timezone for proper date formatting
                    const [salonTimezoneResult] = await db.execute(
                        'SELECT timezone FROM salons WHERE salon_id = ?',
                        [salon_id]
                    );
                    const salonTimezone = salonTimezoneResult.length > 0 ? salonTimezoneResult[0].timezone : 'America/New_York';
                    
                    const [bookingDetails] = await db.execute(
                        `SELECT DATE_FORMAT(scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
                                DATE_FORMAT(scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end
                         FROM bookings 
                         WHERE booking_id = ?`,
                        [booking_id]
                    );
                    
                    if (bookingDetails.length > 0) {
                        // Parse SQL format datetime as UTC
                        const scheduledStart = DateTime.fromSQL(bookingDetails[0].scheduled_start, { zone: 'utc' });
                        const scheduledEnd = DateTime.fromSQL(bookingDetails[0].scheduled_end, { zone: 'utc' });
                        
                        if (scheduledStart.isValid && scheduledEnd.isValid) {
                            const bookingStartLocal = scheduledStart.setZone(salonTimezone);
                            const bookingEndLocal = scheduledEnd.setZone(salonTimezone);
                            
                            const appointmentDate = bookingStartLocal.toFormat('EEEE, MMMM d, yyyy');
                            const appointmentTime = bookingStartLocal.toFormat('h:mm a');
                            const appointmentEndTime = bookingEndLocal.toFormat('h:mm a');
                            
                            bookingInfo = {
                                scheduled_start: `Date: ${appointmentDate}\nTime: ${appointmentTime} - ${appointmentEndTime}`
                            };
                        }
                    }

                    // Get stylist information from booking_services
                    const [stylistInfo] = await db.execute(
                        `SELECT DISTINCT e.employee_id, u.full_name
                         FROM booking_services bs
                         JOIN employees e ON bs.employee_id = e.employee_id
                         JOIN users u ON e.user_id = u.user_id
                         WHERE bs.booking_id = ?
                         LIMIT 1`,
                        [booking_id]
                    );

                    if (stylistInfo.length > 0) {
                        employeeId = stylistInfo[0].employee_id;
                        stylistName = stylistInfo[0].full_name;
                    }
                }

                // Get user email for notification
                const [userInfo] = await db.execute(
                    'SELECT email FROM users WHERE user_id = ?',
                    [user_id]
                );
                const userEmail = userInfo.length > 0 ? userInfo[0].email : null;

                let notificationMessage = `You successfully used promo code ${promoCodeUsed} for ${promoDiscountPercentage}% off your payment at ${salonName}.`;
                
                if (bookingInfo) {
                    notificationMessage += `\n\nYour appointment is scheduled for:\n${bookingInfo.scheduled_start}`;
                }
                
                if (stylistName) {
                    notificationMessage += `\n\nYour stylist is ${stylistName}.`;
                }

                await db.execute(
                    `INSERT INTO notifications_inbox
                        (user_id, salon_id, booking_id, employee_id, payment_id, type_code, promo_code, user_promo_id, status, message, sender_email, email, created_at)
                     VALUES (?, ?, ?, ?, ?, 'PROMO_REDEEMED', ?, ?, 'UNREAD', ?, 'SYSTEM', ?, ?)`,
                    [
                        user_id,
                        salon_id,
                        booking_id || null,
                        employeeId,
                        paymentResults.insertId,
                        promoCodeUsed,
                        userPromoId,
                        notificationMessage,
                        userEmail,
                        nowUtc
                    ]
                );
            }

            // If booking_id was provided, update booking status from PENDING to SCHEDULED
            if (booking_id) {
                const [updateBookingResult] = await db.execute(
                    `UPDATE bookings 
                     SET status = 'SCHEDULED', updated_at = ?
                     WHERE booking_id = ? AND status = 'PENDING'`,
                    [nowUtc, booking_id]
                );

                if (updateBookingResult.affectedRows === 0) {
                    await db.query('ROLLBACK');
                    try {
                        await db.execute(
                            `DELETE FROM bookings 
                             WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'`,
                            [booking_id, user_id]
                        );
                    } catch (_) {}
                    return res.status(500).json({ 
                        message: 'Payment created but failed to update booking status' 
                    });
                }

                const [bookingDetails] = await db.execute(
                  `SELECT b.salon_id, b.customer_user_id, 
                   DATE_FORMAT(b.scheduled_start, '%Y-%m-%d %H:%i:%s') AS scheduled_start,
                   DATE_FORMAT(b.scheduled_end, '%Y-%m-%d %H:%i:%s') AS scheduled_end,
                   s.timezone, s.name as salon_name
                   FROM bookings b
                   JOIN salons s ON b.salon_id = s.salon_id
                   WHERE b.booking_id = ?`,
                  [booking_id]
                );

                if (bookingDetails.length > 0) {
                  const bookingDetail = bookingDetails[0];
                  const salonTimezone = bookingDetail.timezone || 'America/New_York';
                  
                  const bookingStart = DateTime.fromSQL(bookingDetail.scheduled_start, { zone: 'utc' });
                  const bookingStartLocal = bookingStart.setZone(salonTimezone);
                  const bookingDateStr = bookingStartLocal.toFormat('EEE, MMM d, yyyy h:mm a');
                  
                  // Get customer and stylist information
                  const [customerInfo] = await db.execute(
                    'SELECT user_id, email, full_name FROM users WHERE user_id = ?',
                    [bookingDetail.customer_user_id]
                  );

                  // Get services and stylist information
                  const [bookingServices] = await db.execute(
                    `SELECT bs.employee_id, bs.service_id, s.name as service_name
                     FROM booking_services bs
                     JOIN services s ON bs.service_id = s.service_id
                     WHERE bs.booking_id = ?`,
                    [booking_id]
                  );

                  const employeeIds = [...new Set(bookingServices.map(bs => bs.employee_id))];
                  const servicesList = bookingServices.map(bs => bs.service_name).join(', ');

                  const [stylistsInfo] = await db.execute(
                    `SELECT DISTINCT e.employee_id, e.user_id, u.email, u.full_name 
                     FROM employees e 
                     JOIN users u ON e.user_id = u.user_id 
                     WHERE e.employee_id IN (${employeeIds.map(() => '?').join(',')})`,
                    employeeIds
                  );

                  if (customerInfo.length > 0 && stylistsInfo.length > 0) {
                    try {
                      await createNotification(db, {
                        user_id: customerInfo[0].user_id,
                        salon_id: bookingDetail.salon_id,
                        employee_id: stylistsInfo[0].employee_id,
                        booking_id: booking_id,
                        payment_id: paymentResults.insertId,
                        email: customerInfo[0].email,
                        type_code: 'BOOKING_CREATED',
                        message: `Your appointment has been booked with ${stylistsInfo[0].full_name} at ${bookingDetail.salon_name} on ${bookingDateStr}. Services: ${servicesList}.`,
                        sender_email: stylistsInfo[0].email || 'SYSTEM'
                      });
                    } catch (notifError) {
                      console.error('Failed to send booking created notification to customer:', notifError);
                    }
                  }

                  for (const stylist of stylistsInfo) {
                    try {
                      await createNotification(db, {
                        user_id: stylist.user_id,
                        salon_id: bookingDetail.salon_id,
                        employee_id: stylist.employee_id,
                        booking_id: booking_id,
                        payment_id: paymentResults.insertId,
                        email: stylist.email,
                        type_code: 'BOOKING_CREATED',
                        message: `New appointment booked: ${customerInfo[0]?.full_name || 'Customer'} on ${bookingDateStr}. Services: ${servicesList}.`,
                        sender_email: customerInfo[0]?.email || 'SYSTEM'
                      });
                    } catch (notifError) {
                      console.error('Failed to send booking created notification to stylist:', notifError);
                    }
                  }
                }
            }

            await db.query('COMMIT');

            res.status(200).json({
                message: 'Payment processed successfully',
                data: {
                    payment_id: paymentResults.insertId,
                    amount: finalAmount,
                    original_amount: (loyaltyEligible && use_loyalty_discount) || (promoEligible && promo_code) ? roundedAmount : undefined,
                    discount_applied: (loyaltyEligible && use_loyalty_discount) || (promoEligible && promo_code),
                    discount_type: loyaltyEligible && use_loyalty_discount ? 'loyalty' : (promoEligible && promo_code ? 'promo_code' : undefined),
                    ...(promoEligible && promo_code ? { promo_code: promoCodeUsed, promo_discount_pct: promoDiscountPercentage } : {}),
                    ...(booking_id ? { booking_status_updated: true } : {})
                }
            });

        } catch (transactionError) {
            console.error('processPayment transaction error:', transactionError);
            await db.query('ROLLBACK');
            if (booking_id) {
                try {
                    await db.execute(
                        `DELETE FROM bookings 
                         WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'`,
                        [booking_id, user_id]
                    );
                } catch (cleanupError) {
                    console.error('processPayment cleanup error:', cleanupError);
                }
            }
            throw transactionError;
        }

    } catch (error) {
        console.error('processPayment error:', error);
        // Best-effort cleanup of pending booking on any error path
        try {
            const user_id = req.user?.user_id;
            const { booking_id } = req.body || {};
            if (booking_id && user_id) {
                await connection
                    .promise()
                    .execute(
                        `DELETE FROM bookings 
                         WHERE booking_id = ? AND customer_user_id = ? AND status = 'PENDING'`,
                        [booking_id, user_id]
                    );
            }
        } catch (_) {}
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

// PLR 1.1 Save a credit card permanently for future use
exports.saveCreditCard = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { card_number, cvc, exp_month, exp_year, billing_address_id } = req.body;

        // Validate required fields
        if (!card_number || !cvc || !exp_month || !exp_year || !billing_address_id) {
            return res.status(400).json({ message: 'Required fields: card_number, cvc, exp_month, exp_year, billing_address_id' });
        }

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Validate billing address belongs to user
        const [addressRows] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE billing_address_id = ? AND user_id = ?',
            [billing_address_id, user_id]
        );
        if (addressRows.length === 0) {
            return res.status(404).json({ message: 'Billing address not found' });
        }

        // Validate credit card number using Luhn algorithm, format validation, and brand detection
        const cardValidation = paymentSecurity.validateCardNumber(card_number);
        if (!cardValidation.valid) {
            return res.status(400).json({ message: cardValidation.error });
        }

        // Use auto-detected brand from validation
        const detectedBrand = cardValidation.brand;

        // Clean card number for comparison
        const cleanedCardNumber = card_number.toString().replace(/\s/g, '');
        const last4 = cleanedCardNumber.slice(-4);
        const pan_length = cleanedCardNumber.length;

        // Generate card hash for duplicate checking
        const card_hash = paymentSecurity.generateCardHash(card_number, user_id);

        // Check for any existing card (temporary or permanent) when saving as permanent
        const [existingCard] = await db.execute(
            'SELECT credit_card_id, is_temporary FROM credit_cards WHERE user_id = ? AND card_hash = ?',
            [user_id, card_hash]
        );

        if (existingCard.length > 0) {
            // If it's a temporary card, convert it to permanent
            if (existingCard[0].is_temporary) {
                const nowUtc = toMySQLUtc(DateTime.utc());
                await db.execute(
                    'UPDATE credit_cards SET is_temporary = FALSE, updated_at = ? WHERE credit_card_id = ?',
                    [nowUtc, existingCard[0].credit_card_id]
                );
                
                // Return the existing card (now converted to permanent)
                const [updatedCard] = await db.execute(
                    `SELECT credit_card_id, brand, last4, pan_length, exp_month, exp_year
                     FROM credit_cards WHERE credit_card_id = ?`,
                    [existingCard[0].credit_card_id]
                );
                
                const [userInfo] = await db.execute(
                    'SELECT email, full_name FROM users WHERE user_id = ?',
                    [user_id]
                );
                
                if (userInfo.length > 0) {
                    try {
                        await createNotification(db, {
                            user_id: user_id,
                            email: userInfo[0].email,
                            type_code: 'PAYMENT_METHOD_SAVED',
                            message: `Your ${updatedCard[0].brand} card ending in ${updatedCard[0].last4} has been saved successfully. You can use this card for future payments.`,
                            sender_email: 'SYSTEM'
                        });
                    } catch (notifError) {
                        console.error('Failed to send payment method saved notification:', notifError);
                    }
                }
                
                return res.status(200).json({
                    message: 'Credit card saved successfully',
                    data: {
                        credit_card_id: updatedCard[0].credit_card_id,
                        brand: updatedCard[0].brand,
                        last4: updatedCard[0].last4,
                        exp_month: updatedCard[0].exp_month,
                        exp_year: updatedCard[0].exp_year,
                        is_temporary: false
                    }
                });
            } else {
                // It's already a permanent card
                return res.status(400).json({ 
                    message: 'This credit card is already saved' 
                });
            }
        }

        // Validate expiration
        const expMonth = parseInt(exp_month);
        const expYear = parseInt(exp_year);
        if (expMonth < 1 || expMonth > 12) {
            return res.status(400).json({ message: 'Invalid expiration month' });
        }
        
        // Check if card is expired (expiration date is in the past)
        // Credit cards expire at the end of the expiration month
        const expirationDate = DateTime.utc(expYear, expMonth).endOf('month');
        const now = DateTime.utc();
        
        if (expirationDate < now) {
            return res.status(400).json({ message: 'Credit card has expired' });
        }

        // Generate encrypted card data
        const encrypted_pan = paymentSecurity.encryptPAN(card_number);
        const cvc_hmac = paymentSecurity.createCVCHMAC(cvc);

        // Insert credit card as permanent (is_temporary = FALSE)
        const nowUtc = toMySQLUtc(DateTime.utc());
        const insertCardQuery = `
            INSERT INTO credit_cards 
            (user_id, brand, last4, exp_month, exp_year, encrypted_pan, pan_length, cvc_hmac, card_hash, is_temporary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?)
        `;

        const [results] = await db.execute(insertCardQuery, [
            user_id,
            detectedBrand,
            last4,
            expMonth,
            expYear,
            encrypted_pan,
            pan_length,
            cvc_hmac,
            card_hash,
            nowUtc,
            nowUtc
        ]);

        if (results.affectedRows === 0) {
            return res.status(500).json({ message: 'Failed to save credit card' });
        }

        // Get user email for notification
        const [userInfo] = await db.execute(
            'SELECT email, full_name FROM users WHERE user_id = ?',
            [user_id]
        );
        
        if (userInfo.length > 0) {
            try {
                await createNotification(db, {
                    user_id: user_id,
                    email: userInfo[0].email,
                    type_code: 'PAYMENT_METHOD_SAVED',
                    message: `Your ${detectedBrand} card ending in ${last4} has been saved successfully. You can use this card for future payments.`,
                    sender_email: 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send payment method saved notification:', notifError);
            }
        }

        res.status(200).json({
            message: 'Credit card saved successfully',
            data: {
                credit_card_id: results.insertId,
                brand: detectedBrand,
                last4,
                exp_month: expMonth,
                exp_year: expYear,
                is_temporary: false
            }
        });

    } catch (error) {
        console.error('saveCreditCard error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

// PLR 1.1 Save a temporary credit card for immediate payment use
exports.saveTempCreditCard = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { card_number, cvc, exp_month, exp_year, billing_address_id } = req.body;

        // Validate required fields
        if (!card_number || !cvc || !exp_month || !exp_year || !billing_address_id) {
            return res.status(400).json({ message: 'Required fields: card_number, cvc, exp_month, exp_year, billing_address_id' });
        }

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Validate billing address belongs to user
        const [addressRows] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE billing_address_id = ? AND user_id = ?',
            [billing_address_id, user_id]
        );
        if (addressRows.length === 0) {
            return res.status(404).json({ message: 'Billing address not found' });
        }

        // Validate credit card number using Luhn algorithm, format validation, and brand detection
        const cardValidation = paymentSecurity.validateCardNumber(card_number);
        if (!cardValidation.valid) {
            return res.status(400).json({ message: cardValidation.error });
        }

        // Use auto-detected brand from validation
        const detectedBrand = cardValidation.brand;

        // Clean card number for comparison
        const cleanedCardNumber = card_number.toString().replace(/\s/g, '');
        const last4 = cleanedCardNumber.slice(-4);
        const pan_length = cleanedCardNumber.length;

        // Generate card hash for duplicate checking
        const card_hash = paymentSecurity.generateCardHash(card_number, user_id);

        // Check if this specific card is already saved as a permanent card
        const [existingPermanentCard] = await db.execute(
            'SELECT credit_card_id FROM credit_cards WHERE user_id = ? AND card_hash = ? AND (is_temporary IS NULL OR is_temporary = FALSE)',
            [user_id, card_hash]
        );
        
        if (existingPermanentCard.length > 0) {
            return res.status(400).json({ 
                message: 'You already have a saved credit card. Please use your saved card instead of using a temporary one.' 
            });
        }

        // Check if a temporary card with the same number already exists
        const [existingTempCard] = await db.execute(
            'SELECT credit_card_id FROM credit_cards WHERE user_id = ? AND card_hash = ? AND is_temporary = TRUE',
            [user_id, card_hash]
        );

        if (existingTempCard.length > 0) {
            return res.status(200).json({
                message: 'Credit card ready for payment',
                data: {
                    credit_card_id: existingTempCard[0].credit_card_id,
                    is_temporary: true
                }
            });
        }

        // Validate expiration
        const expMonth = parseInt(exp_month);
        const expYear = parseInt(exp_year);
        if (expMonth < 1 || expMonth > 12) {
            return res.status(400).json({ message: 'Invalid expiration month' });
        }
        
        // Check if card is expired (expiration date is in the past)
        // Credit cards expire at the end of the expiration month
        const expirationDate = DateTime.utc(expYear, expMonth).endOf('month');
        const now = DateTime.utc();
        
        if (expirationDate < now) {
            return res.status(400).json({ message: 'Credit card has expired' });
        }

        // Generate encrypted card data
        const encrypted_pan = paymentSecurity.encryptPAN(card_number);
        const cvc_hmac = paymentSecurity.createCVCHMAC(cvc);

        // Insert credit card as temporary (is_temporary = TRUE)
        const nowUtc = toMySQLUtc(DateTime.utc());
        const insertCardQuery = `
            INSERT INTO credit_cards 
            (user_id, brand, last4, exp_month, exp_year, encrypted_pan, pan_length, cvc_hmac, card_hash, is_temporary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)
        `;

        const [results] = await db.execute(insertCardQuery, [
            user_id,
            detectedBrand,
            last4,
            expMonth,
            expYear,
            encrypted_pan,
            pan_length,
            cvc_hmac,
            card_hash,
            nowUtc,
            nowUtc
        ]);

        if (results.affectedRows === 0) {
            return res.status(500).json({ message: 'Failed to use temporary credit card' });
        }

        res.status(200).json({
            message: 'Credit card ready for payment',
            data: {
                credit_card_id: results.insertId,
                brand: detectedBrand,
                last4,
                exp_month: expMonth,
                exp_year: expYear,
                is_temporary: true
            }
        });

    } catch (error) {
        console.error('saveTempCreditCard error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

//PLR 1.1 Get saved credit cards
exports.getCreditCards = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const [cards] = await db.execute(
            `SELECT credit_card_id, brand, last4, pan_length, exp_month, exp_year
             FROM credit_cards 
             WHERE user_id = ? AND (is_temporary IS NULL OR is_temporary = FALSE)
             ORDER BY created_at DESC`,
            [user_id]
        );

        // Generate masked_pan for each card from last4 and pan_length
        const cardsWithMasked = cards.map(card => ({
            ...card,
            masked_pan: paymentSecurity.generateMaskedPAN(card.last4, card.pan_length)
        }));

        res.status(200).json({
            credit_cards: cardsWithMasked
        });

    } catch (error) {
        console.error('getCreditCards error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

//PLR 1.1 Delete credit card
exports.deleteCreditCard = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { credit_card_id } = req.params;

        if (!credit_card_id) {
            return res.status(400).json({ message: 'Credit card ID is required' });
        }

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Verify credit card belongs to user
        const [cardRows] = await db.execute(
            'SELECT credit_card_id FROM credit_cards WHERE credit_card_id = ? AND user_id = ?',
            [credit_card_id, user_id]
        );
        if (cardRows.length === 0) {
            return res.status(404).json({ message: 'Credit card not found' });
        }

        const deleteCardQuery = `
            DELETE FROM credit_cards 
            WHERE credit_card_id = ? AND user_id = ?
        `;

        const [results] = await db.execute(deleteCardQuery, [credit_card_id, user_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Credit card not found' });
        }

        res.status(200).json({
            message: 'Credit card deleted successfully'
        });

    } catch (error) {
        console.error('deleteCreditCard error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

//PLR 1.1 Create a billing address
exports.createBillingAddress = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { full_name, address_line1, address_line2, city, state, postal_code, country, phone } = req.body;

        // Validate required fields
        if (!full_name || !address_line1 || !city || !state || !postal_code || !country) {
            return res.status(400).json({ message: 'Required fields: full_name, address_line1, city, state, postal_code, country' });
        }

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!/^[a-zA-Z\s'-]+$/.test(city)) {
            return res.status(400).json({ message: 'City field must only contain letters, spaces, hyphens, and apostrophes' });
        }

        if (!/^\d+$/.test(postal_code)) {
            return res.status(400).json({ message: 'Postal code must only contain numbers' });
        }

        // Check if user already has a billing address
        const [existingAddress] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE user_id = ?',
            [user_id]
        );

        if (existingAddress.length > 0) {
            return res.status(400).json({ 
                message: 'Billing address already exists. Use update endpoint to modify it.' 
            });
        }

        // Create new billing address
        const insertAddressQuery = `
            INSERT INTO billing_addresses 
            (user_id, full_name, address_line1, address_line2, city, state, postal_code, country, phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [results] = await db.execute(insertAddressQuery, [
            user_id,
            full_name,
            address_line1,
            address_line2 || null,
            city,
            state,
            postal_code,
            country,
            phone || null
        ]);

        if (results.affectedRows === 0) {
            return res.status(500).json({ message: 'Failed to save billing address' });
        }
        
        return res.status(200).json({
            message: 'Billing address created successfully'
        });

    } catch (error) {
        console.error('createBillingAddress error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

// PLR 1.1Get billing address 
exports.getBillingAddress = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const [addresses] = await db.execute(
            `SELECT billing_address_id, full_name, address_line1, address_line2, city, state, postal_code, country, phone
             FROM billing_addresses 
             WHERE user_id = ?
             LIMIT 1`,
            [user_id]
        );

        if (addresses.length === 0) {
            return res.status(404).json({
                message: 'Billing address not found'
            });
        }

        res.status(200).json({
            billing_address: addresses[0]
        });

    } catch (error) {
        console.error('getBillingAddresses error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

//PLR 1.1 Update billing address
exports.updateBillingAddress = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Check if billing address exists for user
        const [addressRows] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE user_id = ?',
            [user_id]
        );
        if (addressRows.length === 0) {
            return res.status(404).json({ message: 'Billing address not found. Please create one first.' });
        }

        if (req.body.city !== undefined) {
            if (!/^[a-zA-Z\s'-]+$/.test(req.body.city)) {
                return res.status(400).json({ message: 'City field must only contain letters, spaces, hyphens, and apostrophes' });
            }
        }

        if (req.body.postal_code !== undefined) {
            if (!/^\d+$/.test(req.body.postal_code)) {
                return res.status(400).json({ message: 'Postal code must only contain numbers' });
            }
        }

        // Build dynamic update query based on provided fields
        const allowedFields = ['full_name', 'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country', 'phone'];
        const updateFields = [];
        const updateValues = [];

        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                updateValues.push(req.body[field]);
            }
        });

        // Check if at least one field is being updated
        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'At least one field must be provided to update' });
        }

        const nowUtc = toMySQLUtc(DateTime.utc());
        updateFields.push('updated_at = ?');
        updateValues.push(nowUtc);
        updateValues.push(user_id);

        const updateAddressQuery = `
            UPDATE billing_addresses 
            SET ${updateFields.join(', ')}
            WHERE user_id = ?
        `;

        const [results] = await db.execute(updateAddressQuery, updateValues);

        if (results.affectedRows === 0) {
            return res.status(500).json({ message: 'Failed to update billing address' });
        }

        const [updatedAddress] = await db.execute(
            `SELECT billing_address_id, full_name, address_line1, address_line2, city, state, postal_code, country, phone
             FROM billing_addresses 
             WHERE user_id = ?`,
            [user_id]
        );

        res.status(200).json({
            message: 'Billing address updated successfully',
            data: updatedAddress[0]
        });

    } catch (error) {
        console.error('updateBillingAddress error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

//PLR 1.1 Delete billing address
exports.deleteBillingAddress = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;

        if (!user_id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Check if billing address exists for user
        const [addressRows] = await db.execute(
            'SELECT billing_address_id FROM billing_addresses WHERE user_id = ?',
            [user_id]
        );
        if (addressRows.length === 0) {
            return res.status(404).json({ message: 'Billing address not found' });
        }

        const deleteAddressQuery = `
            DELETE FROM billing_addresses 
            WHERE user_id = ?
        `;

        const [results] = await db.execute(deleteAddressQuery, [user_id]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Billing address not found' });
        }

        res.status(200).json({
            message: 'Billing address deleted successfully'
        });

    } catch (error) {
        console.error('deleteBillingAddress error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

