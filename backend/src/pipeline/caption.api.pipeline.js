const env = require("../config/env");

const HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";

// Qwen2.5-VL-7B/32B and Llama-3.2-11B-Vision have zero live inferenceProviderMapping
// entries (checked directly against HF's own API, same as the BLIP investigation) -
// the 3B variant is the smallest/only one currently live, on featherless-ai.
const MODEL_NAME = "Qwen/Qwen2.5-VL-3B-Instruct";

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
