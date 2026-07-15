require("dotenv").config();

const REQUIRED_ENV_VARS = ["DATABASE_URL"];

const missing_vars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missing_vars.length > 0) {
    throw new Error(
        `Missing required environment variables: ${missing_vars.join(", ")}`
    );
}

const is_development = ["true", "1"].includes(
    String(process.env.DEVELOPMENT).toLowerCase()
);

const env = {
    NODE_ENV: process.env.NODE_ENV || "development",
    IS_DEVELOPMENT: is_development,
    PORT: process.env.PORT || 5002,
    CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
    DATABASE_URL: process.env.DATABASE_URL,
};

module.exports = env;
