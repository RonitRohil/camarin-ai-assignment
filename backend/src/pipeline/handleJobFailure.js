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
        logger.error({ err }, "job failed with no job reference");
        return;
    }

    const job_id = job.data.job_id;
    const job_logger = logger.child({ job_id });

    job_logger.error(
        { err, attempts_made: job.attemptsMade, max_attempts: job.opts.attempts },
        "job attempt failed"
    );

    if (job.attemptsMade < job.opts.attempts) {
        return;
    }

    try {
        const updated_job = await prisma_client.job.update({
            where: { id: job_id },
            data: { status: JOB_STATUS.FAILED, error: err.message },
        });

        job_logger.error("retries exhausted, job marked failed");

        await sse_service.publishJobUpdate(updated_job.user_id, {
            job_id: updated_job.id,
            status: JOB_STATUS.FAILED,
            error: err.message,
        });
    } catch (update_err) {
        job_logger.error({ err: update_err }, "failed to mark job as failed after exhausted retries");
    }
};

module.exports = handleJobFailure;
