const { verifyAccessToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");
const STATUS_CODES = require("../constants/statusCodes");

const authMiddleware = (req, res, next) => {
    const access_token = req.cookies?.access_token;

    if (!access_token) {
        return next(new ApiError(STATUS_CODES.UNAUTHORIZED, "Authentication required"));
    }

    try {
        const decoded = verifyAccessToken(access_token);
        req.user_id = decoded.user_id;
        next();
    } catch (err) {
        return next(new ApiError(STATUS_CODES.UNAUTHORIZED, "Invalid or expired access token"));
    }
};

module.exports = authMiddleware;
