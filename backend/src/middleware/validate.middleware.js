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

        // Express 5 turned req.query into a getter with no setter (recomputed from
        // req.url on every access), so a reassignment there is silently dropped -
        // validated/coerced query values have to live on a separate property instead
        if (property === "query") {
            req.validated_query = value;
        } else {
            req[property] = value;
        }

        next();
    };
};

module.exports = validate;
