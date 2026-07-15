const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookie_parser = require("cookie-parser");
const error_handler = require("./middleware/errorHandler");

const app = express();

app.use(helmet());

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:5173",
        credentials: true,
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookie_parser());

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        status_code: 200,
        message: "ok",
        result: {},
    });
});

app.get("/ready", (req, res) => {
    res.status(200).json({
        success: true,
        status_code: 200,
        message: "ok",
        result: {},
    });
});

// routers get mounted here, one by one, as each is built

app.use((req, res) => {
    res.status(404).json({
        success: false,
        status_code: 404,
        message: "route not found",
        result: {},
    });
});

app.use(error_handler);

module.exports = app;
