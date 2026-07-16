import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listNotifications, markNotificationAsRead } from "../api/notifications.api";
import usePolling from "../hooks/usePolling";
import { formatDateTime } from "../utils/format";

const NOTIFICATION_LABEL = {
    job_flagged: "A job you uploaded was flagged for review",
    job_completed: "A job you uploaded finished processing",
    job_failed: "A job you uploaded failed to process",
};

const NotificationsBell = () => {
    const [notifications, setNotifications] = useState([]);
    const [is_open, setIsOpen] = useState(false);
    const container_ref = useRef(null);

    const fetchNotifications = useCallback(async () => {
        try {
            const result = await listNotifications({ limit: 20 });
            setNotifications(result.notifications);
        } catch {
            // silent - the bell just stays stale until the next successful poll
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchNotifications();
    }, [fetchNotifications]);

    usePolling(fetchNotifications, 40000);

    useEffect(() => {
        if (!is_open) {
            return undefined;
        }

        const handleClickOutside = (event) => {
            if (container_ref.current && !container_ref.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [is_open]);

    const unread_count = notifications.filter((notification) => !notification.read).length;

    const handleNotificationClick = async (notification) => {
        if (notification.read) {
            return;
        }

        setNotifications((current) =>
            current.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
        );

        try {
            await markNotificationAsRead(notification.id);
        } catch {
            // best-effort - a stale read state self-corrects on the next poll
        }
    };

    return (
        <div className="notifications-bell" ref={container_ref}>
            <button type="button" onClick={() => setIsOpen((open) => !open)} aria-label="Notifications">
                Notifications
                {unread_count > 0 ? <span className="notifications-badge">{unread_count}</span> : null}
            </button>

            {is_open ? (
                <div className="notifications-panel">
                    {notifications.length === 0 ? (
                        <p className="notifications-empty">No notifications yet</p>
                    ) : (
                        <ul className="notifications-list">
                            {notifications.map((notification) => (
                                <li key={notification.id} className={notification.read ? "" : "notifications-item--unread"}>
                                    <Link
                                        to={`/jobs/${notification.job_id}`}
                                        onClick={() => handleNotificationClick(notification)}
                                    >
                                        <p>{NOTIFICATION_LABEL[notification.type] || notification.type}</p>
                                        <span>{formatDateTime(notification.created_at)}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </div>
    );
};

export default NotificationsBell;
