import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import JobsList from "./pages/JobsList";
import JobDetail from "./pages/JobDetail";
import "./App.css";

const App = () => {
    const { user, logout } = useAuth();

    return (
        <>
            {user ? (
                <header className="app-header">
                    <span className="app-header-brand">Camarin AI</span>
                    <span className="app-header-user">
                        {user.email}
                        <button type="button" onClick={logout}>
                            Log out
                        </button>
                    </span>
                </header>
            ) : null}

            <main className="page-container">
                <Routes>
                    <Route path="/login" element={user ? <Navigate to="/jobs" replace /> : <Login />} />
                    <Route path="/signup" element={user ? <Navigate to="/jobs" replace /> : <Signup />} />

                    <Route element={<ProtectedRoute />}>
                        <Route path="/jobs" element={<JobsList />} />
                        <Route path="/jobs/:id" element={<JobDetail />} />
                    </Route>

                    <Route path="/" element={<Navigate to={user ? "/jobs" : "/login"} replace />} />
                    <Route path="*" element={<Navigate to={user ? "/jobs" : "/login"} replace />} />
                </Routes>
            </main>
        </>
    );
};

export default App;
