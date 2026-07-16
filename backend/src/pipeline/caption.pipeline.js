const sharp = require("sharp");
const {
    pipeline,
    env: transformers_env,
    RawImage,
} = require("@huggingface/transformers");
const env = require("../config/env");

// Hugging Face's free hosted Inference API no longer serves any image-captioning
// model (confirmed live - api-inference.huggingface.co is decommissioned and
// Salesforce/blip-image-captioning-base has zero live providers). BLIP itself
// is also unsupported by this runtime's model loader, so this is the closest
// available substitute: a real captioning model, self-hosted in-process.
const MODEL_NAME = "Xenova/vit-gpt2-image-captioning";

transformers_env.cacheDir = env.MODEL_CACHE_DIR;

let captioner_promise = null;

const getCaptioner = () => {
    if (!captioner_promise) {
        captioner_promise = pipeline("image-to-text", MODEL_NAME, {
            dtype: "q8",
        });
    }
    return captioner_promise;
};

const generateCaption = async (image_buffer) => {
    const captioner = await getCaptioner();

    let flattened_buffer;
    try {
        // the model loader's own alpha-channel handling is unreliable (throws
        // on 4-channel PNGs), so flatten to a clean 3-channel JPEG ourselves first
        flattened_buffer = await sharp(image_buffer)
            .flatten({ background: "#ffffff" })
            .jpeg()
            .toBuffer();
    } 
    
    catch (err) {
        const error = new Error(`Unable to process image for captioning: ${err.message}`);
        error.is_permanent = true;
        throw error;
    }

    const raw_image = await RawImage.fromBlob(new Blob([flattened_buffer]));
    const result = await captioner(raw_image);

    return result[0].generated_text;
};

module.exports = { MODEL_NAME, generateCaption };
