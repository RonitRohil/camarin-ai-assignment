const rateLimit = require("express-rate-limit");
const STATUS_CODES = require("../constants/statusCodes");

// brute-force guard for auth endpoints - keyed by IP, not per-user, since an
// unauthenticated attacker has no user identity to key on yet
const auth_rate_limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many attempts, please try again later." },
    statusCode: STATUS_CODES.TOO_MANY_REQUESTS,
});

module.exports = { auth_rate_limiter };
