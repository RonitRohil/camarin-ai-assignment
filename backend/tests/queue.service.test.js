import { describe, it, expect, vi, beforeEach } from "vitest";

// same require.cache substitution approach as retry.test.js - vi.mock() doesn't
// reach through require() in this CommonJS codebase, and queue.service.js
// constructs a real Queue/IORedis connection at module-load time, so both must
// be stubbed before it's required.
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
    REDIS_URL: "redis://localhost:6379",
});

const mock_bull_job = { retry: vi.fn() };
const mock_queue_add = vi.fn();
const mock_get_job = vi.fn();

class FakeQueue {
    constructor() {
        this.add = mock_queue_add;
        this.getJob = mock_get_job;
    }
}
class FakeIORedis {}

stubModule("bullmq", { Queue: FakeQueue });
stubModule("ioredis", FakeIORedis);

const { retryJob } = require("../src/services/queue.service");

describe("retryJob (Section 2 fix)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("passes resetAttemptsMade so an attempts-exhausted job is actually reprocessed", async () => {
        mock_get_job.mockResolvedValue(mock_bull_job);

        await retryJob("job-1");

        expect(mock_bull_job.retry).toHaveBeenCalledWith({ resetAttemptsMade: true });
    });

    it("falls back to a fresh enqueue when the BullMQ record no longer exists", async () => {
        mock_get_job.mockResolvedValue(undefined);

        await retryJob("job-1");

        expect(mock_bull_job.retry).not.toHaveBeenCalled();
        expect(mock_queue_add).toHaveBeenCalledWith(
            expect.any(String),
            { job_id: "job-1" },
            expect.objectContaining({ jobId: "job-1" })
        );
    });
});
