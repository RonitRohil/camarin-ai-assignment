import { API_BASE_URL } from "../api/client";

// local storage's signed URL (services/storage/local.storage.js) is just a
// relative "/uploads/:key" path - it needs the backend's origin prefixed or the
// browser resolves it against the frontend's own origin instead. R2's signed
// URLs are already absolute (point at Cloudflare), so they pass through untouched.
export const resolveImageUrl = (image_url) => {
    if (!image_url) {
        return null;
    }
    return image_url.startsWith("/") ? `${API_BASE_URL}${image_url}` : image_url;
};

export const formatFileSize = (size_bytes) => {
    if (size_bytes < 1024) {
        return `${size_bytes} B`;
    }
    return `${(size_bytes / 1024).toFixed(1)} KB`;
};

export const formatDateTime = (iso_string) => {
    return new Date(iso_string).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
};
