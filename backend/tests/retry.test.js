import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock() only intercepts ESM import - it never reaches through a nested
// require() inside a CommonJS file (confirmed empirically), and every source
// file in this project uses require() internally. require.cache substitution
// is the mechanism that actually works: pre-populate the cache entry for a
// dependency BEFORE the module under test requires it, so Node's own
// resolution hands back the stub instead of ever loading the real file.
const stubModule = (relative_path, exports_value) => {
    const resolved = require.resolve(relative_path);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exports_value,
    };
};

stubModule("../src/config/env", {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    REDIS_URL: "redis://localhost:6379",
    GOOGLE_VISION_API_KEY: "test-vision-key",
    MODEL_CACHE_DIR: "./.cache/models",
    CAPTION_DRIVER: "local",
    HF_ACCESS_TOKEN: "test-hf-token",
    COMBINED_MODE: false,
});

const mock_prisma = {
    job: { findUnique: vi.fn(), update: vi.fn() },
    job_result: { upsert: vi.fn() },
    notification: { create: vi.fn() },
};
const mock_storage = { getObject: vi.fn() };
const mock_generate_caption = vi.fn();
const mock_analyze_image = vi.fn();
const mock_publish_job_update = vi.fn();

// real logic, not a hand-set mock - mirrors vision.pipeline.js's own isFlagged
// exactly, so it stays consistent with whatever safe_search each test's
// analyzeImage mock returns, rather than needing separate bookkeeping
const FLAGGED_LIKELIHOODS = ["LIKELY", "VERY_LIKELY"];
const isFlagged = (safe_search) =>
    Object.values(safe_search || {}).some((likelihood) => FLAGGED_LIKELIHOODS.includes(likelihood));

stubModule("../src/utils/prismaClient", mock_prisma);
stubModule("../src/services/storage", mock_storage);
stubModule("../src/pipeline/caption.pipeline", { generateCaption: mock_generate_caption });
stubModule("../src/pipeline/vision.pipeline", { analyzeImage: mock_analyze_image, isFlagged });
stubModule("../src/services/sse.service", { publishJobUpdate: mock_publish_job_update });

const runPipeline = require("../src/pipeline/runPipeline");
const handleJobFailure = require("../src/pipeline/handleJobFailure");
const JOB_STATUS = require("../src/constants/jobStatus");

const BASE_JOB = {
    id: "job-1",
    user_id: "user-1",
    storage_key: "user-1/image.png",
};

const findFailedUpdateCall = () =>
    mock_prisma.job.update.mock.calls.find(([arg]) => arg.data.status === JOB_STATUS.FAILED);

describe("runPipeline - checkpoint/resume logic", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mock_prisma.job.update.mockImplementation(async ({ data }) => ({ ...BASE_JOB, ...data }));
        mock_prisma.job_result.upsert.mockImplementation(async ({ create }) => create);
        mock_storage.getObject.mockResolvedValue(Buffer.from("fake-image-bytes"));
    });

    it("runs both stages fresh when no job_result exists yet", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({ ...BASE_JOB, result: null });
        mock_generate_caption.mockResolvedValue("a caption");
        mock_analyze_image.mockResolvedValue({
            labels: [{ description: "Dog", score: 0.9 }],
            safe_search: { adult: "VERY_UNLIKELY" },
            flagged: false,
            flagged_category: null,
        });

        await runPipeline("job-1");

        expect(mock_generate_caption).toHaveBeenCalledTimes(1);
        expect(mock_analyze_image).toHaveBeenCalledTimes(1);
        expect(mock_prisma.job.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: JOB_STATUS.COMPLETED }) })
        );
        expect(mock_prisma.notification.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ type: "job_completed" }) })
        );
    });

    it("resumes from checkpoint: skips caption when already persisted, only runs the remaining stage", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({
            ...BASE_JOB,
            result: { caption: "already done", labels: null },
        });
        mock_analyze_image.mockResolvedValue({
            labels: [{ description: "Cat", score: 0.9 }],
            safe_search: { adult: "VERY_UNLIKELY" },
            flagged: false,
            flagged_category: null,
        });

        await runPipeline("job-1");

        expect(mock_generate_caption).not.toHaveBeenCalled();
        expect(mock_analyze_image).toHaveBeenCalledTimes(1);
        // the checkpointed caption must not be re-fetched/overwritten
        expect(mock_prisma.job_result.upsert).toHaveBeenCalledTimes(1);
    });

    it("does nothing (no image fetch, no AI calls) when every stage is already checkpointed", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({
            ...BASE_JOB,
            result: { caption: "done", labels: [{ description: "x" }] },
        });

        await runPipeline("job-1");

        expect(mock_storage.getObject).not.toHaveBeenCalled();
        expect(mock_generate_caption).not.toHaveBeenCalled();
        expect(mock_analyze_image).not.toHaveBeenCalled();
        expect(mock_prisma.job.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: JOB_STATUS.COMPLETED }) })
        );
    });

    it("returns immediately without reprocessing when the job is already completed", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({
            ...BASE_JOB,
            status: JOB_STATUS.COMPLETED,
            result: { caption: "done", labels: [{ description: "x" }] },
        });

        await runPipeline("job-1");

        expect(mock_prisma.job.update).not.toHaveBeenCalled();
        expect(mock_prisma.notification.create).not.toHaveBeenCalled();
        expect(mock_publish_job_update).not.toHaveBeenCalled();
    });

    it("creates a notification when the vision stage returns flagged=true", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({ ...BASE_JOB, result: null });
        mock_generate_caption.mockResolvedValue("a caption");
        mock_analyze_image.mockResolvedValue({
            labels: [],
            safe_search: { adult: "LIKELY" },
            flagged: true,
            flagged_category: "adult",
        });

        await runPipeline("job-1");

        // exactly one notification (job_flagged) - a flagged completion should
        // not also fire the separate job_completed notification
        expect(mock_prisma.notification.create).toHaveBeenCalledTimes(1);
        expect(mock_prisma.notification.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ user_id: "user-1", job_id: "job-1", type: "job_flagged" }),
            })
        );
    });

    it("creates a job_completed (not job_flagged) notification when nothing is flagged", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({ ...BASE_JOB, result: null });
        mock_generate_caption.mockResolvedValue("a caption");
        mock_analyze_image.mockResolvedValue({
            labels: [],
            safe_search: { adult: "VERY_UNLIKELY" },
            flagged: false,
            flagged_category: null,
        });

        await runPipeline("job-1");

        expect(mock_prisma.notification.create).toHaveBeenCalledTimes(1);
        expect(mock_prisma.notification.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ type: "job_completed" }),
            })
        );
    });

    it("marks the job failed WITHOUT rethrowing on a permanent error, and skips remaining stages", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({ ...BASE_JOB, result: null });
        const permanent_error = new Error("bad image");
        permanent_error.is_permanent = true;
        mock_generate_caption.mockRejectedValue(permanent_error);

        await expect(runPipeline("job-1")).resolves.toBeUndefined();

        expect(findFailedUpdateCall()).toBeTruthy();
        expect(findFailedUpdateCall()[0].data.error).toBe("bad image");
        expect(mock_analyze_image).not.toHaveBeenCalled();
        expect(mock_prisma.notification.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ user_id: "user-1", job_id: "job-1", type: "job_failed" }),
            })
        );
    });

    it("rethrows transient errors and does NOT mark the job failed - BullMQ's backoff owns the retry", async () => {
        mock_prisma.job.findUnique.mockResolvedValue({ ...BASE_JOB, result: null });
        mock_generate_caption.mockRejectedValue(new Error("network blip"));

        await expect(runPipeline("job-1")).rejects.toThrow("network blip");

        expect(findFailedUpdateCall()).toBeUndefined();
    });

    it("throws if the job doesn't exist", async () => {
        mock_prisma.job.findUnique.mockResolvedValue(null);

        await expect(runPipeline("missing-job")).rejects.toThrow("Job not found");
    });
});

describe("handleJobFailure - worker-level exhausted-retries safety net", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const makeBullJob = ({ attemptsMade, attempts }) => ({
        data: { job_id: "job-1" },
        attemptsMade,
        opts: { attempts },
    });

    it("marks the job failed once BullMQ has exhausted every attempt", async () => {
        mock_prisma.job.update.mockResolvedValue({ id: "job-1", user_id: "user-1" });

        await handleJobFailure(makeBullJob({ attemptsMade: 3, attempts: 3 }), new Error("still broken"));

        expect(mock_prisma.job.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "job-1" },
                data: { status: JOB_STATUS.FAILED, error: "still broken" },
            })
        );
        expect(mock_publish_job_update).toHaveBeenCalledWith(
            "user-1",
            expect.objectContaining({ job_id: "job-1", status: JOB_STATUS.FAILED })
        );
    });

    it("does NOT mark the job failed while attempts remain - BullMQ will retry again", async () => {
        await handleJobFailure(makeBullJob({ attemptsMade: 1, attempts: 3 }), new Error("transient blip"));

        expect(mock_prisma.job.update).not.toHaveBeenCalled();
        expect(mock_publish_job_update).not.toHaveBeenCalled();
    });

    it("does not throw when called with no job reference", async () => {
        await expect(handleJobFailure(null, new Error("no job"))).resolves.toBeUndefined();
        expect(mock_prisma.job.update).not.toHaveBeenCalled();
    });
});

describe("queue backoff configuration (ADR-2)", () => {
    it("matches the documented policy: 3 attempts, exponential backoff, 5s base delay", () => {
        const { MAX_ATTEMPTS, BACKOFF_BASE_DELAY_MS } = require("../src/constants/queue");

        expect(MAX_ATTEMPTS).toBe(3);
        expect(BACKOFF_BASE_DELAY_MS).toBe(5000);
    });
});
