const errorHandler = (err, req, res, next) => {
    console.error(err);

    const status_code = err.status_code || 500;

    res.status(status_code).json({
        success: false,
        status_code,
        message: err.message || "Internal Server Error",
        result: {
            stack: process.env.DEVELOPMENT ? err.stack : undefined
        },
    });
};

module.exports = errorHandler;
