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

// re-queues an existing (already failed) BullMQ job via its own retry() API,
// rather than queue.add() with the same jobId - that record still exists since
// removeOnFail is false, and add() would just collide with it. Falls back to a
// fresh enqueue if the BullMQ record is somehow gone (e.g. manually cleared).
const retryJob = async (job_id) => {
    const bull_job = await image_processing_queue.getJob(job_id);

    if (bull_job) {
        await bull_job.retry();
    } else {
        await enqueueJob(job_id);
    }
};

module.exports = {
    image_processing_queue,
    enqueueJob,
    retryJob,
};
