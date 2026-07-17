import { describe, it, expect, beforeEach } from "vitest";

// vi.mock() doesn't reach through require() in this CommonJS codebase (see
// tests/retry.test.js) - same require.cache substitution trick here.
const stubModule = (relative_path, exports_value) => {
    const resolved = require.resolve(relative_path);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exports_value,
    };
};

stubModule("../src/config/env", {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_ACCESS_SECRET: "test-access-secret",
    JWT_REFRESH_SECRET: "test-refresh-secret",
    IS_DEVELOPMENT: true,
});

// Real in-memory tables keyed the same way Postgres would be (token_hash
// unique, lookup by id) - a plain vi.fn() stub can't exercise rotation since
// the whole point is checking state written by refresh() persists into the
// next call. This is the code path where the missing-migration and
// jti-collision bugs actually shipped (see feedback_testing_priorities memory).
let users;
let refresh_tokens;

const mock_prisma = {
    user: {
        findUnique: async ({ where }) =>
            users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) || null,
        create: async ({ data }) => {
            const user = { id: "user-1", created_at: new Date(), ...data };
            users.push(user);
            return user;
        },
    },
    refresh_token: {
        create: async ({ data }) => {
            const row = { id: `rt-${refresh_tokens.length + 1}`, revoked_at: null, ...data };
            refresh_tokens.push(row);
            return row;
        },
        findUnique: async ({ where }) =>
            refresh_tokens.find((r) => r.token_hash === where.token_hash) || null,
        update: async ({ where, data }) => {
            const row = refresh_tokens.find((r) => r.id === where.id);
            Object.assign(row, data);
            return row;
        },
    },
    $transaction: async (fn) => fn(mock_prisma),
};

stubModule("../src/utils/prismaClient", mock_prisma);

const auth_service = require("../src/services/auth.service");
const STATUS_CODES = require("../src/constants/statusCodes");

describe("auth.service - refresh token rotation", () => {
    beforeEach(() => {
        users = [];
        refresh_tokens = [];
    });

    it("signup -> refresh once -> old token 401s on reuse -> new token works", async () => {
        const { refresh_token: old_token } = await auth_service.register({
            email: "rotate@example.com",
            password: "password123",
        });

        const rotated = await auth_service.refresh({ refresh_token: old_token });

        expect(rotated.access_token).toBeTruthy();
        expect(rotated.refresh_token).toBeTruthy();
        expect(rotated.refresh_token).not.toBe(old_token);

        await expect(
            auth_service.refresh({ refresh_token: old_token })
        ).rejects.toMatchObject({ status_code: STATUS_CODES.UNAUTHORIZED });

        const rotated_again = await auth_service.refresh({ refresh_token: rotated.refresh_token });
        expect(rotated_again.access_token).toBeTruthy();
    });
});
