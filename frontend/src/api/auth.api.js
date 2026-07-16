import api_client from "./client";

export const signup = async ({ email, password }) => {
    const { data } = await api_client.post("/auth/signup", { email, password });
    return data.result.user;
};

export const login = async ({ email, password }) => {
    const { data } = await api_client.post("/auth/login", { email, password });
    return data.result.user;
};

export const logout = async () => {
    await api_client.post("/auth/logout");
};
