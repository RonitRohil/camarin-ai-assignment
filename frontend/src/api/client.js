import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5002";

const api_client = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
});

// backend issues short-lived access tokens + a longer-lived refresh token, both as
// httpOnly cookies (ADR-4) - on a 401 we try /auth/refresh once, then retry the
// original request, so a login session survives past the access token's 15min TTL
let refresh_in_flight = null;

api_client.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original_request = error.config;
        const status_code = error.response?.status;
        const is_auth_route = original_request?.url?.startsWith("/auth/");

        if (status_code !== 401 || is_auth_route || original_request._retried) {
            return Promise.reject(error);
        }

        original_request._retried = true;

        try {
            if (!refresh_in_flight) {
                refresh_in_flight = api_client.post("/auth/refresh").finally(() => {
                    refresh_in_flight = null;
                });
            }

            await refresh_in_flight;
            return api_client(original_request);
        } catch {
            return Promise.reject(error);
        }
    }
);

export default api_client;
