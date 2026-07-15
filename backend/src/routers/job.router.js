const express = require("express");
const job_controller = require("../controllers/job.controller");
const auth_middleware = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { uploadSingleImage, verifyImageSignature } = require("../middleware/upload.middleware");
const { list_jobs_query_schema } = require("../validations/job.validation");

const job_router = express.Router();

job_router.use(auth_middleware);

job_router.post("/", uploadSingleImage, verifyImageSignature, job_controller.uploadJob);
job_router.get("/", validate(list_jobs_query_schema, "query"), job_controller.listJobs);
job_router.get("/:id", job_controller.getJob);

module.exports = job_router;
