import { useCallback, useEffect, useState } from "react";
import * as auth_api from "../api/auth.api";
import AuthContext from "./AuthContext";

const USER_STORAGE_KEY = "camarin_user";

// there's no GET /auth/me yet - the actual auth check lives in the httpOnly
// cookies the backend sets, this is just cached display data (id/email/created_at,
// nothing sensitive) so the UI doesn't flash a logged-out state on every refresh
const readStoredUser = () => {
    try {
        const raw = localStorage.getItem(USER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(readStoredUser);
    const [is_loading, setIsLoading] = useState(false);

    useEffect(() => {
        if (user) {
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
        } else {
            localStorage.removeItem(USER_STORAGE_KEY);
        }
    }, [user]);

    const signup = useCallback(async (credentials) => {
        setIsLoading(true);
        try {
            const registered_user = await auth_api.signup(credentials);
            setUser(registered_user);
            return registered_user;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const login = useCallback(async (credentials) => {
        setIsLoading(true);
        try {
            const logged_in_user = await auth_api.login(credentials);
            setUser(logged_in_user);
            return logged_in_user;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const logout = useCallback(async () => {
        try {
            await auth_api.logout();
        } finally {
            setUser(null);
        }
    }, []);

    return (
        <AuthContext.Provider value={{ user, is_loading, signup, login, logout, setUser }}>
            {children}
        </AuthContext.Provider>
    );
};
