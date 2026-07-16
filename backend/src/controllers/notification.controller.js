const notification_service = require("../services/notification.service");
const STATUS_CODES = require("../constants/statusCodes");

exports.listNotifications = async (req, res, next) => {
    try {
        const { page, limit } = req.validated_query;

        const result = await notification_service.listNotifications({
            user_id: req.user_id,
            page,
            limit,
        });

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "notifications fetched successfully",
            result,
        });
    } catch (err) {
        next(err);
    }
};

exports.markAsRead = async (req, res, next) => {
    try {
        const notification = await notification_service.markAsRead({
            user_id: req.user_id,
            notification_id: req.params.id,
        });

        res.status(STATUS_CODES.OK).json({
            success: true,
            status_code: STATUS_CODES.OK,
            message: "notification marked as read",
            result: { notification },
        });
    } catch (err) {
        next(err);
    }
};
