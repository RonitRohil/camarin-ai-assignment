const env = require("../config/env");

const HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";

// Verified against the router's own live catalog (GET /v1/models), not just the
// model-info API's inferenceProviderMapping field - that field claimed
// Qwen2.5-VL-3B-Instruct was "live" on featherless-ai after it had actually been
// delisted, which the model-info endpoint never reflected. The /v1/models list is
// what the router actually honors, so that's the source of truth for this pick.
const MODEL_NAME = "Qwen/Qwen3-VL-30B-A3B-Instruct";

const CAPTION_PROMPT = "Describe this image in one concise sentence. Output only the caption, nothing else.";

const generateCaption = async (image_buffer) => {
    const base64_content = image_buffer.toString("base64");

    const response = await fetch(HF_ROUTER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.HF_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            model: MODEL_NAME,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: CAPTION_PROMPT },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64_content}` } },
                    ],
                },
            ],
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data?.error?.message || "Hugging Face captioning request failed");
        // 429 (rate limit) is worth retrying; other 4xx (bad image, bad auth) is not
        error.is_permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
        throw error;
    }

    const caption = data?.choices?.[0]?.message?.content?.trim();

    if (!caption) {
        const error = new Error("Hugging Face captioning response had no content");
        error.is_permanent = true;
        throw error;
    }

    return caption;
};

module.exports = { MODEL_NAME, generateCaption };
