const Joi = require("joi");

const list_notifications_query_schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
});

module.exports = { list_notifications_query_schema };
