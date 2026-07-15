const ApiError = require("../utils/ApiError");
const STATUS_CODES = require("../constants/statusCodes");

const validate = (schema, property = "body") => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false,
            stripUnknown: true,
        });

        if (error) {
            const message = error.details.map((detail) => detail.message).join(", ");
            return next(new ApiError(STATUS_CODES.BAD_REQUEST, message));
        }

        req[property] = value;
        next();
    };
};

module.exports = validate;
