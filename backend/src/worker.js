const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const env = require("./config/env");
const logger = require("./utils/logger");
const runPipeline = require("./pipeline/runPipeline");
const handleJobFailure = require("./pipeline/handleJobFailure");
const { QUEUE_NAME } = require("./constants/queue");

// sequential for now - the self-hosted caption model is a single in-process
// singleton, and concurrent inference calls against it are unverified. Revisit
// once rate-limit-aware concurrency is actually needed (plan section 3.6).
const WORKER_CONCURRENCY = 1;

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        await runPipeline(job.data.job_id);
    },
    { connection, concurrency: WORKER_CONCURRENCY }
);

worker.on("completed", (job) => {
    logger.info(`job ${job.data.job_id} completed`);
});

worker.on("failed", handleJobFailure);

worker.on("error", (err) => {
    logger.error(`worker connection error: ${err.message}`);
});

logger.info("worker started, listening for jobs");

const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down worker gracefully`);
    // waits for the in-flight job's current stage to finish before closing -
    // whatever's not done yet stays checkpointed and resumes on next pickup
    await worker.close();
    process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
