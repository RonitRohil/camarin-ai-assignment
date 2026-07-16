const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const env = require("./config/env");
const logger = require("./utils/logger");
const prisma_client = require("./utils/prismaClient");
const runPipeline = require("./pipeline/runPipeline");
const JOB_STATUS = require("./constants/jobStatus");
const { QUEUE_NAME } = require("./constants/queue");
const sse_service = require("./services/sse.service");

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

worker.on("failed", async (job, err) => {
    if (!job) {
        logger.error(`job failed with no job reference: ${err.message}`);
        return;
    }

    logger.error(`job ${job.data.job_id} attempt failed: ${err.message}`);

    // runPipeline only marks status=failed for permanent errors (it rethrows
    // transient ones for BullMQ to retry) - once BullMQ itself has exhausted
    // every attempt on a transient error, the job would otherwise stay stuck
    // at "processing" forever, so the worker closes that gap here
    if (job.attemptsMade >= job.opts.attempts) {
        try {
            const updated_job = await prisma_client.job.update({
                where: { id: job.data.job_id },
                data: { status: JOB_STATUS.FAILED, error: err.message },
            });

            await sse_service.publishJobUpdate(updated_job.user_id, {
                job_id: updated_job.id,
                status: JOB_STATUS.FAILED,
                error: err.message,
            });
        } 
        
        catch (update_err) {
            logger.error(
                `failed to mark job ${job.data.job_id} as failed after exhausted retries: ${update_err.message}`
            );
        }
    }
});

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
