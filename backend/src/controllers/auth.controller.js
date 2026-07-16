const auth_service = require("../services/auth.service");
const ApiError = require("../utils/ApiError");
const STATUS_CODES = require("../constants/statusCodes");

exports.register = async (req, res, next) => {
    try {
        const result = await auth_service.register({
            ...req.body,
            user_agent: req.headers["user-agent"],
            ip: req.ip,
        });

        res.cookie("access_token", result.access_token, auth_service.getAccessTokenCookieOptions());
        res.cookie("refresh_token", result.refresh_token, auth_service.getRefreshTokenCookieOptions());

        res.status(STATUS_CODES.CREATED).json({
            success: true,
            status_code: STATUS_CODES.CREATED,
            message: "user registered successfully",
            result: { user: result.user },
        });
    } catch (err) {
        next(err);
    }
};

exports.login = async (req, res, next) => {
    try {
        const result = await auth_service.login({
            ...req.body,
            user_agent: req.headers["user-agent"],
            ip: req.ip,
        });

        res.cookie("access_token", result.access_token, auth_service.getAccessTokenCookieOptions());
        res.cookie("refresh_token", result.refresh_token, auth_service.getRefreshTokenCookieOptions());

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "logged in successfully",
            result: { user: result.user },
        });
    } catch (err) {
        next(err);
    }
};

exports.refresh = async (req, res, next) => {
    try {
        const refresh_token = req.cookies?.refresh_token;

        if (!refresh_token) {
            throw new ApiError(STATUS_CODES.UNAUTHORIZED, "Refresh token missing");
        }

        const result = await auth_service.refresh({
            refresh_token,
            user_agent: req.headers["user-agent"],
            ip: req.ip,
        });

        res.cookie("access_token", result.access_token, auth_service.getAccessTokenCookieOptions());
        res.cookie("refresh_token", result.refresh_token, auth_service.getRefreshTokenCookieOptions());

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "token refreshed successfully",
            result: {},
        });
    } catch (err) {
        next(err);
    }
};

exports.logout = async (req, res, next) => {
    try {
        const refresh_token = req.cookies?.refresh_token;

        await auth_service.logout({ refresh_token });

        res.clearCookie("access_token");
        res.clearCookie("refresh_token");

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "logged out successfully",
            result: {},
        });
    } catch (err) {
        next(err);
    }
};
