const job_service = require("../services/job.service");
const STATUS_CODES = require("../constants/statusCodes");

exports.uploadJob = async (req, res, next) => {
    try {
        const job = await job_service.createJob({
            user_id: req.user_id,
            file: req.file,
        });

        res.status(STATUS_CODES.ACCEPTED).json({
            success: true,
            status_code: STATUS_CODES.ACCEPTED,
            message: "job created and queued for processing",
            result: { job_id: job.id },
        });
    } 
    
    catch (err) {
        next(err);
    }
};

exports.listJobs = async (req, res, next) => {
    try {
        const { status, page, limit } = req.validated_query;

        const result = await job_service.listJobs({
            user_id: req.user_id,
            status,
            page,
            limit,
        });

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "jobs fetched successfully",
            result,
        });
    }

    catch (err) {
        next(err);
    }
};

exports.getJob = async (req, res, next) => {
    try {
        const job = await job_service.getJobById({
            user_id: req.user_id,
            job_id: req.params.id,
        });

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "job fetched successfully",
            result: { job },
        });
    }

    catch (err) {
        next(err);
    }
};
