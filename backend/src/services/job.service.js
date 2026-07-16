const crypto = require("crypto");
const path = require("path");
const prisma_client = require("../utils/prismaClient");
const storage = require("./storage");
const queue_service = require("./queue.service");
const JOB_STATUS = require("../constants/jobStatus");
const STATUS_CODES = require("../constants/statusCodes");
const ApiError = require("../utils/ApiError");

const buildStorageKey = (user_id, original_filename) => {
    const extension = path.extname(original_filename);
    return `${user_id}/${crypto.randomUUID()}${extension}`;
};

exports.createJob = async ({ user_id, file }) => {
    const storage_key = buildStorageKey(user_id, file.originalname);
    const mime_type = file.detected_mime_type || file.mimetype;

    await storage.putObject(storage_key, file.buffer, mime_type);

    const job = await prisma_client.job.create({
        data: {
            user_id,
            filename: file.originalname,
            storage_key,
            mime_type,
            size_bytes: file.size,
            status: JOB_STATUS.PENDING,
        },
    });

    await queue_service.enqueueJob(job.id);

    return job;
};

exports.listJobs = async ({ user_id, status, page, limit }) => {
    const where = { user_id, ...(status ? { status } : {}) };

    const [jobs, total] = await Promise.all([
        prisma_client.job.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            include: {
                result: {
                    select: { flagged: true, flagged_category: true },
                },
            },
        }),
        prisma_client.job.count({ where }),
    ]);

    return {
        jobs,
        pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
        },
    };
};

exports.getJobById = async ({ user_id, job_id }) => {
    const job = await prisma_client.job.findFirst({
        where: { id: job_id, user_id },
        include: { result: true },
    });

    if (!job) {
        throw new ApiError(STATUS_CODES.NOT_FOUND, "Job not found");
    }

    const image_url = await storage.getSignedUrl(job.storage_key);

    return { ...job, image_url };
};

exports.retryJob = async ({ user_id, job_id }) => {
    const job = await prisma_client.job.findFirst({
        where: { id: job_id, user_id },
    });

    if (!job) {
        throw new ApiError(STATUS_CODES.NOT_FOUND, "Job not found");
    }

    if (job.status !== JOB_STATUS.FAILED) {
        throw new ApiError(STATUS_CODES.CONFLICT, "Only failed jobs can be retried");
    }

    const updated_job = await prisma_client.job.update({
        where: { id: job_id },
        data: { status: JOB_STATUS.PENDING, attempts: 0, error: null },
    });

    await queue_service.retryJob(job_id);

    return updated_job;
};
