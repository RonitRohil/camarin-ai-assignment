const fs = require("fs/promises");
const path = require("path");
const env = require("../../config/env");

const putObject = async (storage_key, buffer, mime_type) => {
    const file_path = path.resolve(env.LOCAL_STORAGE_DIR, storage_key);
    await fs.mkdir(path.dirname(file_path), { recursive: true });
    await fs.writeFile(file_path, buffer);
};

const getObject = async (storage_key) => {
    const file_path = path.resolve(env.LOCAL_STORAGE_DIR, storage_key);
    return fs.readFile(file_path);
};

const getSignedUrl = async (storage_key) => {
    // no real signed-URL concept on disk - local dev has no route serving these yet,
    // this is just here so callers don't need to know which driver is active
    return `/uploads/${storage_key}`;
};

module.exports = { putObject, getObject, getSignedUrl };
