const prisma_client = require("../utils/prismaClient");
const STATUS_CODES = require("../constants/statusCodes");
const ApiError = require("../utils/ApiError");

exports.listNotifications = async ({ user_id, page, limit }) => {
    const where = { user_id };

    const [notifications, total] = await Promise.all([
        prisma_client.notification.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma_client.notification.count({ where }),
    ]);

    return {
        notifications,
        pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
        },
    };
};

exports.markAsRead = async ({ user_id, notification_id }) => {
    const notification = await prisma_client.notification.findFirst({
        where: { id: notification_id, user_id },
    });

    if (!notification) {
        throw new ApiError(STATUS_CODES.NOT_FOUND, "Notification not found");
    }

    return prisma_client.notification.update({
        where: { id: notification_id },
        data: { read: true },
    });
};
