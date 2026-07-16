const express = require("express");
const notification_controller = require("../controllers/notification.controller");
const auth_middleware = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { list_notifications_query_schema } = require("../validations/notification.validation");

const notification_router = express.Router();

notification_router.use(auth_middleware);

notification_router.get(
    "/",
    validate(list_notifications_query_schema, "query"),
    notification_controller.listNotifications
);
notification_router.post("/:id/read", notification_controller.markAsRead);

module.exports = notification_router;
