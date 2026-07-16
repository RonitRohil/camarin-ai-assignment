require("dotenv").config();

const storage_driver = process.env.STORAGE_DRIVER || "local";

const REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "REDIS_URL",
];

if (storage_driver === "r2") {
    REQUIRED_ENV_VARS.push(
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME"
    );
}

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
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    STORAGE_DRIVER: storage_driver,
    LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR || "./uploads",
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    REDIS_URL: process.env.REDIS_URL,
    MODEL_CACHE_DIR: process.env.MODEL_CACHE_DIR || "./.cache/models",
};

module.exports = env;
