const bcrypt = require("bcrypt");
const crypto = require("crypto");
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

const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

const buildAuthTokens = async (client, user_id, meta = {}) => {
    const access_token = signAccessToken({ user_id });
    const refresh_token = signRefreshToken({ user_id });

    await client.refresh_token.create({
        data: {
            user_id,
            token_hash: hashToken(refresh_token),
            expires_at: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS),
            user_agent: meta.user_agent,
            ip: meta.ip,
        },
    });

    return { access_token, refresh_token };
};

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
    const { email, password, user_agent, ip } = data;

    const existing_user = await prisma_client.user.findUnique({
        where: { email },
    });

    if (existing_user) {
        throw new ApiError(STATUS_CODES.CONFLICT, "Email already registered");
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const { user, tokens } = await prisma_client.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: { email, password_hash },
        });

        const tokens = await buildAuthTokens(tx, user.id, { user_agent, ip });

        return { user, tokens };
    });

    return {
        user: sanitizeUser(user),
        ...tokens,
    };
};

exports.login = async (data) => {
    const { email, password, user_agent, ip } = data;

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
        ...(await buildAuthTokens(prisma_client, user.id, { user_agent, ip })),
    };
};

exports.refresh = async (data) => {
    const { refresh_token, user_agent, ip } = data;

    let decoded;

    try {
        decoded = verifyRefreshToken(refresh_token);
    } catch {
        throw new ApiError(
            STATUS_CODES.UNAUTHORIZED,
            "Invalid or expired refresh token"
        );
    }

    const token_hash = hashToken(refresh_token);

    return prisma_client.$transaction(async (tx) => {
        const token_row = await tx.refresh_token.findUnique({
            where: { token_hash },
        });

        if (!token_row || token_row.revoked_at) {
            throw new ApiError(
                STATUS_CODES.UNAUTHORIZED,
                "Invalid or expired refresh token"
            );
        }

        const user = await tx.user.findUnique({
            where: { id: decoded.user_id },
        });

        if (!user) {
            throw new ApiError(
                STATUS_CODES.UNAUTHORIZED,
                "Invalid or expired refresh token"
            );
        }

        await tx.refresh_token.update({
            where: { id: token_row.id },
            data: { revoked_at: new Date() },
        });

        return buildAuthTokens(tx, user.id, { user_agent, ip });
    });
};

exports.logout = async (data) => {
    const { refresh_token } = data;

    if (!refresh_token) {
        return;
    }

    await prisma_client.refresh_token.updateMany({
        where: { token_hash: hashToken(refresh_token), revoked_at: null },
        data: { revoked_at: new Date() },
    });
};
