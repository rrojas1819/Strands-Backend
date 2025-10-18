require('dotenv').config();

// Health Check
exports.healthCheck = async (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Server: Online",
        timestamp: new Date().toISOString(),
    });
};


