const { DateTime } = require('luxon');

// Health Check
exports.healthCheck = async (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Server: Online",
        timestamp: DateTime.utc().toISO(),
    });
};


