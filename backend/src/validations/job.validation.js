const Joi = require("joi");
const JOB_STATUS = require("../constants/jobStatus");

const list_jobs_query_schema = Joi.object({
    status: Joi.string().valid(...Object.values(JOB_STATUS)),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
});

module.exports = { list_jobs_query_schema };
