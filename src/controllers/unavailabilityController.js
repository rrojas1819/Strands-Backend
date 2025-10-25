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
    let { weekday, start_time, end_time, slot_interval_minutes = 30 } = req.body; //interval is 30 mins by default

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

    //get authenticated user
    const authUserId = req.user?.user_id;

    try {
        //looking up employee by user_id
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = empRows[0].employee_id;

        //checking if employee has availability for this weekday
        const [availabilityRows] = await db.execute(`SELECT start_time, end_time FROM employee_availability
                                                    WHERE employee_id = ? AND weekday = ?`, [employeeId, weekday]
        ); if (!availabilityRows.length) return res.status(400).json({ message: 'No availability set for this weekday' });

        const availability = availabilityRows[0];
        
        //validating that unavailability is within availability bounds
        if (start < availability.start_time || end > availability.end_time) {
            return res.status(400).json({ 
                message: `Unavailability must be within availability hours (${availability.start_time} - ${availability.end_time})` 
            });
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
    const weekdayQ = req.query.weekday !== undefined ? parseInt(req.query.weekday, 10) : null; //current weekday

    //validate weekday value
    if (weekdayQ !== null && !validWeekday(weekdayQ)) {
        return res.status(400).json({ message: 'Weekday must be an integer between 0-6' });
    }

    //get authenticated user
    const authUserId = req.user?.user_id;

    try {
        //looking up employee by user_id
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = empRows[0].employee_id;

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
    let { weekday, start_time, end_time } = req.body;

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

    //get authenticated user
    const authUserId = req.user?.user_id;

    try {
        //looking up employee by user_id first
        const [empRows] = await db.execute(`SELECT e.employee_id, e.user_id FROM employees e 
                                        WHERE e.user_id = ?`, [authUserId]
        ); if (!empRows.length) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = empRows[0].employee_id;

        //finding blocked time by weekday and time range
        const [rows] = await db.execute(`SELECT eu.unavailability_id, eu.employee_id, eu.weekday, eu.start_time, eu.end_time
                                        FROM employee_unavailability eu
                                        WHERE eu.employee_id = ? AND eu.weekday = ? AND eu.start_time = ? AND eu.end_time = ?`, 
                                        [employeeId, weekday, start, end]
        ); if (!rows.length) return res.status(404).json({ message: 'Recurring block not found' });
        
        //block found, now delete it
        await db.execute(`DELETE FROM employee_unavailability WHERE employee_id = ? AND weekday = ? AND start_time = ? AND end_time = ?`,
                        [employeeId, weekday, start, end]);

        return res.status(200).json({ message: 'Recurring block deleted' });
    } catch (err) {
        console.error('deleteRecurringBlock error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};