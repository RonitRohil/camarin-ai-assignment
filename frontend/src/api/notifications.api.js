import api_client from "./client";

export const listNotifications = async ({ page = 1, limit = 20 } = {}) => {
    const { data } = await api_client.get("/notifications", { params: { page, limit } });
    return data.result;
};

export const markNotificationAsRead = async (notification_id) => {
    const { data } = await api_client.post(`/notifications/${notification_id}/read`);
    return data.result.notification;
};
