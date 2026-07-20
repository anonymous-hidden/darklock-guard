import { createBrowserRouter, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage";
import SecurityCheckPage from "./pages/SecurityCheckPage";
import { AppLayout } from "./components/layout";
import { ChatLayout } from "./components/layout";
import { ServerChannelView } from "./components/layout";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import { useAuthStore } from "./store/authStore";

// Guard component for authenticated routes
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const securityCheckComplete = useAuthStore((s) => s.securityCheckComplete);

  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  if (!securityCheckComplete) return <Navigate to="/security-check" replace />;

  return <>{children}</>;
}

function RequireAuthOnly({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthPage />,
  },
  {
    path: "/security-check",
    element: (
      <RequireAuthOnly>
        <SecurityCheckPage />
      </RequireAuthOnly>
    ),
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <ChatLayout /> },
      { path: "chat/:sessionId", element: <ChatLayout /> },
      { path: "server/:serverId/channel/:channelId", element: <ServerChannelView /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/auth" replace />,
  },
]);
