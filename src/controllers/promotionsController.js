const connection = require('../config/databaseConnection');
const { DateTime } = require('luxon');
const { toMySQLUtc, formatDateTime } = require('../utils/utilies');
const notificationSecurity = require('../utils/notificationsSecurity');

const PROMO_TYPE_CODE = 'LOYALTY_PROMO';

const generatePromoSegment = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 3; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const generatePromoCode = () => `${generatePromoSegment()}-${generatePromoSegment()}`;

async function ensureSalonOwnership(db, ownerUserId, salonIdParam) {
    if (!ownerUserId) {
        throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    }

    const params = [ownerUserId];
    let query = 'SELECT salon_id, name FROM salons WHERE owner_user_id = ?';

    if (salonIdParam) {
        query += ' AND salon_id = ?';
        params.push(salonIdParam);
    }

    query += ' LIMIT 1';

    const [rows] = await db.execute(query, params);

    if (rows.length === 0) {
        const message = salonIdParam
            ? 'Salon not found for this owner'
            : 'Owner does not have a salon';
        throw Object.assign(new Error(message), { statusCode: 404 });
    }

    return rows[0];
}

async function ensureUniquePromoCode(db, salonId) {
    let attempts = 0;
    while (attempts < 5) {
        const code = generatePromoCode();
        const [existing] = await db.execute(
            'SELECT 1 FROM user_promotions WHERE salon_id = ? AND promo_code = ? LIMIT 1',
            [salonId, code]
        );
        if (existing.length === 0) {
            return code;
        }
        attempts += 1;
    }
    throw new Error('Unable to generate unique promo code');
}

// NC 1.2 - Send promotion to a specific customer
exports.sendPromotionToCustomer = async (req, res) => {
    const db = connection.promise();

    try {
        const ownerUserId = req.user?.user_id;
        const salonIdFromParams = req.params.salonId;
        const { email, description, discount_pct, expires_at } = req.body || {};
        if (!email  || !discount_pct) {
            return res.status(400).json({
                message: 'email, and discount amount are required'
            });
        }
        const discountPctNum = Number(discount_pct);
        if (Number.isNaN(discountPctNum) || discountPctNum <= 0 || discountPctNum > 100) {
            return res.status(400).json({
                message: 'discount_pct must be a number between 0 and 100'
            });
        }

        let expiresAtSql = null;
        if (expires_at) {
            const expires = DateTime.fromISO(expires_at, { zone: 'utc' });
            if (!expires.isValid) {
                return res.status(400).json({ message: 'expires_at must be a valid ISO date string' });
            }
            expiresAtSql = toMySQLUtc(expires);
        }

        const salon = await ensureSalonOwnership(db, ownerUserId, salonIdFromParams);
        const salonId = salon.salon_id;
        const [user] = await db.execute(
            `SELECT count(user_id) as total_bookings, user_id, full_name FROM users 
join bookings on bookings.customer_user_id = users.user_id 
join salons on salons.salon_id = bookings.salon_id
WHERE users.email = ? AND salons.salon_id = ?
GROUP BY users.user_id, users.full_name`,
            [email, salonId]
        );

        if (user.length === 0 || user[0].total_bookings === 0) {
            return res.status(404).json({
                message: 'User not found or has no bookings'
            });
        }

        const [[ownerUser]] = await db.execute(
            'SELECT email FROM users WHERE user_id = ?',
            [ownerUserId]
        );
        const senderEmail = ownerUser?.email || 'no-reply@strands';

        const issuedAt = toMySQLUtc(DateTime.utc());

        await db.beginTransaction();

        try {
            const promoCode = await ensureUniquePromoCode(db, salonId);
            const [promoResult] = await db.execute(
                `INSERT INTO user_promotions
                    (user_id, salon_id, promo_code, description, discount_pct, issued_at, expires_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'ISSUED')`,
                [
                    user[0].user_id,
                    salonId,
                    promoCode,
                    description || '',
                    discountPctNum,
                    issuedAt,
                    expiresAtSql
                ]
            );

            const userPromoId = promoResult.insertId;
            const expiresFragment = expiresAtSql
                ? ` Offer expires on ${DateTime.fromSQL(expiresAtSql, { zone: 'utc' }).toFormat('MMM d, yyyy')}.`
                : '';
            let message =
                `Thanks for being a loyal customer at ${salon.name}! ` +
                `Use promo code ${promoCode} for ${discountPctNum}% off your next visit.${description ? ` ${description}.` : ''} ${expiresFragment}`;

            if (message.length > 400) {
                message = message.slice(0, 397) + '...';
            }

            let encryptedMessage;
            try {
                encryptedMessage = notificationSecurity.encryptMessage(message.trim());
            } catch (encryptError) {
                console.error('Failed to encrypt promotion notification message:', encryptError);
                throw new Error('Failed to encrypt notification message');
            }

            const [notificationResult] = await db.execute(
                `INSERT INTO notifications_inbox
                    (user_id, salon_id, sender_email, email, type_code, promo_code, user_promo_id, status, message, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'UNREAD', ?, ?)`,
                [
                    user[0].user_id,
                    salonId,
                    senderEmail,
                    email,
                    PROMO_TYPE_CODE,
                    promoCode,
                    userPromoId,
                    encryptedMessage,
                    issuedAt
                ]
            );

            await db.commit();

            return res.status(201).json({
                message: 'Promotion sent to customer',
                data: {
                    user_id: user[0].user_id,
                    promo_code: promoCode,
                    user_promo_id: userPromoId,
                    notification_id: notificationResult.insertId
                }
            });
        } catch (txError) {
            console.error('sendPromotionToCustomer transaction error:', txError);
            await db.rollback();
            throw txError;
        }
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('sendPromotionToCustomer error:', error);
        return res.status(statusCode).json({
            message: error.statusCode ? error.message : 'Internal server error'
        });
    }
};

// NC 1.2 - Issue loyal customer promotions
exports.issueLoyalCustomerPromotions = async (req, res) => {
    const db = connection.promise();

    try {
        const ownerUserId = req.user?.user_id;
        const salonIdFromParams = parseInt(req.params.salonId, 10);
        const { description, discount_pct, expires_at } = req.body || {};

        if (!discount_pct) {
            return res.status(400).json({
                message: 'discount_pct is required'
            });
        }

        const discountPctNum = Number(discount_pct);
        if (Number.isNaN(discountPctNum) || discountPctNum <= 0 || discountPctNum > 100) {
            return res.status(400).json({
                message: 'discount_pct must be a number between 0 and 100'
            });
        }

        let expiresAtSql = null;
        if (expires_at) {
            const expires = DateTime.fromISO(expires_at, { zone: 'utc' });
            if (!expires.isValid) {
                return res.status(400).json({ message: 'expires_at must be ISO date string' });
            }
            expiresAtSql = toMySQLUtc(expires);
        }

        const salon = await ensureSalonOwnership(db, ownerUserId, salonIdFromParams);
        const salonId = salon.salon_id;

        const [loyalUsers] = await db.execute(
            `SELECT lm.user_id, u.email, u.full_name
             FROM loyalty_memberships lm
             JOIN users u ON u.user_id = lm.user_id
             WHERE lm.salon_id = ?
               AND COALESCE(lm.total_visits_count, lm.visits_count, 0) >= 5`,
            [salonId]
        );

        if (loyalUsers.length === 0) {
            return res.status(200).json({
                message: 'No loyal customers to send promotions to',
                data: {
                    salon_id: salonId,
                    notifications_created: 0,
                    promotions_created: 0
                }
            });
        }

        const [[ownerUser]] = await db.execute(
            'SELECT email FROM users WHERE user_id = ?',
            [ownerUserId]
        );
        const senderEmail = ownerUser?.email || 'no-reply@strands';

        const issuedAt = toMySQLUtc(DateTime.utc());
        const notificationsCreated = [];

        await db.beginTransaction();

        try {
            for (const user of loyalUsers) {
                const promoCode = await ensureUniquePromoCode(db, salonId);
                const [promoResult] = await db.execute(
                    `INSERT INTO user_promotions
                        (user_id, salon_id, promo_code, description, discount_pct, issued_at, expires_at, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'ISSUED')`,
                    [
                        user.user_id,
                        salonId,
                        promoCode,
                        description || '',
                        discountPctNum,
                        issuedAt,
                        expiresAtSql
                    ]
                );

                const userPromoId = promoResult.insertId;
                const expiresFragment = expiresAtSql
                    ? ` Offer expires on ${DateTime.fromSQL(expiresAtSql, { zone: 'utc' }).toFormat('MMM d, yyyy')}.`
                    : '';
                let message =
                    `Thanks for being a loyal (Gold) guest at ${salon.name}! ` +
                    `Use promo code ${promoCode} for ${discountPctNum}% off your next visit.${description ? ` ${description}.` : ''} ${expiresFragment}`;

                if (message.length > 400) {
                    message = message.slice(0, 397) + '...';
                }

                let encryptedMessage;
                try {
                    encryptedMessage = notificationSecurity.encryptMessage(message.trim());
                } catch (encryptError) {
                    console.error('Failed to encrypt promotion notification message:', encryptError);
                    throw new Error('Failed to encrypt notification message');
                }

                const [notificationResult] = await db.execute(
                    `INSERT INTO notifications_inbox
                        (user_id, salon_id, sender_email, email, type_code, promo_code, user_promo_id, status, message, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'UNREAD', ?, ?)`,
                    [
                        user.user_id,
                        salonId,
                        senderEmail,
                        user.email,
                        PROMO_TYPE_CODE,
                        promoCode,
                        userPromoId,
                        encryptedMessage,
                        issuedAt
                    ]
                );

                notificationsCreated.push({
                    user_id: user.user_id,
                    user_promo_id: userPromoId,
                    notification_id: notificationResult.insertId,
                    promo_code: promoCode
                });
            }

            await db.commit();
        } catch (txError) {
            console.error('issueLoyalCustomerPromotions transaction error:', txError);
            await db.rollback();
            throw txError;
        }

        return res.status(201).json({
            message: 'Promotions issued to loyal customers',
            data: {
                salon_id: salonId,
                promotions_created: notificationsCreated.length,
                notifications_created: notificationsCreated.length,
                recipients: notificationsCreated
            }
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('issueLoyalCustomerPromotions error:', error);
        return res.status(statusCode).json({
            message: error.statusCode ? error.message : 'Internal server error'
        });
    }
};

// NC 1.2 - Get user promotions
exports.getUserPromotions = async (req, res) => {
    const db = connection.promise();

    try {
        const userId = req.user?.user_id;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const [promotions] = await db.execute(
            `SELECT 
                up.user_promo_id,
                up.user_id,
                up.salon_id,
                s.name AS salon_name,
                up.promo_code,
                up.description,
                up.discount_pct,
                up.status,
                DATE_FORMAT(up.issued_at, '%Y-%m-%d %H:%i:%s') AS issued_at,
                DATE_FORMAT(up.expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
                DATE_FORMAT(up.redeemed_at, '%Y-%m-%d %H:%i:%s') AS redeemed_at
             FROM user_promotions up
             JOIN salons s ON s.salon_id = up.salon_id
             WHERE up.user_id = ?
             ORDER BY up.issued_at DESC`,
            [userId]
        );

        const formatted = promotions.map((promo) => ({
            ...promo,
            issued_at: formatDateTime(promo.issued_at),
            expires_at: formatDateTime(promo.expires_at),
            redeemed_at: formatDateTime(promo.redeemed_at)
        }));

        return res.status(200).json({
            message: 'User promotions retrieved',
            data: formatted
        });
    } catch (error) {
        console.error('getUserPromotions error:', error);
        return res.status(500).json({
            message: 'Internal server error'
        });
    }
};

//NC 1.2 - Preview promo code - Get promo info and discounted price without redeeming
exports.previewPromoCode = async (req, res) => {
    const db = connection.promise();

    try {
        const userId = req.user?.user_id;
        const { promo_code, booking_id } = req.body;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!promo_code) {
            return res.status(400).json({
                message: 'promo_code is required'
            });
        }

        if (!booking_id) {
            return res.status(400).json({
                message: 'booking_id is required'
            });
        }

        const [bookingRows] = await db.execute(
            'SELECT booking_id, status, customer_user_id, salon_id FROM bookings WHERE booking_id = ?',
            [booking_id]
        );

        if (bookingRows.length === 0) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        if (bookingRows[0].customer_user_id !== userId) {
            return res.status(403).json({ message: 'Booking does not belong to you' });
        }

        const salon_id = bookingRows[0].salon_id;

        const [promoRows] = await db.execute(
            `SELECT user_promo_id, user_id, salon_id, promo_code, description, discount_pct, status, expires_at,
                    DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i:%s') AS issued_at,
                    DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at_formatted
             FROM user_promotions
             WHERE promo_code = ? AND user_id = ? AND salon_id = ? AND status = 'ISSUED'`,
            [promo_code, userId, salon_id]
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

        const [servicesRows] = await db.execute(
            `SELECT bs.service_id, bs.price, bs.duration_minutes, s.name AS service_name
             FROM booking_services bs
             JOIN services s ON bs.service_id = s.service_id
             WHERE bs.booking_id = ?`,
            [booking_id]
        );

        const originalTotal = servicesRows.reduce((sum, service) => sum + Number(service.price || 0), 0);
        const roundedOriginalTotal = Math.round(originalTotal * 100) / 100;

        const discountPercentage = promo.discount_pct;
        const discountedTotal = Math.round(roundedOriginalTotal * (1 - discountPercentage / 100) * 100) / 100;
        const discountAmount = Math.round((roundedOriginalTotal - discountedTotal) * 100) / 100;

        const promoInfo = {
            user_promo_id: promo.user_promo_id,
            promo_code: promo.promo_code,
            description: promo.description,
            discount_pct: promo.discount_pct,
            status: promo.status,
            issued_at: formatDateTime(promo.issued_at),
            expires_at: promo.expires_at_formatted ? formatDateTime(promo.expires_at_formatted) : null
        };

        return res.status(200).json({
            message: 'Promo code preview retrieved',
            data: {
                promo: promoInfo,
                booking: {
                    booking_id: booking_id,
                    services: servicesRows.map(s => ({
                        service_id: s.service_id,
                        service_name: s.service_name,
                        price: Number(s.price),
                        duration_minutes: s.duration_minutes
                    }))
                },
                pricing: {
                    original_total: roundedOriginalTotal,
                    discount_percentage: discountPercentage,
                    discount_amount: discountAmount,
                    discounted_total: discountedTotal
                }
            }
        });
    } catch (error) {
        console.error('previewPromoCode error:', error);
        return res.status(500).json({
            message: 'Internal server error'
        });
    }
};

