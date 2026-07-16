const env = require("../config/env");
const local_caption = require("./caption.pipeline");
const api_caption = require("./caption.api.pipeline");

const CAPTION_DRIVERS = {
    local: local_caption,
    api: api_caption,
};

const caption = CAPTION_DRIVERS[env.CAPTION_DRIVER];

if (!caption) {
    throw new Error(`Unknown CAPTION_DRIVER: ${env.CAPTION_DRIVER}`);
}

module.exports = caption;
