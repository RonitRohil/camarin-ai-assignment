const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookie_parser = require("cookie-parser");
const env = require("./config/env");
const STATUS_CODES = require("./constants/statusCodes");
const error_handler = require("./middleware/errorHandler");
const auth_router = require("./routers/auth.router");
const job_router = require("./routers/job.router");
const notification_router = require("./routers/notification.router");

const app = express();

app.use(helmet());

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
if (env.STORAGE_DRIVER === "local") {
    app.use("/uploads", express.static(env.LOCAL_STORAGE_DIR));
}

app.get("/health", (req, res) => {
    res.status(STATUS_CODES.OK).json({
        success: true,
        status_code: STATUS_CODES.OK,
        message: "ok",
        result: {},
    });
});

app.get("/ready", (req, res) => {
    res.status(STATUS_CODES.OK).json({
        success: true,
        status_code: STATUS_CODES.OK,
        message: "ok",
        result: {},
    });
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
