const env = require("../config/env");
const STATUS_CODES = require("../constants/statusCodes");
const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
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
