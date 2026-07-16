const env = require("./config/env");
const app = require("./app");
const logger = require("./utils/logger");

app.listen(env.PORT, () => {
    logger.info(`Server is running on port: ${env.PORT}`);

    if (env.COMBINED_MODE) {
        logger.info("COMBINED_MODE enabled, starting worker in-process");
        require("./worker");
    }
});
