const job_service = require("../services/job.service");
const sse_service = require("../services/sse.service");
const STATUS_CODES = require("../constants/statusCodes");

const SSE_HEARTBEAT_INTERVAL_MS = 20000;

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

exports.streamJobUpdates = (req, res) => {
    res.writeHead(STATUS_CODES.OK, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // establishes the stream immediately - some proxies buffer the response
    // until the first byte arrives, which would otherwise delay the client's
    // "connected" state indefinitely on an idle channel
    res.write(": connected\n\n");

    const unsubscribe = sse_service.subscribeUser(req.user_id, res);

    const heartbeat_interval = setInterval(() => {
        res.write(": heartbeat\n\n");
    }, SSE_HEARTBEAT_INTERVAL_MS);

    req.on("close", () => {
        clearInterval(heartbeat_interval);
        unsubscribe();
    });
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

exports.retryJob = async (req, res, next) => {
    try {
        const job = await job_service.retryJob({
            user_id: req.user_id,
            job_id: req.params.id,
        });

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "job queued for retry",
            result: { job },
        });
    } catch (err) {
        next(err);
    }
};
