const env = require("../config/env");
const STATUS_CODES = require("../constants/statusCodes");
const logger = require("../utils/logger");

// Express recognizes error-handling middleware by argument count (4), so
// _next has to stay in the signature even though it's never called
const errorHandler = (err, req, res, _next) => {
    logger.error(err);

    const status_code = err.status_code || STATUS_CODES.INTERNAL_SERVER_ERROR;

    res.status(status_code).json({
        success: false,
        status_code,
        message: err.message || "Internal Server Error",
        result: {
            stack: env.IS_DEVELOPMENT ? err.stack : undefined,
        },
    });
};

module.exports = errorHandler;
