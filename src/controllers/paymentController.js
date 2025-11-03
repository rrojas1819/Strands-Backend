require('dotenv').config();
const connection = require('../config/databaseConnection');
const paymentSecurity = require('../utils/paymentSecurity');

// Process a payment online
exports.processPayment = async (req, res) => {
    const db = connection.promise();

    try {
        const user_id = req.user?.user_id;
        const { 
            credit_card_id,
            billing_address_id,
            amount,
            order_id,
            booking_id
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

        // If booking_id is provided, validate booking exists, belongs to user, and is in PENDING status
        if (booking_id) {
            const [bookingRows] = await db.execute(
                'SELECT booking_id, status, customer_user_id FROM bookings WHERE booking_id = ?',
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
        }

 
        
        await db.query('START TRANSACTION');
        try {
            // Create payment record
            const insertPaymentQuery = `
                INSERT INTO payments 
                (credit_card_id, billing_address_id, amount, booking_id, order_id, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', NOW(), NOW())
            `;

            const [paymentResults] = await db.execute(insertPaymentQuery, [
                credit_card_id,
                billing_address_id,
                roundedAmount,
                booking_id || null,
                order_id || null
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

            // If booking_id was provided, update booking status from PENDING to SCHEDULED
            if (booking_id) {
                const [updateBookingResult] = await db.execute(
                    `UPDATE bookings 
                     SET status = 'SCHEDULED', updated_at = NOW()
                     WHERE booking_id = ? AND status = 'PENDING'`,
                    [booking_id]
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
            }

            await db.query('COMMIT');

            res.status(200).json({
                message: 'Payment processed successfully',
                data: {
                    payment_id: paymentResults.insertId,
                    amount: roundedAmount,
                    ...(booking_id ? { booking_status_updated: true } : {})
                }
            });

        } catch (transactionError) {
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

// Save a credit card permanently for future use
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
                await db.execute(
                    'UPDATE credit_cards SET is_temporary = FALSE, updated_at = NOW() WHERE credit_card_id = ?',
                    [existingCard[0].credit_card_id]
                );
                
                // Return the existing card (now converted to permanent)
                const [updatedCard] = await db.execute(
                    `SELECT credit_card_id, brand, last4, pan_length, exp_month, exp_year
                     FROM credit_cards WHERE credit_card_id = ?`,
                    [existingCard[0].credit_card_id]
                );
                
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
        if (expYear < new Date().getFullYear()) {
            return res.status(400).json({ message: 'Invalid expiration year' });
        }

        // Generate encrypted card data
        const encrypted_pan = paymentSecurity.encryptPAN(card_number);
        const cvc_hmac = paymentSecurity.createCVCHMAC(cvc);

        // Insert credit card as permanent (is_temporary = FALSE)
        const insertCardQuery = `
            INSERT INTO credit_cards 
            (user_id, brand, last4, exp_month, exp_year, encrypted_pan, pan_length, cvc_hmac, card_hash, is_temporary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, NOW(), NOW())
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
            card_hash
        ]);

        if (results.affectedRows === 0) {
            return res.status(500).json({ message: 'Failed to save credit card' });
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

// Save a temporary credit card for immediate payment use
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

        // Check if user already has a saved (permanent) card
        const [savedCards] = await db.execute(
            'SELECT credit_card_id FROM credit_cards WHERE user_id = ? AND (is_temporary IS NULL OR is_temporary = FALSE)',
            [user_id]
        );
        
        if (savedCards.length > 0) {
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
                message: 'Credit card ready for payment'
            });
        }

        // Validate expiration
        const expMonth = parseInt(exp_month);
        const expYear = parseInt(exp_year);
        if (expMonth < 1 || expMonth > 12) {
            return res.status(400).json({ message: 'Invalid expiration month' });
        }
        if (expYear < new Date().getFullYear()) {
            return res.status(400).json({ message: 'Invalid expiration year' });
        }

        // Generate encrypted card data
        const encrypted_pan = paymentSecurity.encryptPAN(card_number);
        const cvc_hmac = paymentSecurity.createCVCHMAC(cvc);

        // Insert credit card as temporary (is_temporary = TRUE)
        const insertCardQuery = `
            INSERT INTO credit_cards 
            (user_id, brand, last4, exp_month, exp_year, encrypted_pan, pan_length, cvc_hmac, card_hash, is_temporary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())
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
            card_hash
        ]);

        if (results.affectedRows === 0) {
            return res.status(500).json({ message: 'Failed to use temporary credit card' });
        }

        res.status(200).json({
            message: 'Credit card ready for payment'
        });

    } catch (error) {
        console.error('saveTempCreditCard error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
};

// Get saved credit cards
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

// Delete credit card
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

// Create a billing address
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

// Get billing address 
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

// Update billing address
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

        updateFields.push('updated_at = NOW()');
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

// Delete billing address
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

