const prisma_client = require("../utils/prismaClient");
const storage = require("../services/storage");
const { generateCaption } = require("./caption");
const { analyzeImage, isFlagged } = require("./vision.pipeline");
const JOB_STATUS = require("../constants/jobStatus");
const sse_service = require("../services/sse.service");
const logger = require("../utils/logger");

const NOTIFICATION_TYPE_JOB_FLAGGED = "job_flagged";
const NOTIFICATION_TYPE_JOB_COMPLETED = "job_completed";
const NOTIFICATION_TYPE_JOB_FAILED = "job_failed";

// single entry point for every pickup - fresh, automatic BullMQ retry, or a
// user-triggered Retry click. No separate "first attempt" vs "retry" code path:
// resume point is always re-derived from whatever's already checkpointed in job_result.
const runPipeline = async (job_id) => {
    // scoped so every log line from this call carries job_id - the trace that
    // ties an API request (job.service.js) -> enqueue (queue.service.js) ->
    // this pickup -> each AI call -> completion all together
    const job_logger = logger.child({ job_id });

    const job = await prisma_client.job.findUnique({
        where: { id: job_id },
        include: { result: true },
    });

    if (!job) {
        throw new Error(`Job not found: ${job_id}`);
    }

    // guards against a redelivered/replayed completed job re-running the
    // pipeline and firing a duplicate completion notification + SSE event
    if (job.status === JOB_STATUS.COMPLETED) {
        job_logger.info("job already completed, skipping redelivered pickup");
        return;
    }

    job_logger.info({ attempt: job.attempts + 1 }, "pipeline picked up");

    await prisma_client.job.update({
        where: { id: job_id },
        data: { status: JOB_STATUS.PROCESSING, attempts: { increment: 1 } },
    });
    await sse_service.publishJobUpdate(job.user_id, {
        job_id,
        status: JOB_STATUS.PROCESSING,
    });

    let job_result = job.result;

    const needs_caption = !job_result || job_result.caption === null;
    const needs_vision = !job_result || job_result.labels === null;

    job_logger.info({ needs_caption, needs_vision }, "resume point determined");

    try {
        if (needs_caption || needs_vision) {
            const image_buffer = await storage.getObject(job.storage_key);

            if (needs_caption) {
                job_logger.info("caption stage starting");
                const caption = await generateCaption(image_buffer);
                job_result = await prisma_client.job_result.upsert({
                    where: { job_id },
                    create: { job_id, caption },
                    update: { caption },
                });
                job_logger.info("caption stage done");
            }

            if (needs_vision) {
                job_logger.info("vision stage starting");
                const vision_result = await analyzeImage(image_buffer);
                job_result = await prisma_client.job_result.upsert({
                    where: { job_id },
                    create: { job_id, ...vision_result },
                    update: { ...vision_result },
                });
                job_logger.info({ flagged: vision_result.flagged }, "vision stage done");

                if (vision_result.flagged) {
                    job_logger.info(
                        { flagged_category: vision_result.flagged_category },
                        "job flagged"
                    );
                    await prisma_client.notification.create({
                        data: {
                            user_id: job.user_id,
                            job_id: job.id,
                            type: NOTIFICATION_TYPE_JOB_FLAGGED,
                        },
                    });
                }
            }
        }
    }

    catch (err) {
        await prisma_client.job.update({
            where: { id: job_id },
            data: {
                error: err.message,
                ...(err.is_permanent ? { status: JOB_STATUS.FAILED } : {}),
            },
        });

        if (err.is_permanent) {
            job_logger.error({ err }, "pipeline failed permanently, not retrying");
            await prisma_client.notification.create({
                data: {
                    user_id: job.user_id,
                    job_id: job.id,
                    type: NOTIFICATION_TYPE_JOB_FAILED,
                },
            });
            await sse_service.publishJobUpdate(job.user_id, {
                job_id,
                status: JOB_STATUS.FAILED,
                error: err.message,
            });
            return;
        }

        // transient - rethrow so BullMQ's backoff retries; next attempt re-enters
        // this same function and resumes from whatever got checkpointed above
        job_logger.warn({ err }, "pipeline failed transiently, will retry");
        throw err;
    }

    await prisma_client.job.update({
        where: { id: job_id },
        data: { status: JOB_STATUS.COMPLETED, error: null },
    });

    if (!isFlagged(job_result.safe_search)) {
        await prisma_client.notification.create({
            data: {
                user_id: job.user_id,
                job_id: job.id,
                type: NOTIFICATION_TYPE_JOB_COMPLETED,
            },
        });
    }

    job_logger.info("pipeline completed");

    await sse_service.publishJobUpdate(job.user_id, {
        job_id,
        status: JOB_STATUS.COMPLETED,
    });
};

module.exports = runPipeline;
