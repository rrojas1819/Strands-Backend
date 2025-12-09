const connection = require('../config/databaseConnection'); //db connection
const { formatDateTime } = require('../utils/utilies');
const { createNotification } = require('./notificationsController');

//helper function to check for pagination offset
function parseLimitOffset(q) {
    let { limit = 20, offset = 0 } = q || {};
    limit = Number.isFinite(+limit) ? Math.max(1, Math.min(+limit, 100)) : 20;
    offset = Number.isFinite(+offset) ? Math.max(0, +offset) : 0;
    return { limit, offset };
}

//helper function to ensure a rating is whole or half star
function isHalfStar(r) {
    if (!Number.isFinite(+r)) return false;
    const x = +r;
    if (x < 0 || x > 5) return false;
    return Math.round(x * 2) === x * 2;
}

//UPH 1.3 user (customer) creates review for salon
exports.createReview = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validate salon
        const { salon_id, rating, message = null } = req.body || {};
        if (!salon_id || isNaN(salon_id)) return res.status(400).json({ message: 'Invalid salon_id' });

        //validate rating
        if (!isHalfStar(rating)) return res.status(400).json({ message: 'rating must be between 0.0 and 5.0 in 0.5 steps' });

        //check if salon exists
        const [[salonExists]] = await db.execute(`SELECT salon_id FROM salons WHERE salon_id = ?`, [Number(salon_id)]);
        if (!salonExists) return res.status(404).json({ message: 'Salon not found' });

        //check if user has been to this salon
        const [[hasVisit]] = await db.execute(`SELECT COUNT(*) AS cnt FROM bookings
                                              WHERE customer_user_id = ? AND salon_id = ? AND status = 'COMPLETED'`, [authUserId, Number(salon_id)]
        );
        if (!hasVisit || !hasVisit.cnt) return res.status(403).json({ message: 'You can review a salon only after a completed visit' });

        //add their review
        try {

            const [ins] = await db.execute(`INSERT INTO reviews (salon_id, user_id, rating, message) VALUES (?, ?, ?, ?)`, [Number(salon_id), authUserId, Number(rating), message]);

            const [[row]] = await db.execute(`SELECT r.review_id, r.salon_id, r.user_id, r.rating, r.message, r.created_at, r.updated_at,
                                             u.full_name AS user_name FROM reviews r JOIN users u ON u.user_id = r.user_id WHERE r.review_id = ?`, [ins.insertId]);
            
            // Get salon owner info for notification
            const [[salonOwner]] = await db.execute(
                `SELECT u.user_id, u.email, u.full_name, s.name as salon_name 
                 FROM salons s 
                 JOIN users u ON s.owner_user_id = u.user_id 
                 WHERE s.salon_id = ?`,
                [Number(salon_id)]
            );
            
            if (salonOwner) {
                try {
                    await createNotification(db, {
                        user_id: salonOwner.user_id,
                        salon_id: Number(salon_id),
                        review_id: ins.insertId,
                        email: salonOwner.email,
                        type_code: 'REVIEW_CREATED',
                        message: `${row.user_name} left a ${rating}-star review for ${salonOwner.salon_name}${message ? ': ' + message.substring(0, 100) + (message.length > 100 ? '...' : '') : '.'}`,
                        sender_email: row.user_name || 'SYSTEM'
                    });
                } catch (notifError) {
                    console.error('Failed to send review created notification:', notifError);
                }
            }
            
            return res.status(201).json({
                message: 'Review created',
                data: {
                    review_id: row.review_id,
                    salon_id: row.salon_id,
                    user: { user_id: row.user_id, name: row.user_name },
                    rating: Number(row.rating),
                    message: row.message,
                    created_at: formatDateTime(row.created_at),
                    updated_at: formatDateTime(row.updated_at)
                }
            });
        } catch (e) {
            //preventing duplicate reviews to a salon
            if (e && e.code === 'ER_DUP_ENTRY') {
                //console.error('createReview error - duplicate entry:', e);
                return res.status(409).json({ message: 'You have already reviewed this salon' });
            }
            console.error('createReview transaction error:', e);
            throw e;
        }
    } catch (err) {
        console.error('createReview error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.3 user (customer) updates their review for salon
exports.updateReview = async (req, res) => {
    const db = connection.promise();

    try {

        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validating review ID
        const review_id = parseInt(req.params.review_id, 10);
        if (!Number.isInteger(review_id) || review_id <= 0) return res.status(400).json({ message: 'Invalid review_id' });

        //validating rating
        const { rating, message } = req.body || {};
        if (rating !== undefined && !isHalfStar(rating)) return res.status(400).json({ message: 'rating must be between 0.0 and 5.0 in 0.5 steps' });

        //ensure rating belongs to the user so they can update
        const [[own]] = await db.execute(`SELECT review_id, salon_id FROM reviews WHERE review_id = ? AND user_id = ?`, [review_id, authUserId]);
        if (!own) return res.status(404).json({ message: 'Review not found' });

        //building SQL query to update review
        const fields = [];
        const params = [];
        if (rating !== undefined) { fields.push('rating = ?'); params.push(Number(rating)); }
        if (message !== undefined) { fields.push('message = ?'); params.push(message); }
        if (!fields.length) return res.status(400).json({ message: 'Nothing to update' });
        params.push(review_id);

        await db.execute(`UPDATE reviews SET ${fields.join(', ')} WHERE review_id = ?`, params);

        const [[row]] = await db.execute(`SELECT r.review_id, r.salon_id, r.user_id, r.rating, r.message, r.created_at, r.updated_at,
                                         u.full_name AS user_name FROM reviews r JOIN users u ON u.user_id = r.user_id WHERE r.review_id = ?`,
            [review_id]
        );

        // Get salon owner info for notification
        const [[salonOwner]] = await db.execute(
            `SELECT u.user_id, u.email, u.full_name, s.name as salon_name 
             FROM salons s 
             JOIN users u ON s.owner_user_id = u.user_id 
             WHERE s.salon_id = ?`,
            [own.salon_id]
        );
        
        if (salonOwner) {
            try {
                await createNotification(db, {
                    user_id: salonOwner.user_id,
                    salon_id: own.salon_id,
                    review_id: review_id,
                    email: salonOwner.email,
                    type_code: 'REVIEW_UPDATED',
                    message: `${row.user_name} updated their review for ${salonOwner.salon_name}.`,
                    sender_email: row.user_name || 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send review updated notification:', notifError);
            }
        }

        return res.status(200).json({
            message: 'Review updated',
            data: {
                review_id: row.review_id,
                salon_id: row.salon_id,
                user: { user_id: row.user_id, name: row.user_name },
                rating: Number(row.rating),
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('updateReview error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.3 user (customer) deletes their review for salon
exports.deleteReview = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validating review ID
        const review_id = parseInt(req.params.review_id, 10);
        if (!Number.isInteger(review_id) || review_id <= 0) return res.status(400).json({ message: 'Invalid review_id' });


        //ensure rating belongs to the user so they can delete
        const [[own]] = await db.execute(`SELECT review_id, salon_id, user_id FROM reviews WHERE review_id = ? AND user_id = ?`,
            [review_id, authUserId]
        );
        if (!own) return res.status(404).json({ message: 'Review not found' });

        // Get salon owner and reviewer info before deleting
        const [[reviewInfo]] = await db.execute(
            `SELECT r.user_id, u.full_name as reviewer_name, s.owner_user_id, s.name as salon_name, owner_u.email as owner_email, owner_u.full_name as owner_name
             FROM reviews r
             JOIN users u ON r.user_id = u.user_id
             JOIN salons s ON r.salon_id = s.salon_id
             JOIN users owner_u ON s.owner_user_id = owner_u.user_id
             WHERE r.review_id = ?`,
            [review_id]
        );

        //deleting the review
        await db.execute(`DELETE FROM reviews WHERE review_id = ?`, [review_id]);

        if (reviewInfo) {
            try {
                await createNotification(db, {
                    user_id: reviewInfo.owner_user_id,
                    salon_id: own.salon_id,
                    review_id: review_id,
                    email: reviewInfo.owner_email,
                    type_code: 'REVIEW_DELETED',
                    message: `${reviewInfo.reviewer_name} deleted their review for ${reviewInfo.salon_name}.`,
                    sender_email: 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send review deleted notification:', notifError);
            }
        }

        return res.status(200).json({ message: 'Review deleted' });
    } catch (err) {
        console.error('deleteReview error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.3 user (customer) sees reviews for a salon + UPH 1.31 employee/owner sees salon reviews
exports.listSalonReviews = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        const role = req.user?.role;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validate salon ID
        const salon_id = parseInt(req.params.salon_id, 10);
        if (!Number.isInteger(salon_id) || salon_id <= 0) return res.status(400).json({ message: 'Invalid salon_id' });

        const { limit, offset } = parseLimitOffset(req.query);

        //ensure salon exists
        const [[salon]] = await db.execute(`SELECT salon_id FROM salons WHERE salon_id = ?`, [salon_id]);
        if (!salon) return res.status(404).json({ message: 'Salon not found' });

        //ensuring employees and owners only see reviews from their respective salons
        if (role === 'EMPLOYEE') {
            const [empRows] = await db.execute(`SELECT salon_id FROM employees WHERE user_id = ? AND active = 1`, [authUserId]);
            if (empRows.length === 0) return res.status(404).json({ message: 'Employee profile not found' });

            const employeeSalonId = empRows[0].salon_id;
            if (employeeSalonId !== salon_id) return res.status(403).json({ message: 'You can only view reviews for the salon you work at' });
        } else if (role === 'OWNER') {
            const [ownerSalons] = await db.execute(`SELECT salon_id FROM salons WHERE owner_user_id = ?`, [authUserId]);
            if (ownerSalons.length === 0) return res.status(404).json({ message: 'Salon not found for this owner' });

            const ownedIds = new Set(ownerSalons.map(s => s.salon_id));
            if (!ownedIds.has(salon_id)) return res.status(403).json({ message: 'You can only view reviews for your own salon' });
        }

        //validation for limit and offset to prevent incorrect SQL arguments error
        const lim = Math.max(1, Math.min(Number(limit) | 0, 100));
        const off = Math.max(0, Number(offset) | 0);

        //getting amount of reviews and average rating
        const [[meta]] = await db.execute(`SELECT COUNT(*) AS total, AVG(rating) AS avg_rating
                                          FROM reviews WHERE salon_id = ?`, [salon_id]
        );

        const total = meta?.total ? Number(meta.total) : 0;
        const rawAvg = meta?.avg_rating == null ? null : Number(meta.avg_rating);
        const avg_rating = (rawAvg != null && Number.isFinite(rawAvg)) ? Number(rawAvg.toFixed(1)) : null;

        //if no reviews are found
        if (total === 0) {
            return res.status(200).json({
                data: [],
                meta: { total, avg_rating, limit: lim, offset: off, hasMore: false }
            });
        }

        //fetch reviews
        const [rows] = await db.execute(`SELECT r.review_id, r.rating, r.message, r.created_at, r.updated_at, u.user_id, u.full_name AS user_name FROM reviews r
                                        JOIN users u ON u.user_id = r.user_id WHERE r.salon_id = ? ORDER BY r.created_at DESC LIMIT ${lim} OFFSET ${off}`, [salon_id]
        );

        //fetch replies to a review (for UPH 1.4)
        const reviewIds = rows.map(r => r.review_id);
        let repliesByReview = new Map();

        if (reviewIds.length > 0) {
            const ph = reviewIds.map(() => '?').join(',');
            const [replies] = await db.execute(`SELECT rr.reply_id, rr.review_id, rr.author_user_id, rr.message, rr.created_at, rr.updated_at, u.full_name AS owner_name
                                               FROM review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.review_id IN (${ph})`, reviewIds
            );

            for (const rr of replies) {
                repliesByReview.set(rr.review_id, {
                    reply_id: rr.reply_id,
                    message: rr.message,
                    created_at: formatDateTime(rr.created_at),
                    updated_at: formatDateTime(rr.updated_at),
                    user: { user_id: rr.author_user_id, name: rr.owner_name }
                });
            }
        }

        const data = rows.map(r => ({
            review_id: r.review_id,
            rating: Number(r.rating),
            message: r.message,
            created_at: formatDateTime(r.created_at),
            updated_at: formatDateTime(r.updated_at),
            user: { user_id: r.user_id, name: r.user_name },
            reply: repliesByReview.get(r.review_id) || null
        }));

        return res.status(200).json({
            data,
            meta: {
                total,
                avg_rating,
                limit: lim,
                offset: off,
                hasMore: off + data.length < total
            }
        });
    } catch (err) {
        console.error('listSalonReviews error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//getting an individual customer's review for a salon so they can update it if they want
exports.getMyReviewForSalon = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validate salon ID
        const salon_id = parseInt(req.params.salon_id, 10);
        if (!Number.isInteger(salon_id) || salon_id <= 0) return res.status(400).json({ message: 'Invalid salon_id' });

        //getting this user's review
        const [[row]] = await db.execute(`SELECT review_id, rating, message, created_at, updated_at FROM reviews WHERE salon_id = ? AND user_id = ?`,
            [salon_id, authUserId]
        );

        //if no review is found
        if (!row) return res.status(200).json({ data: null });

        return res.status(200).json({
            data: {
                review_id: row.review_id,
                rating: Number(row.rating),
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('getMyReviewForSalon error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.4 owner creates a reply to a review for their salon
exports.createReply = async (req, res) => {
    const db = connection.promise();
    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const { review_id, message } = req.body || {};
        const rid = parseInt(review_id, 10);
        if (!Number.isInteger(rid) || rid <= 0) return res.status(400).json({ message: 'Invalid review_id' });
        if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'message is required' });
        if (message.length > 2000) return res.status(400).json({ message: 'message too long (max 2000 chars)' });

        //make sure review exists and is for this owner's salon
        const [[rev]] = await db.execute(`SELECT r.review_id, r.salon_id, s.owner_user_id FROM reviews r JOIN salons s ON s.salon_id = r.salon_id WHERE r.review_id = ?`, [rid]);
        if (!rev) return res.status(404).json({ message: 'Review not found' });
        if (rev.owner_user_id !== authUserId) return res.status(403).json({ message: 'You can only reply to reviews for your own salon' });

        //check for only one reply per review
        const [[existing]] = await db.execute(`SELECT reply_id FROM review_replies WHERE review_id = ?`, [rid]);
        if (existing) return res.status(409).json({ message: 'A reply already exists for this review' });

        //create reply
        const [ins] = await db.execute(`INSERT INTO review_replies (review_id, author_user_id, message) VALUES (?, ?, ?)`, [rid, authUserId, message.trim()]);

        //fetch the reply
        const [[row]] = await db.execute(`SELECT rr.reply_id, rr.review_id, rr.message, rr.created_at, rr.updated_at, u.user_id, u.full_name AS owner_name
                                         FROM review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.reply_id = ?`, [ins.insertId]
        );

        // Get review author (customer) info for notification
        const [[reviewAuthor]] = await db.execute(
            `SELECT r.user_id, u.email, u.full_name as customer_name, s.name as salon_name
             FROM reviews r
             JOIN users u ON r.user_id = u.user_id
             JOIN salons s ON r.salon_id = s.salon_id
             WHERE r.review_id = ?`,
            [rid]
        );

        if (reviewAuthor) {
            try {
                await createNotification(db, {
                    user_id: reviewAuthor.user_id,
                    salon_id: rev.salon_id,
                    review_id: rid,
                    email: reviewAuthor.email,
                    type_code: 'REVIEW_REPLY_CREATED',
                    message: `${row.owner_name} replied to your review for ${reviewAuthor.salon_name}: ${message.trim().substring(0, 100)}${message.trim().length > 100 ? '...' : ''}`,
                    sender_email: row.owner_name || 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send review reply created notification:', notifError);
            }
        }

        return res.status(201).json({
            message: 'Reply created',
            data: {
                reply_id: row.reply_id,
                review_id: row.review_id,
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at),
                user: { user_id: row.user_id, name: row.owner_name }
            }
        });
    } catch (err) {
        console.error('createReply error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.4 owner updates their reply to a review for their salon
exports.updateReply = async (req, res) => {
    const db = connection.promise();
    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const reply_id = parseInt(req.params.reply_id, 10);
        if (!Number.isInteger(reply_id) || reply_id <= 0) return res.status(400).json({ message: 'Invalid reply_id' });

        //validate new reply message
        const { message } = req.body || {};
        if (message !== undefined) {
            if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'message must be non-empty' });
            if (message.length > 2000) return res.status(400).json({ message: 'message too long (max 2000 chars)' });
        } else {
            return res.status(400).json({ message: 'Nothing to update' });
        }

        //check to ensure this owner can actually update this reply
        const [[rr]] = await db.execute(`SELECT rr.reply_id, rr.author_user_id AS reply_owner_user_id, rr.review_id,
                                        r.salon_id, s.owner_user_id FROM review_replies rr JOIN reviews r  ON r.review_id  = rr.review_id
                                        JOIN salons s ON s.salon_id = r.salon_id WHERE rr.reply_id = ?`, [reply_id]
        );
        if (!rr) return res.status(404).json({ message: 'Reply not found' });
        if (rr.owner_user_id !== authUserId || rr.reply_owner_user_id !== authUserId) return res.status(403).json({ message: 'You can only update your own salon reply' });

        //update the reply
        await db.execute(`UPDATE review_replies SET message = ? WHERE reply_id = ?`, [message.trim(), reply_id]);

        //fetch the new reply
        const [[row]] = await db.execute(`SELECT rr.reply_id, rr.review_id, rr.message, rr.created_at, rr.updated_at, u.user_id, u.full_name AS owner_name
                                         FROM review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.reply_id = ?`, [reply_id]
        );

        // Get review author (customer) info for notification
        const [[reviewAuthor]] = await db.execute(
            `SELECT r.user_id, u.email, u.full_name as customer_name, s.name as salon_name
             FROM reviews r
             JOIN users u ON r.user_id = u.user_id
             JOIN salons s ON r.salon_id = s.salon_id
             WHERE r.review_id = ?`,
            [rr.review_id]
        );

        if (reviewAuthor) {
            try {
                await createNotification(db, {
                    user_id: reviewAuthor.user_id,
                    salon_id: rr.salon_id,
                    review_id: rr.review_id,
                    email: reviewAuthor.email,
                    type_code: 'REVIEW_REPLY_UPDATED',
                    message: `${row.owner_name} updated their reply to your review for ${reviewAuthor.salon_name}.`,
                    sender_email: row.owner_name || 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send review reply updated notification:', notifError);
            }
        }

        return res.status(200).json({
            message: 'Reply updated',
            data: {
                reply_id: row.reply_id,
                review_id: row.review_id,
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at),
                user: { user_id: row.user_id, name: row.owner_name }
            }
        });
    } catch (err) {
        console.error('updateReply error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.4 owner deletes their reply to a review for their salon
exports.deleteReply = async (req, res) => {
    const db = connection.promise();
    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const reply_id = parseInt(req.params.reply_id, 10);
        if (!Number.isInteger(reply_id) || reply_id <= 0) return res.status(400).json({ message: 'Invalid reply_id' });

        //check if owner owns this salon and can delete this reply
        const [[rr]] = await db.execute(`SELECT rr.reply_id, rr.author_user_id AS reply_owner_user_id, rr.review_id, r.salon_id, s.owner_user_id
                                        FROM review_replies rr JOIN reviews r ON r.review_id = rr.review_id JOIN salons s ON s.salon_id = r.salon_id
                                        WHERE rr.reply_id = ?`, [reply_id]
        );
        if (!rr) return res.status(404).json({ message: 'Reply not found' });
        if (rr.owner_user_id !== authUserId || rr.reply_owner_user_id !== authUserId) return res.status(403).json({ message: 'You can only delete your own salon reply' });

        // Get review author (customer) info before deleting
        const [[reviewAuthor]] = await db.execute(
            `SELECT r.user_id, u.email, u.full_name as customer_name, s.name as salon_name
             FROM reviews r
             JOIN users u ON r.user_id = u.user_id
             JOIN salons s ON r.salon_id = s.salon_id
             WHERE r.review_id = ?`,
            [rr.review_id]
        );

        //delete the reply
        await db.execute(`DELETE FROM review_replies WHERE reply_id = ?`, [reply_id]);

        if (reviewAuthor) {
            try {
                await createNotification(db, {
                    user_id: reviewAuthor.user_id,
                    salon_id: rr.salon_id,
                    review_id: rr.review_id,
                    email: reviewAuthor.email,
                    type_code: 'REVIEW_REPLY_DELETED',
                    message: `The reply to your review for ${reviewAuthor.salon_name} has been deleted.`,
                    sender_email: 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send review reply deleted notification:', notifError);
            }
        }

        return res.status(200).json({ message: 'Reply deleted' });
    } catch (err) {
        console.error('deleteReply error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};