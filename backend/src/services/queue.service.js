const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const env = require("../config/env");
const {
    QUEUE_NAME,
    JOB_NAME,
    MAX_ATTEMPTS,
    BACKOFF_BASE_DELAY_MS,
} = require("../constants/queue");

// BullMQ requires this on the underlying ioredis connection, otherwise blocking
// commands (used internally by BullMQ) can silently retry forever
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const image_processing_queue = new Queue(QUEUE_NAME, { connection });

const enqueueJob = async (job_id) => {
    await image_processing_queue.add(
        JOB_NAME,
        { job_id },
        {
            // reusing our own job id as BullMQ's jobId makes retry-button
            // re-enqueues idempotent instead of creating a duplicate queue entry
            jobId: job_id,
            attempts: MAX_ATTEMPTS,
            backoff: { type: "exponential", delay: BACKOFF_BASE_DELAY_MS },
            removeOnComplete: true,
            removeOnFail: false,
        }
    );
};

module.exports = {
    image_processing_queue,
    enqueueJob,
};
