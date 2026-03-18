// src/App.tsx
import { useState, useEffect, useCallback } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { checkSessionExists } from "./hooks/useBridge";
import { Login } from "./components/Login";
import { AppShell } from "./components/AppShell";
import { TasksPage } from "./components/TasksPage";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { AppBootScreen } from "./components/Loaders";
import { getErrorSummary } from "./utils";

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(true); // Optimistic
    const [initialLoadDone, setInitialLoadDone] = useState(false);

    // Check session existence on mount — just auth, no data fetching.
    // TasksPage handles its own initial issue fetch.
    useEffect(() => {
        let cancelled = false;
        const initialize = async () => {
            try {
                const hasSession = await checkSessionExists();
                if (!cancelled) setIsAuthenticated(hasSession);
            } catch (err) {
                console.warn(`Session check failed (${getErrorSummary(err)})`);
                if (!cancelled) setIsAuthenticated(false);
            } finally {
                if (!cancelled) setInitialLoadDone(true);
            }
        };
        void initialize();
        return () => { cancelled = true; };
    }, []);

    const handleLoginSuccess = useCallback(() => {
        setIsAuthenticated(true);
    }, []);

    const handleLogout = useCallback(() => {
        setIsAuthenticated(false);
    }, []);

    if (!initialLoadDone) {
        return (
            <AppBootScreen
                title="Launching workspace"
                subtitle="YTracker"
                caption="Connecting to Tracker services"
            />
        );
    }

    if (!isAuthenticated) {
        return <Login onLoginSuccess={handleLoginSuccess} />;
    }

    return (
        <HashRouter>
            <Routes>
                <Route element={<AppShell onLogout={handleLogout} isAuthenticated={isAuthenticated} />}>
                    <Route path="/tasks" element={<TasksPage />} />
                    <Route path="/boards" element={<PlaceholderPage title="Boards" />} />
                    <Route path="/timesheets" element={<PlaceholderPage title="Timesheets" />} />
                    <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
                    <Route path="/" element={<Navigate to="/tasks" replace />} />
                    <Route path="*" element={<Navigate to="/tasks" replace />} />
                </Route>
            </Routes>
        </HashRouter>
    );
}

export default App;
