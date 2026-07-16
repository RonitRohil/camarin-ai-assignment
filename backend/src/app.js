const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookie_parser = require("cookie-parser");
const pino_http = require("pino-http");
const env = require("./config/env");
const STATUS_CODES = require("./constants/statusCodes");
const error_handler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const prisma_client = require("./utils/prismaClient");
const { checkRedisConnection } = require("./services/queue.service");
const auth_router = require("./routers/auth.router");
const job_router = require("./routers/job.router");
const notification_router = require("./routers/notification.router");

const app = express();

app.use(helmet());

// structured, per-request logging (auto-generates a req.id) - shares the same
// pino instance/transport as everything else, so a request's log lines and a
// job's log lines (see pipeline/runPipeline.js) end up in the same stream.
// Trimmed serializers - pino-http's defaults dump the full req/res objects
// (every response header, including the whole CSP string) on every line
app.use(
    pino_http({
        logger,
        serializers: {
            req: (req) => ({ id: req.id, method: req.method, url: req.url }),
            res: (res) => ({ status_code: res.statusCode }),
        },
    })
);

app.use(
    cors({
        origin: env.CORS_ORIGIN,
        credentials: true,
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookie_parser());

// local storage's getSignedUrl (services/storage/local.storage.js) just returns
// `/uploads/:key` - this is what actually serves that path in dev. R2 doesn't need
// this, its signed URLs point directly at Cloudflare.
// helmet's default Cross-Origin-Resource-Policy (same-origin) blocks the frontend
// (localhost:5173) from loading <img> served from the API (localhost:5002), so it's
// relaxed just for this route rather than globally.
if (env.STORAGE_DRIVER === "local") {
    app.use(
        "/uploads",
        (req, res, next) => {
            res.set("Cross-Origin-Resource-Policy", "cross-origin");
            next();
        },
        express.static(env.LOCAL_STORAGE_DIR)
    );
}

app.get("/health", (req, res) => {
    res.status(STATUS_CODES.OK).json({
        success: true,
        status_code: STATUS_CODES.OK,
        message: "ok",
        result: {},
    });
});

app.get("/ready", async (req, res) => {
    try {
        await prisma_client.$queryRaw`SELECT 1`;

        const redis_ok = await checkRedisConnection();
        if (!redis_ok) {
            throw new Error("Redis ping did not return PONG");
        }

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "ready",
            result: {},
        });
    }

    catch (err) {
        logger.error({ err }, "readiness check failed");
        res.status(STATUS_CODES.SERVICE_UNAVAILABLE).json({
            success: false,
            status_code: STATUS_CODES.SERVICE_UNAVAILABLE,
            message: "not ready",
            result: {},
        });
    }
});

app.use("/auth", auth_router);
app.use("/jobs", job_router);
app.use("/notifications", notification_router);

app.use((req, res) => {
    res.status(STATUS_CODES.NOT_FOUND).json({
        success: false,
        status_code: STATUS_CODES.NOT_FOUND,
        message: "route not found",
        result: {},
    });
});

app.use(error_handler);

module.exports = app;
