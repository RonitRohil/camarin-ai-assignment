const pino = require("pino");
const env = require("../config/env");

const logger = pino({
    level: env.IS_DEVELOPMENT ? "debug" : "info",
    transport: env.IS_DEVELOPMENT
        ? {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard" },
          }
        : undefined,
});

module.exports = logger;
