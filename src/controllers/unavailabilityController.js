const connection = require('../config/databaseConnection'); //db connection

//validating time for SQL
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const normTime = (t) => {
    if (!TIME_RX.test(t || '')) return null;
    const [hh, mm, ss] = t.split(':');
    return `${hh}:${mm}${ss ? ':' + ss.padStart(2, '0') : ':00'}`;
};

//validating weekday value function
const validWeekday = (w) => Number.isInteger(w) && w >= 0 && w <= 6;

//BS 1.5 block unavailable time slots (create/block)
exports.createRecurringBlock = async (req, res) => {
    const db = connection.promise();

    //params
    const employeeId = parseInt(req.params.employeeId, 10); //employee ID
    let { weekday, start_time, end_time, slot_interval_minutes = 30 } = req.body; //interval is 30 mins by default

    //validate employee ID
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
        return res.status(400).json({ message: 'Invalid employee id' });
    }

    //validate weekday value
    weekday = parseInt(weekday, 10);
    if (!validWeekday(weekday)) {
        return res.status(400).json({ message: 'Weekday must be an integer between 0-6' });
    }

    //validating start and end time
    const start = normTime(start_time);
    const end = normTime(end_time);
    if (!start || !end) {
        return res.status(400).json({ message: 'Start time and End time must be HH:MM (24h) format' });
    }
    if (end <= start) {
        return res.status(400).json({ message: 'End time must be after Start time' });
    }

    //checking role
    const role = req.user?.role;
    const authUserId = req.user?.user_id;

    try {
        //looking up employee
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.employee_id = ?`, [employeeId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        //only allow employees to block their own time
        if (role === 'EMPLOYEE') {
            if (empRows[0].user_id !== authUserId) {
                return res.status(403).json({ message: 'You can only manage your own unavailability' });
            }
        }

        //checking for blocked time overlap
        const [overlap] = await db.execute(`SELECT 1 FROM employee_unavailability
                                       WHERE employee_id = ? AND weekday = ?
                                       AND NOT (end_time <= ? OR start_time >= ?)
                                       LIMIT 1`, [employeeId, weekday, start, end]
        ); if (overlap.length) return res.status(409).json({ message: 'Overlaps an existing recurring block' });


        //insert new blocked time
        const [ins] = await db.execute(`INSERT INTO employee_unavailability
                                   (employee_id, weekday, start_time, end_time, slot_interval_minutes)
                                   VALUES (?, ?, ?, ?, ?)`, [employeeId, weekday, start, end, parseInt(slot_interval_minutes, 10) || 30]
        );
        //fetch inserted blocked time
        const [[row]] = await db.execute(`SELECT unavailability_id, employee_id, weekday, start_time, end_time, slot_interval_minutes,
                                     created_at, updated_at FROM employee_unavailability WHERE unavailability_id = ?`, [ins.insertId]
        ); return res.status(201).json({ message: 'Recurring block created', data: row });
    } catch (err) {
        console.error('createRecurringBlock error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.5 block unavailable time slots (list)
exports.listRecurringBlocks = async (req, res) => {
    const db = connection.promise();

    //params
    const employeeId = parseInt(req.params.employeeId, 10); //employee ID
    const weekdayQ = req.query.weekday !== undefined ? parseInt(req.query.weekday, 10) : null; //current weekday

    //validate employee ID
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
        return res.status(400).json({ message: 'Invalid employee id' });
    }

    //validate weekday value
    if (weekdayQ !== null && !validWeekday(weekdayQ)) {
        return res.status(400).json({ message: 'Weekday must be an integer between 0-6' });
    }

    //checking role
    const role = req.user?.role;
    const authUserId = req.user?.user_id;

    try {
        //looking up employee
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.employee_id = ?`, [employeeId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        //only allow employees to view their own unavailable time
        if (role === 'EMPLOYEE') {
            if (empRows[0].user_id !== authUserId) {
                return res.status(403).json({ message: 'You can only view your own unavailability' });
            }
        }

        //getting unavailable time slots
        const where = [`employee_id = ?`];
        const params = [employeeId];
        if (weekdayQ !== null) { where.push(`weekday = ?`); params.push(weekdayQ); }
        const [rows] = await db.execute(`SELECT unavailability_id, employee_id, weekday, start_time, end_time,
                                        slot_interval_minutes, created_at, updated_at FROM employee_unavailability
                                        WHERE ${where.join(' AND ')} ORDER BY weekday ASC, start_time ASC`, params
        ); return res.status(200).json({ data: rows });
    } catch (err) {
        console.error('listRecurringBlocks error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

//BS 1.5 block unavailable time slots (delete/unblock)
exports.deleteRecurringBlock = async (req, res) => {
    const db = connection.promise();

    //params
    const employeeId = parseInt(req.params.employeeId, 10); //employee ID
    const unavailabilityId = parseInt(req.params.unavailabilityId, 10); //unavailability ID

    //validate ID's
    if (!Number.isInteger(employeeId) || employeeId <= 0 ||
        !Number.isInteger(unavailabilityId) || unavailabilityId <= 0) {
        return res.status(400).json({ message: 'Invalid ids' });
    }

    //checking role
    const role = req.user?.role;
    const authUserId = req.user?.user_id;

    try {
        //finding blocked time
        const [rows] = await db.execute(`SELECT eu.unavailability_id, eu.employee_id, e.user_id
                                        FROM employee_unavailability eu JOIN employees e ON e.employee_id = eu.employee_id
                                        WHERE eu.unavailability_id = ? AND eu.employee_id = ?`, [unavailabilityId, employeeId]
        ); if (!rows.length) return res.status(404).json({ message: 'Recurring block not found' });
        
        //only allow employees to delete their own unavailable time
        if (role === 'EMPLOYEE') {
            if (rows[0].user_id !== authUserId) {
                return res.status(403).json({ message: 'You can only delete your own blocks' });
            }
        }
        //block found, now delete it
        await db.execute(`DELETE FROM employee_unavailability WHERE unavailability_id = ? AND employee_id = ?`,[unavailabilityId, employeeId]);

        return res.status(200).json({ message: 'Recurring block deleted' });
    } catch (err) {
        console.error('deleteRecurringBlock error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};