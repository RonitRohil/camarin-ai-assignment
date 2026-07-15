const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookie_parser = require("cookie-parser");
const env = require("./config/env");
const STATUS_CODES = require("./constants/statusCodes");
const error_handler = require("./middleware/errorHandler");
const auth_router = require("./routers/auth.router");

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
