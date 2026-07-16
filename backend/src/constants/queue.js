const QUEUE_NAME = "image-processing";
const JOB_NAME = "process-image";
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_DELAY_MS = 5000;

module.exports = { QUEUE_NAME, JOB_NAME, MAX_ATTEMPTS, BACKOFF_BASE_DELAY_MS };
