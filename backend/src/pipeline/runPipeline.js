const prisma_client = require("../utils/prismaClient");
const storage = require("../services/storage");
const { generateCaption } = require("./caption.pipeline");
const { analyzeImage } = require("./vision.pipeline");
const JOB_STATUS = require("../constants/jobStatus");

const NOTIFICATION_TYPE_JOB_FLAGGED = "job_flagged";

// single entry point for every pickup - fresh, automatic BullMQ retry, or a
// user-triggered Retry click. No separate "first attempt" vs "retry" code path:
// resume point is always re-derived from whatever's already checkpointed in job_result.
const runPipeline = async (job_id) => {
    const job = await prisma_client.job.findUnique({
        where: { id: job_id },
        include: { result: true },
    });

    if (!job) {
        throw new Error(`Job not found: ${job_id}`);
    }

    await prisma_client.job.update({
        where: { id: job_id },
        data: { status: JOB_STATUS.PROCESSING, attempts: { increment: 1 } },
    });
    // TODO: publish "processing" status via sse.service.js once built

    let job_result = job.result;

    const needs_caption = !job_result || job_result.caption === null;
    const needs_vision = !job_result || job_result.labels === null;

    try {
        if (needs_caption || needs_vision) {
            const image_buffer = await storage.getObject(job.storage_key);

            if (needs_caption) {
                const caption = await generateCaption(image_buffer);
                job_result = await prisma_client.job_result.upsert({
                    where: { job_id },
                    create: { job_id, caption },
                    update: { caption },
                });
            }

            if (needs_vision) {
                const vision_result = await analyzeImage(image_buffer);
                job_result = await prisma_client.job_result.upsert({
                    where: { job_id },
                    create: { job_id, ...vision_result },
                    update: { ...vision_result },
                });

                if (vision_result.flagged) {
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
            // TODO: publish "failed" status via sse.service.js once built
            return;
        }

        // transient - rethrow so BullMQ's backoff retries; next attempt re-enters
        // this same function and resumes from whatever got checkpointed above
        throw err;
    }

    await prisma_client.job.update({
        where: { id: job_id },
        data: { status: JOB_STATUS.COMPLETED, error: null },
    });
    // TODO: publish "completed" status via sse.service.js once built
};

module.exports = runPipeline;
