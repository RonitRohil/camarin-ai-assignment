const bcrypt = require("bcrypt");
const prisma_client = require("../utils/prismaClient");
const env = require("../config/env");
const STATUS_CODES = require("../constants/statusCodes");
const ApiError = require("../utils/ApiError");
const {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    ACCESS_TOKEN_MAX_AGE_MS,
    REFRESH_TOKEN_MAX_AGE_MS,
} = require("../utils/jwt");

const BCRYPT_SALT_ROUNDS = 12;

const buildAuthTokens = (user_id) => ({
    access_token: signAccessToken({ user_id }),
    refresh_token: signRefreshToken({ user_id }),
});

const sanitizeUser = (user) => ({
    id: user.id,
    email: user.email,
    created_at: user.created_at,
});

const getCookieOptions = (max_age_ms) => ({
    httpOnly: true,
    secure: !env.IS_DEVELOPMENT,
    sameSite: env.IS_DEVELOPMENT ? "lax" : "none",
    maxAge: max_age_ms,
});

exports.getAccessTokenCookieOptions = () =>
    getCookieOptions(ACCESS_TOKEN_MAX_AGE_MS);

exports.getRefreshTokenCookieOptions = () =>
    getCookieOptions(REFRESH_TOKEN_MAX_AGE_MS);

exports.register = async (data) => {
    const { email, password } = data;

    const existing_user = await prisma_client.user.findUnique({
        where: { email },
    });

    if (existing_user) {
        throw new ApiError(STATUS_CODES.CONFLICT, "Email already registered");
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const user = await prisma_client.user.create({
        data: { email, password_hash },
    });

    return {
        user: sanitizeUser(user),
        ...buildAuthTokens(user.id),
    };
};

exports.login = async (data) => {
    const { email, password } = data;

    const user = await prisma_client.user.findUnique({ where: { email } });

    if (!user) {
        throw new ApiError(STATUS_CODES.UNAUTHORIZED, "Invalid email or password");
    }

    const is_password_valid = await bcrypt.compare(password, user.password_hash);

    if (!is_password_valid) {
        throw new ApiError(STATUS_CODES.UNAUTHORIZED, "Invalid email or password");
    }

    return {
        user: sanitizeUser(user),
        ...buildAuthTokens(user.id),
    };
};

exports.refresh = async (data) => {
    const { refresh_token } = data;

    let decoded;

    try {
        decoded = verifyRefreshToken(refresh_token);
    } catch {
        throw new ApiError(
            STATUS_CODES.UNAUTHORIZED,
            "Invalid or expired refresh token"
        );
    }

    const user = await prisma_client.user.findUnique({
        where: { id: decoded.user_id },
    });

    if (!user) {
        throw new ApiError(
            STATUS_CODES.UNAUTHORIZED,
            "Invalid or expired refresh token"
        );
    }

    return {
        access_token: signAccessToken({ user_id: user.id }),
    };
};

exports.logout = async () => {
    // stateless JWT, no server-side session to invalidate -
    // the controller clears the httpOnly cookies, nothing to persist here
};
