import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import AdminPage from './pages/AdminPage';
import { trackPageView } from './metrics';

// Tracks every SPA route change and reports it to the metrics backend.
function PageTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
  return null;
}

// Redirect to dashboard if already logged in, otherwise show the public page.
// Check isAuthenticated FIRST — it's set synchronously from localStorage on first
// render, so a logged-in user redirects instantly with no flash of the public page.
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (isLoading) return null;
  return <>{children}</>;
}

function AppShell() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith('/admin');
  return (
    <>
      <PageTracker />
      {!isAdmin && <Navbar />}
      <main>
          <Routes>
            <Route path="/" element={<PublicRoute><Home /></PublicRoute>} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/rider"  element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard/driver" element={<Navigate to="/dashboard" replace />} />
            <Route path="/profile"          element={<Navigate to="/dashboard" replace />} />
            <Route path="/profile/*"        element={<Navigate to="/dashboard" replace />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
