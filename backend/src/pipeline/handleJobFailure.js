const prisma_client = require("../utils/prismaClient");
const sse_service = require("../services/sse.service");
const logger = require("../utils/logger");
const JOB_STATUS = require("../constants/jobStatus");

// runPipeline only marks status=failed for permanent errors (it rethrows
// transient ones for BullMQ to retry) - once BullMQ itself has exhausted
// every attempt on a transient error, the job would otherwise stay stuck
// at "processing" forever, so this closes that gap. Extracted out of
// worker.js's "failed" event listener so it's testable without needing to
// mock BullMQ's Worker class itself.
const handleJobFailure = async (job, err) => {
    if (!job) {
        logger.error(`job failed with no job reference: ${err.message}`);
        return;
    }

    logger.error(`job ${job.data.job_id} attempt failed: ${err.message}`);

    if (job.attemptsMade < job.opts.attempts) {
        return;
    }

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
    } catch (update_err) {
        logger.error(
            `failed to mark job ${job.data.job_id} as failed after exhausted retries: ${update_err.message}`
        );
    }
};

module.exports = handleJobFailure;
