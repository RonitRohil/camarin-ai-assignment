const env = require("../config/env");

const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";
const FLAGGED_LIKELIHOODS = ["LIKELY", "VERY_LIKELY"];

const analyzeImage = async (image_buffer) => {
    const base64_content = image_buffer.toString("base64");

    const response = await fetch(`${VISION_API_URL}?key=${env.GOOGLE_VISION_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            requests: [
                {
                    image: { content: base64_content },
                    // one call, two logically tracked stages (labels + safety) -
                    // Vision returns both from a single batchAnnotateImages request
                    features: [
                        { type: "LABEL_DETECTION" },
                        { type: "SAFE_SEARCH_DETECTION" },
                    ],
                },
            ],
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data?.error?.message || "Google Vision request failed");
        // 429 (quota) is worth retrying; other 4xx (bad image, bad auth/billing) is not
        error.is_permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
        throw error;
    }

    const result = data.responses?.[0];

    if (result?.error) {
        const error = new Error(result.error.message || "Google Vision annotation failed");
        error.is_permanent = true;
        throw error;
    }

    const labels = (result.labelAnnotations || []).map((label) => ({
        description: label.description,
        score: label.score,
    }));

    const safe_search = result.safeSearchAnnotation || {};

    const flagged_category = Object.entries(safe_search).find(([, likelihood]) =>
        FLAGGED_LIKELIHOODS.includes(likelihood)
    )?.[0];

    return {
        labels,
        safe_search,
        flagged: Boolean(flagged_category),
        flagged_category: flagged_category || null,
    };
};

module.exports = { analyzeImage };
