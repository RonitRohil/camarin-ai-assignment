const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const env = require("./config/env");
const logger = require("./utils/logger");
const runPipeline = require("./pipeline/runPipeline");
const handleJobFailure = require("./pipeline/handleJobFailure");
const { QUEUE_NAME } = require("./constants/queue");

// Concurrency math (plan section 3.6):
//
// Google Vision is NOT the binding constraint. Its default quota is ~1800
// requests/min. Even at concurrency=10, worst case is ~10 Vision calls every
// 1-2s (the time a job spends in that stage) - roughly 300-600 req/min,
// comfortably under 20-30% of quota. Vision alone would tolerate far higher
// concurrency than anything below is actually set to.
//
// The self-hosted caption model is the real constraint, and it's a memory one,
// not a correctness one - concurrent calls against the in-process singleton
// were verified safe (15 concurrent calls across 5 rounds, visually distinct
// images, zero cross-contamination vs. a sequential baseline). But elapsed
// time for 3 concurrent calls (~4.6s) was roughly what 3 *sequential* calls
// take, suggesting the ONNX runtime doesn't meaningfully parallelize CPU
// inference within one process - so raising this doesn't buy much caption
// throughput. What it does buy: overlapping one job's I/O-bound Vision call
// with another job's CPU-bound captioning, instead of the event loop sitting
// idle on the network round trip. Measured RSS at concurrency=3 was ~890MB
// (vs ~735MB at concurrency=1) - real memory cost for a benefit that's about
// I/O overlap, not raw parallel speedup, so this stays modest rather than
// pushed to the verified ceiling.
const WORKER_CONCURRENCY = 2;

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        await runPipeline(job.data.job_id);
    },
    { connection, concurrency: WORKER_CONCURRENCY }
);

worker.on("completed", (job) => {
    logger.info({ job_id: job.data.job_id }, "worker marked job completed");
});

worker.on("failed", handleJobFailure);

worker.on("error", (err) => {
    logger.error({ err }, "worker connection error");
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
