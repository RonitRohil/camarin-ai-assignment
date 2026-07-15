const env = require("./config/env");
const app = require("./app");
const logger = require("./utils/logger");

app.listen(env.PORT, () => {
    logger.info(`Server is running on port: ${env.PORT}`);
});
