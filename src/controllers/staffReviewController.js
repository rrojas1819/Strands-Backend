const connection = require('../config/databaseConnection');
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

//helper function to ensure the customer has had a booking with the employee they want to review
async function customerHadCompletedWithEmployee(db, customerUserId, employeeId) {
    const [[row]] = await db.execute(`SELECT COUNT(*) AS cnt FROM bookings b JOIN booking_services bs ON bs.booking_id = b.booking_id
                                     WHERE b.customer_user_id = ? AND bs.employee_id = ? AND b.status = 'COMPLETED'`, [customerUserId, employeeId]
    );
    return (row?.cnt || 0) > 0;
}

//helper function to ensure the employee works at that salon
async function employeeBelongsToOwner(db, employeeId, ownerUserId) {
    const [[row]] = await db.execute(`SELECT COUNT(*) AS cnt FROM employees e
                                     JOIN salons s ON s.salon_id = e.salon_id
                                     WHERE e.employee_id = ? AND s.owner_user_id = ?`,
        [employeeId, ownerUserId]
    );
    return (row?.cnt || 0) > 0;
}

//helper function to get an employee's ID and their salon ID
async function employeeIdForUser(db, userId) {
    const [[row]] = await db.execute(`SELECT employee_id, salon_id FROM employees WHERE user_id = ? AND active = 1`, [userId]
    );
    return row || null;
}

//UPH 1.5 as a user (customer) I want to create a review for a specific staff member
exports.createStaffReview = async (req, res) => {
    const db = connection.promise();
    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validate input
        const { employee_id, rating, message = null } = req.body || {};
        const employeeId = parseInt(employee_id, 10);
        if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ message: 'Invalid employee_id' });
        if (!isHalfStar(rating)) return res.status(400).json({ message: 'rating must be 0.0–5.0 in 0.5 steps' });

        //ensure employee exists
        const [[emp]] = await db.execute(`SELECT employee_id FROM employees WHERE employee_id = ?`, [employeeId]);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        //ensure customer has had a booking with this employee
        const hadCompleted = await customerHadCompletedWithEmployee(db, authUserId, employeeId);
        if (!hadCompleted) return res.status(403).json({ message: 'You can review a stylist only after a completed service with them' });

        //add their review
        try {
            const [ins] = await db.execute(`INSERT INTO staff_reviews (employee_id, user_id, rating, message) VALUES (?, ?, ?, ?)`, [employeeId, authUserId, Number(rating), message]);

            const [[row]] = await db.execute(`SELECT sr.staff_review_id, sr.employee_id, sr.user_id, sr.rating, sr.message, sr.created_at, sr.updated_at, u.full_name AS user_name
                                             FROM staff_reviews sr JOIN users u ON u.user_id = sr.user_id WHERE sr.staff_review_id = ?`, [ins.insertId]
            );

            const [[employeeInfo]] = await db.execute(
                `SELECT e.user_id, e.salon_id, u.email, u.full_name as employee_name, s.name as salon_name
                 FROM employees e
                 JOIN users u ON e.user_id = u.user_id
                 JOIN salons s ON e.salon_id = s.salon_id
                 WHERE e.employee_id = ?`,
                [employeeId]
            );

            if (employeeInfo) {
                try {
                    await createNotification(db, {
                        user_id: employeeInfo.user_id,
                        salon_id: employeeInfo.salon_id,
                        employee_id: employeeId,
                        email: employeeInfo.email,
                        type_code: 'STAFF_REVIEW_CREATED',
                        message: `${row.user_name} left a ${rating}-star review for you${message ? ': ' + message.substring(0, 100) + (message.length > 100 ? '...' : '') : '.'}`,
                        sender_email: row.user_name || 'SYSTEM'
                    });
                } catch (notifError) {
                    console.error('Failed to send staff review created notification:', notifError);
                }
            }

            return res.status(201).json({
                message: 'Staff review created',
                data: {
                    staff_review_id: row.staff_review_id,
                    employee_id: row.employee_id,
                    user: { user_id: row.user_id, name: row.user_name },
                    rating: Number(row.rating),
                    message: row.message,
                    created_at: formatDateTime(row.created_at),
                    updated_at: formatDateTime(row.updated_at)
                }
            });
        } catch (e) {
            //preventing duplicate staff reviews to an employee
            if (e && e.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'You have already reviewed this stylist' });
            }
            throw e;
        }
    } catch (err) {
        console.error('createStaffReview error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.5 as a user (customer) I want to update a review for a specific staff member
exports.updateStaffReview = async (req, res) => {
    const db = connection.promise();
    try {

        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validating review ID
        const staff_review_id = parseInt(req.params.staff_review_id, 10);
        if (!Number.isInteger(staff_review_id) || staff_review_id <= 0) return res.status(400).json({ message: 'Invalid staff_review_id' });

        //validating rating
        const { rating, message } = req.body || {};
        if (rating !== undefined && !isHalfStar(rating)) return res.status(400).json({ message: 'rating must be 0.0–5.0 in 0.5 steps' });

        //ensure rating belongs to the user so they can update
        const [[own]] = await db.execute(`SELECT staff_review_id, employee_id FROM staff_reviews WHERE staff_review_id = ? AND user_id = ?`, [staff_review_id, authUserId]);
        if (!own) return res.status(404).json({ message: 'Staff review not found' });

        //building SQL query to update review
        const fields = [];
        const params = [];
        if (rating !== undefined) { fields.push('rating = ?'); params.push(Number(rating)); }
        if (message !== undefined) { fields.push('message = ?'); params.push(message); }
        if (!fields.length) return res.status(400).json({ message: 'Nothing to update' });
        params.push(staff_review_id);

        await db.execute(`UPDATE staff_reviews SET ${fields.join(', ')} WHERE staff_review_id = ?`, params);

        const [[row]] = await db.execute(`SELECT sr.staff_review_id, sr.employee_id, sr.user_id, sr.rating, sr.message, sr.created_at, sr.updated_at, u.full_name AS user_name
                                         FROM staff_reviews sr JOIN users u ON u.user_id = sr.user_id WHERE sr.staff_review_id = ?`, [staff_review_id]
        );

        // Get staff member (employee) info for notification
        const [[employeeInfo]] = await db.execute(
            `SELECT e.user_id, e.salon_id, u.email, u.full_name as employee_name, s.name as salon_name
             FROM employees e
             JOIN users u ON e.user_id = u.user_id
             JOIN salons s ON e.salon_id = s.salon_id
             WHERE e.employee_id = ?`,
            [own.employee_id]
        );

        if (employeeInfo) {
            try {
                await createNotification(db, {
                    user_id: employeeInfo.user_id,
                    salon_id: employeeInfo.salon_id,
                    employee_id: own.employee_id,
                    email: employeeInfo.email,
                    type_code: 'STAFF_REVIEW_UPDATED',
                    message: `${row.user_name} updated their review for you - ${row.rating} stars${row.message ? ': ' + row.message.substring(0, 100) + (row.message.length > 100 ? '...' : '') : '.'}`,
                    sender_email: row.user_name || 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send staff review updated notification:', notifError);
            }
        }

        return res.status(200).json({
            message: 'Staff review updated',
            data: {
                staff_review_id: row.staff_review_id,
                employee_id: row.employee_id,
                user: { user_id: row.user_id, name: row.user_name },
                rating: Number(row.rating),
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('updateStaffReview error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.5 as a user (customer) I want to delete a review for a specific staff member
exports.deleteStaffReview = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validating review ID
        const staff_review_id = parseInt(req.params.staff_review_id, 10);
        if (!Number.isInteger(staff_review_id) || staff_review_id <= 0) return res.status(400).json({ message: 'Invalid staff_review_id' });

        //ensure rating belongs to the user so they can delete
        const [[own]] = await db.execute(`SELECT staff_review_id FROM staff_reviews WHERE staff_review_id = ? AND user_id = ?`, [staff_review_id, authUserId]);
        if (!own) return res.status(404).json({ message: 'Staff review not found' });

        //deleting the review
        await db.execute(`DELETE FROM staff_reviews WHERE staff_review_id = ?`, [staff_review_id]);

        return res.status(200).json({ message: 'Staff review deleted' });
    } catch (err) {
        console.error('deleteStaffReview error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//listing all staff reviews and replies for an employee
exports.listEmployeeReviews = async (req, res) => {
    const db = connection.promise();
    try {

        const authUserId = req.user?.user_id;
        const role = req.user?.role;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validate employee ID
        const employee_id = parseInt(req.params.employee_id, 10);
        if (!Number.isInteger(employee_id) || employee_id <= 0) return res.status(400).json({ message: 'Invalid employee_id' });

        const { limit, offset } = parseLimitOffset(req.query);

        //ensure employee exists
        const [[emp]] = await db.execute(`SELECT e.employee_id, e.salon_id, s.owner_user_id
                                         FROM employees e JOIN salons s ON s.salon_id = e.salon_id
                                         WHERE e.employee_id = ?`, [employee_id]
        );
        if (!emp) return res.status(404).json({ message: 'Employee not found' });


        //ensuring employees only see their own staff reviews and owners only see staff reviews from their salon
        if (role === 'EMPLOYEE') {
            const myEmp = await employeeIdForUser(db, authUserId);
            if (!myEmp) return res.status(404).json({ message: 'Employee profile not found' });
            if (myEmp.employee_id !== employee_id) return res.status(403).json({ message: 'You can only view your own reviews' });
        } else if (role === 'OWNER') {
            const ok = await employeeBelongsToOwner(db, employee_id, authUserId);
            if (!ok) return res.status(403).json({ message: 'You can only view reviews for your staff' });
        }
        //else they are a customer, so they see all staff reviews

        //validation for limit and offset to prevent incorrect SQL arguments error
        const lim = Math.max(1, Math.min(Number(limit) | 0, 100));
        const off = Math.max(0, Number(offset) | 0);

        //getting amount of staff reviews and average rating
        const [[meta]] = await db.execute(`SELECT COUNT(*) AS total, AVG(rating) AS avg_rating 
                                          FROM staff_reviews WHERE employee_id = ?`, [employee_id]
        );

        const total = meta?.total ? Number(meta.total) : 0;
        const rawAvg = meta?.avg_rating == null ? null : Number(meta.avg_rating);
        const avg_rating = (rawAvg != null && Number.isFinite(rawAvg)) ? Number(rawAvg.toFixed(1)) : null;

        //if no staff reviews are found
        if (total === 0) {
            return res.status(200).json({
                data: [],
                meta: { total, avg_rating, limit: lim, offset: off, hasMore: false }
            });
        }

        //fetch staff reviews
        const [rows] = await db.execute(`SELECT sr.staff_review_id, sr.rating, sr.message, sr.created_at, sr.updated_at, u.user_id, u.full_name AS user_name
                                        FROM staff_reviews sr JOIN users u ON u.user_id = sr.user_id WHERE sr.employee_id = ? ORDER BY sr.created_at DESC
                                        LIMIT ${lim} OFFSET ${off}`, [employee_id]
        );

        //fetch replies to a staff review
        const reviewIds = rows.map(r => r.staff_review_id);
        let repliesByReview = new Map();

        if (reviewIds.length > 0) {
            const ph = reviewIds.map(() => '?').join(',');
            const [replies] = await db.execute(`SELECT rr.staff_reply_id, rr.staff_review_id, rr.author_user_id, rr.message, rr.created_at, rr.updated_at, u.full_name AS author_name
                                               FROM staff_review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.staff_review_id IN (${ph})`, reviewIds
            );
            for (const rr of replies) {
                repliesByReview.set(rr.staff_review_id, {
                    staff_reply_id: rr.staff_reply_id,
                    message: rr.message,
                    created_at: formatDateTime(rr.created_at),
                    updated_at: formatDateTime(rr.updated_at),
                    user: { user_id: rr.author_user_id, name: rr.author_name }
                });
            }
        }

        const data = rows.map(r => ({
            staff_review_id: r.staff_review_id,
            rating: Number(r.rating),
            message: r.message,
            created_at: formatDateTime(r.created_at),
            updated_at: formatDateTime(r.updated_at),
            user: { user_id: r.user_id, name: r.user_name },
            reply: repliesByReview.get(r.staff_review_id) || null
        }));

        return res.status(200).json({
            data,
            meta: { total, avg_rating, limit: lim, offset: off, hasMore: off + data.length < total }
        });
    } catch (err) {
        console.error('listEmployeeReviews error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//getting an individual customer's staff review for updating purposes
exports.getMyStaffReviewForEmployee = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        //validate employee ID
        const employee_id = parseInt(req.params.employee_id, 10);
        if (!Number.isInteger(employee_id) || employee_id <= 0) return res.status(400).json({ message: 'Invalid employee_id' });

        //getting this user's staff review
        const [[row]] = await db.execute(`SELECT staff_review_id, rating, message, created_at, updated_at
                                         FROM staff_reviews WHERE employee_id = ? AND user_id = ?`, [employee_id, authUserId]
        );

        //if no staff review is found
        if (!row) return res.status(200).json({ data: null });

        return res.status(200).json({
            data: {
                staff_review_id: row.staff_review_id,
                rating: Number(row.rating),
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at)
            }
        });
    } catch (err) {
        console.error('getMyStaffReviewForEmployee error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.51 as an employee I want to create a reply to a review made about me
exports.createStaffReply = async (req, res) => {
    const db = connection.promise();

    try {

        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const { staff_review_id, message } = req.body || {};
        const srid = parseInt(staff_review_id, 10);
        if (!Number.isInteger(srid) || srid <= 0) return res.status(400).json({ message: 'Invalid staff_review_id' });
        if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'message is required' });
        if (message.length > 2000) return res.status(400).json({ message: 'message too long (max 2000 chars)' });

        const myEmp = await employeeIdForUser(db, authUserId);
        if (!myEmp) return res.status(404).json({ message: 'Employee profile not found' });

        //make sure review exists and is for this employee
        const [[rev]] = await db.execute(`SELECT staff_review_id, employee_id FROM staff_reviews WHERE staff_review_id = ?`, [srid]);
        if (!rev) return res.status(404).json({ message: 'Staff review not found' });
        if (rev.employee_id !== myEmp.employee_id) return res.status(403).json({ message: 'You can only reply to reviews about you' });

        //check for only one reply per staff review
        const [[exists]] = await db.execute(`SELECT staff_reply_id FROM staff_review_replies WHERE staff_review_id = ?`, [srid]);
        if (exists) return res.status(409).json({ message: 'A reply already exists for this staff review' });

        //create reply
        const [ins] = await db.execute(`INSERT INTO staff_review_replies (staff_review_id, author_user_id, message) VALUES (?, ?, ?)`, [srid, authUserId, message.trim()]);

        //fetch the reply
        const [[row]] = await db.execute(`SELECT rr.staff_reply_id, rr.staff_review_id, rr.message, rr.created_at, rr.updated_at, u.user_id, u.full_name AS author_name
                                         FROM staff_review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.staff_reply_id = ?`, [ins.insertId]
        );

        // Get review author (customer) info for notification
        const [[reviewAuthor]] = await db.execute(
            `SELECT sr.user_id, u.email, u.full_name as customer_name, e.salon_id, s.name as salon_name
             FROM staff_reviews sr
             JOIN users u ON sr.user_id = u.user_id
             JOIN employees e ON sr.employee_id = e.employee_id
             JOIN salons s ON e.salon_id = s.salon_id
             WHERE sr.staff_review_id = ?`,
            [srid]
        );

        if (reviewAuthor) {
            try {
                await createNotification(db, {
                    user_id: reviewAuthor.user_id,
                    salon_id: reviewAuthor.salon_id,
                    employee_id: myEmp.employee_id,
                    email: reviewAuthor.email,
                    type_code: 'STAFF_REVIEW_REPLY_CREATED',
                    message: `${row.author_name} replied to your review: ${message.trim().substring(0, 100)}${message.trim().length > 100 ? '...' : ''}`,
                    sender_email: row.author_name || 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send staff review reply created notification:', notifError);
            }
        }

        return res.status(201).json({
            message: 'Staff reply created',
            data: {
                staff_reply_id: row.staff_reply_id,
                staff_review_id: row.staff_review_id,
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at),
                user: { user_id: row.user_id, name: row.author_name }
            }
        });
    } catch (err) {
        console.error('createStaffReply error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.51 as an employee I want to update a reply to a review made about me
exports.updateStaffReply = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const staff_reply_id = parseInt(req.params.staff_reply_id, 10);
        if (!Number.isInteger(staff_reply_id) || staff_reply_id <= 0) return res.status(400).json({ message: 'Invalid staff_reply_id' });

        //validate new reply message
        const { message } = req.body || {};
        if (message === undefined) return res.status(400).json({ message: 'Nothing to update' });
        if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'message must be non-empty' });
        if (message.length > 2000) return res.status(400).json({ message: 'message too long (max 2000 chars)' });

        //check to ensure this employee can actually update this reply
        const myEmp = await employeeIdForUser(db, authUserId);
        if (!myEmp) return res.status(404).json({ message: 'Employee profile not found' });
        const [[rr]] = await db.execute(`SELECT rr.staff_reply_id, rr.staff_review_id, rr.author_user_id, sr.employee_id FROM staff_review_replies rr
                                        JOIN staff_reviews sr ON sr.staff_review_id = rr.staff_review_id WHERE rr.staff_reply_id = ?`, [staff_reply_id]
        );
        if (!rr) return res.status(404).json({ message: 'Reply not found' });
        if (rr.author_user_id !== authUserId || rr.employee_id !== myEmp.employee_id) return res.status(403).json({ message: 'You can only update your own reply' });

        //update the reply
        await db.execute(`UPDATE staff_review_replies SET message = ? WHERE staff_reply_id = ?`, [message.trim(), staff_reply_id]);

        //fetch the new reply
        const [[row]] = await db.execute(`SELECT rr.staff_reply_id, rr.staff_review_id, rr.message, rr.created_at, rr.updated_at, u.user_id, u.full_name AS author_name
                                         FROM staff_review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.staff_reply_id = ?`, [staff_reply_id]
        );

        // Get review author (customer) info for notification
        const [[reviewAuthor]] = await db.execute(
            `SELECT sr.user_id, u.email, u.full_name as customer_name, e.salon_id, s.name as salon_name
             FROM staff_reviews sr
             JOIN users u ON sr.user_id = u.user_id
             JOIN employees e ON sr.employee_id = e.employee_id
             JOIN salons s ON e.salon_id = s.salon_id
             WHERE sr.staff_review_id = ?`,
            [rr.staff_review_id]
        );

        if (reviewAuthor) {
            try {
                await createNotification(db, {
                    user_id: reviewAuthor.user_id,
                    salon_id: reviewAuthor.salon_id,
                    employee_id: myEmp.employee_id,
                    email: reviewAuthor.email,
                    type_code: 'STAFF_REVIEW_REPLY_UPDATED',
                    message: `${row.author_name} updated their reply to your review.`,
                    sender_email: row.author_name || 'SYSTEM'
                });
            } catch (notifError) {
                console.error('Failed to send staff review reply updated notification:', notifError);
            }
        }

        return res.status(200).json({
            message: 'Staff reply updated',
            data: {
                staff_reply_id: row.staff_reply_id,
                staff_review_id: row.staff_review_id,
                message: row.message,
                created_at: formatDateTime(row.created_at),
                updated_at: formatDateTime(row.updated_at),
                user: { user_id: row.user_id, name: row.author_name }
            }
        });
    } catch (err) {
        console.error('updateStaffReply error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.51 as an employee I want to delete a reply to a review made about me
exports.deleteStaffReply = async (req, res) => {
    const db = connection.promise();
    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const staff_reply_id = parseInt(req.params.staff_reply_id, 10);
        if (!Number.isInteger(staff_reply_id) || staff_reply_id <= 0) return res.status(400).json({ message: 'Invalid staff_reply_id' });

        const myEmp = await employeeIdForUser(db, authUserId);
        if (!myEmp) return res.status(404).json({ message: 'Employee profile not found' });

        //check if employee works at this salon and can delete this reply
        const [[rr]] = await db.execute(`SELECT rr.staff_reply_id, rr.author_user_id, sr.employee_id
                                        FROM staff_review_replies rr JOIN staff_reviews sr ON sr.staff_review_id = rr.staff_review_id WHERE rr.staff_reply_id = ?`, [staff_reply_id]
        );
        if (!rr) return res.status(404).json({ message: 'Reply not found' });
        if (rr.author_user_id !== authUserId || rr.employee_id !== myEmp.employee_id) return res.status(403).json({ message: 'You can only delete your own reply' });

        //delete the reply
        await db.execute(`DELETE FROM staff_review_replies WHERE staff_reply_id = ?`, [staff_reply_id]);
        return res.status(200).json({ message: 'Staff reply deleted' });
    } catch (err) {
        console.error('deleteStaffReply error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//UPH 1.52 as an owner I want to see reviews and replies for all of my staff
exports.listOwnerStaffReviews = async (req, res) => {
    const db = connection.promise();

    try {
        const authUserId = req.user?.user_id;
        if (!authUserId) return res.status(401).json({ message: 'Unauthorized' });

        const { limit, offset } = parseLimitOffset(req.query);
        //validation for limit and offset to prevent incorrect SQL arguments error
        const lim = Math.max(1, Math.min(Number(limit) | 0, 100));
        const off = Math.max(0, Number(offset) | 0);

        //get all employees that work for this owner
        const [emps] = await db.execute(`SELECT e.employee_id FROM employees e JOIN salons s ON s.salon_id = e.salon_id
                                        WHERE s.owner_user_id = ?`, [authUserId]
        );
        //if no employees are found
        if (emps.length === 0) {
            return res.status(200).json({
                data: [],
                meta: { total: 0, avg_rating: null, limit: lim, offset: off, hasMore: false }
            });
        }
        const employeeIds = emps.map(e => e.employee_id);

        //getting number of staff reviews and average rating for all employees
        const phAll = employeeIds.map(() => '?').join(',');
        const [[meta]] = await db.execute(`SELECT COUNT(*) AS total, AVG(rating) AS avg_rating
                                          FROM staff_reviews WHERE employee_id IN (${phAll})`, employeeIds
        );
        const total = meta?.total ? Number(meta.total) : 0;
        const rawAvg = meta?.avg_rating == null ? null : Number(meta.avg_rating);
        const avg_rating = (rawAvg != null && Number.isFinite(rawAvg)) ? Number(rawAvg.toFixed(1)) : null;

        //if no staff reviews are found
        if (total === 0) {
            return res.status(200).json({
                data: [],
                meta: { total, avg_rating, limit: lim, offset: off, hasMore: false }
            });
        }

        //getting all staff reviews
        const [rows] = await db.execute(`SELECT sr.staff_review_id, sr.employee_id, sr.rating, sr.message, sr.created_at, sr.updated_at, u.user_id, u.full_name AS user_name, e.employee_id AS emp_id, ue.full_name AS employee_name
                                        FROM staff_reviews sr JOIN users u   ON u.user_id = sr.user_id JOIN employees e ON e.employee_id = sr.employee_id LEFT JOIN users ue ON ue.user_id = e.user_id WHERE sr.employee_id IN (${phAll})
                                        ORDER BY sr.created_at DESC LIMIT ${lim} OFFSET ${off}`, employeeIds
        );

        //getting all replies
        const reviewIds = rows.map(r => r.staff_review_id);
        let repliesByReview = new Map();
        if (reviewIds.length > 0) {
            const ph = reviewIds.map(() => '?').join(',');
            const [replies] = await db.execute(`SELECT rr.staff_reply_id, rr.staff_review_id, rr.author_user_id, rr.message, rr.created_at, rr.updated_at, u.full_name AS author_name
                                               FROM staff_review_replies rr JOIN users u ON u.user_id = rr.author_user_id WHERE rr.staff_review_id IN (${ph})`, reviewIds
            );
            for (const rr of replies) {
                repliesByReview.set(rr.staff_review_id, {
                    staff_reply_id: rr.staff_reply_id,
                    message: rr.message,
                    created_at: formatDateTime(rr.created_at),
                    updated_at: formatDateTime(rr.updated_at),
                    user: { user_id: rr.author_user_id, name: rr.author_name }
                });
            }
        }

        const data = rows.map(r => ({
            staff_review_id: r.staff_review_id,
            employee: { employee_id: r.emp_id, name: r.employee_name || null },
            rating: Number(r.rating),
            message: r.message,
            created_at: formatDateTime(r.created_at),
            updated_at: formatDateTime(r.updated_at),
            user: { user_id: r.user_id, name: r.user_name },
            reply: repliesByReview.get(r.staff_review_id) || null
        }));

        return res.status(200).json({
            data,
            meta: { total, avg_rating, limit: lim, offset: off, hasMore: off + data.length < total }
        });
    } catch (err) {
        console.error('listOwnerStaffReviews error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};