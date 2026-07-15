const env = require("../../config/env");
const local_storage = require("./local.storage");
const r2_storage = require("./r2.storage");

const STORAGE_DRIVERS = {
    local: local_storage,
    r2: r2_storage,
};

const storage = STORAGE_DRIVERS[env.STORAGE_DRIVER];

if (!storage) {
    throw new Error(`Unknown STORAGE_DRIVER: ${env.STORAGE_DRIVER}`);
}

module.exports = storage;
