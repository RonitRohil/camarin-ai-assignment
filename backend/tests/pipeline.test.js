import { describe, it, expect, vi, afterEach } from "vitest";
const zlib = require("zlib");

// vi.mock() only intercepts ESM import - it never reaches through a nested
// require() inside a CommonJS file (confirmed empirically), and every source
// file in this project uses require() internally. require.cache substitution
// is the mechanism that actually works here: pre-populate the cache entry for
// a dependency BEFORE the module under test requires it, so Node's own
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
});

const mock_captioner = vi.fn(async () => [{ generated_text: "a mocked caption" }]);
const mock_pipeline_fn = vi.fn(async () => mock_captioner);

stubModule("@huggingface/transformers", {
    pipeline: (...args) => mock_pipeline_fn(...args),
    env: {},
    RawImage: {
        fromBlob: vi.fn(async () => ({ mocked_raw_image: true })),
    },
});

const { generateCaption } = require("../src/pipeline/caption.pipeline");
const { analyzeImage } = require("../src/pipeline/vision.pipeline");

// minimal valid RGB (no alpha) PNG, built without any image library dependency
function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const type_buf = Buffer.from(type, "ascii");
    const crc_buf = Buffer.alloc(4);
    crc_buf.writeUInt32BE(crc32(Buffer.concat([type_buf, data])), 0);
    return Buffer.concat([len, type_buf, data, crc_buf]);
}
function makeRgbPng() {
    const width = 4;
    const height = 4;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const row_size = 1 + width * 3;
    const raw = Buffer.alloc(row_size * height);
    const idat = zlib.deflateSync(raw);
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([
        sig,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", idat),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

describe("caption.pipeline", () => {
    it("returns the model's generated caption, loading the model only once across repeated calls", async () => {
        const caption_a = await generateCaption(makeRgbPng());
        const caption_b = await generateCaption(makeRgbPng());

        expect(caption_a).toBe("a mocked caption");
        expect(caption_b).toBe("a mocked caption");
        // singleton: the model pipeline() must not be reloaded on every call
        expect(mock_pipeline_fn).toHaveBeenCalledTimes(1);
    });

    it("throws a permanent error when the image can't be processed", async () => {
        const corrupt_buffer = Buffer.from("this is not an image at all");

        await expect(generateCaption(corrupt_buffer)).rejects.toMatchObject({
            is_permanent: true,
        });
    });
});

describe("vision.pipeline", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const stubFetch = (response) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => response)
        );
    };

    it("parses labels and safe search, flagged=false when nothing is likely/very_likely", async () => {
        stubFetch({
            ok: true,
            status: 200,
            json: async () => ({
                responses: [
                    {
                        labelAnnotations: [{ description: "Cat", score: 0.98 }],
                        safeSearchAnnotation: {
                            adult: "VERY_UNLIKELY",
                            spoof: "VERY_UNLIKELY",
                            medical: "VERY_UNLIKELY",
                            violence: "VERY_UNLIKELY",
                            racy: "VERY_UNLIKELY",
                        },
                    },
                ],
            }),
        });

        const result = await analyzeImage(Buffer.from("fake-image-bytes"));

        expect(result.labels).toEqual([{ description: "Cat", score: 0.98 }]);
        expect(result.flagged).toBe(false);
        expect(result.flagged_category).toBeNull();
    });

    it("flags the job and reports the correct category when a SafeSearch category is LIKELY", async () => {
        stubFetch({
            ok: true,
            status: 200,
            json: async () => ({
                responses: [
                    {
                        labelAnnotations: [],
                        safeSearchAnnotation: {
                            adult: "LIKELY",
                            spoof: "VERY_UNLIKELY",
                            medical: "VERY_UNLIKELY",
                            violence: "VERY_UNLIKELY",
                            racy: "VERY_UNLIKELY",
                        },
                    },
                ],
            }),
        });

        const result = await analyzeImage(Buffer.from("fake-image-bytes"));

        expect(result.flagged).toBe(true);
        expect(result.flagged_category).toBe("adult");
    });

    it("treats 4xx errors (other than 429) as permanent - no point retrying a bad request", async () => {
        stubFetch({
            ok: false,
            status: 403,
            json: async () => ({ error: { message: "billing not enabled" } }),
        });

        await expect(analyzeImage(Buffer.from("fake"))).rejects.toMatchObject({
            is_permanent: true,
        });
    });

    it("treats 429 (rate limit) as transient, worth retrying", async () => {
        stubFetch({
            ok: false,
            status: 429,
            json: async () => ({ error: { message: "quota exceeded" } }),
        });

        await expect(analyzeImage(Buffer.from("fake"))).rejects.toMatchObject({
            is_permanent: false,
        });
    });

    it("treats 5xx errors as transient", async () => {
        stubFetch({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: "internal error" } }),
        });

        await expect(analyzeImage(Buffer.from("fake"))).rejects.toMatchObject({
            is_permanent: false,
        });
    });
});
