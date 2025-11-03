const connection = require('../config/databaseConnection'); //db connection


const formatDateTime = (timeStr) => {
    if (!timeStr) return null;
    if (timeStr instanceof Date) {
        const Y = timeStr.getFullYear();
        const M = String(timeStr.getMonth() + 1).padStart(2, '0');
        const D = String(timeStr.getDate()).padStart(2, '0');
        const H = String(timeStr.getHours()).padStart(2, '0');
        const MI = String(timeStr.getMinutes()).padStart(2, '0');
        const S = String(timeStr.getSeconds()).padStart(2, '0');
        return `${Y}-${M}-${D}T${H}:${MI}:${S}`;
    }
    return String(timeStr);
};

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
        const { salon_id, rating, comment = null } = req.body || {};
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

            const [ins] = await db.execute(`INSERT INTO reviews (salon_id, user_id, rating, comment) VALUES (?, ?, ?, ?)`,
                                           [Number(salon_id), authUserId, Number(rating), comment]
            );
            const [[row]] = await db.execute(`SELECT r.review_id, r.salon_id, r.user_id, r.rating, r.comment, r.created_at, r.updated_at,
                                             u.full_name AS user_name FROM reviews r JOIN users u ON u.user_id = r.user_id WHERE r.review_id = ?`,
                                             [ins.insertId]
            );
            return res.status(201).json({
                message: 'Review created',
                data: {
                    review_id: row.review_id,
                    salon_id: row.salon_id,
                    user: { user_id: row.user_id, name: row.user_name },
                    rating: Number(row.rating),
                    comment: row.comment,
                    created_at: formatDateTime(row.created_at),
                    updated_at: formatDateTime(row.updated_at)
                }
            });
        } catch (e) {
            //preventing duplicate reviews to a salon
            if (e && e.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'You have already reviewed this salon' });
            }
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
        const { rating, comment } = req.body || {};
        if (rating !== undefined && !isHalfStar(rating)) return res.status(400).json({ message: 'rating must be between 0.0 and 5.0 in 0.5 steps' });
        
        //ensure rating belongs to the user so they can update
        const [[own]] = await db.execute(`SELECT review_id FROM reviews WHERE review_id = ? AND user_id = ?`, [review_id, authUserId]);
        if (!own) return res.status(404).json({ message: 'Review not found' });

        //building SQL query to update review
        const fields = [];
        const params = [];
        if (rating !== undefined) { fields.push('rating = ?'); params.push(Number(rating)); }
        if (comment !== undefined) { fields.push('comment = ?'); params.push(comment); }
        if (!fields.length) return res.status(400).json({ message: 'Nothing to update' });
        params.push(review_id);

        await db.execute(`UPDATE reviews SET ${fields.join(', ')} WHERE review_id = ?`, params);

        const [[row]] = await db.execute(`SELECT r.review_id, r.salon_id, r.user_id, r.rating, r.comment, r.created_at, r.updated_at,
                                         u.full_name AS user_name FROM reviews r JOIN users u ON u.user_id = r.user_id WHERE r.review_id = ?`,
                                        [review_id]
        );

        return res.status(200).json({
            message: 'Review updated',
            data: {
                review_id: row.review_id,
                salon_id: row.salon_id,
                user: { user_id: row.user_id, name: row.user_name },
                rating: Number(row.rating),
                comment: row.comment,
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
        const [[own]] = await db.execute(`SELECT review_id FROM reviews WHERE review_id = ? AND user_id = ?`,
                                         [review_id, authUserId]
        );
        if (!own) return res.status(404).json({ message: 'Review not found' });

        //deleting the review
        await db.execute(`DELETE FROM reviews WHERE review_id = ?`, [review_id]);

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

        const [rows] = await db.execute(`SELECT r.review_id, r.rating, r.comment, r.created_at, r.updated_at, u.user_id, u.full_name AS user_name FROM reviews r
                                        JOIN users u ON u.user_id = r.user_id WHERE r.salon_id = ? ORDER BY r.created_at DESC LIMIT ${lim} OFFSET ${off}`, [salon_id]
        );

        const data = rows.map(r => ({
            review_id: r.review_id,
            rating: Number(r.rating),
            comment: r.comment,
            created_at: formatDateTime(r.created_at),
            updated_at: formatDateTime(r.updated_at),
            user: { user_id: r.user_id, name: r.user_name }
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
        const [[row]] = await db.execute(`SELECT review_id, rating, comment, created_at, updated_at FROM reviews WHERE salon_id = ? AND user_id = ?`,
                                         [salon_id, authUserId]
        );

        //if no review is found
        if (!row) return res.status(200).json({ data: null });
    
        return res.status(200).json({
            data: {
                review_id: row.review_id,
                rating: Number(row.rating),
                comment: row.comment,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('getMyReviewForSalon error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};