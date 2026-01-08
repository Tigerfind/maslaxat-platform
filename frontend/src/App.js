import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import store from './store/store';
import { initializeApp } from './store/slices/appSlice';
import { LanguageProvider } from './i18n';

// Components
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoadingSpinner from './components/UI/LoadingSpinner';

// Pages
import HomePage from './pages/HomePage';
import LoginPage from './pages/Auth/LoginPage';
import RegisterPage from './pages/Auth/RegisterPage';
import ClientLogin from './pages/Auth/ClientLoginGlass';
import LawyerLogin from './pages/Auth/LawyerLoginGlass';
import AdminLogin from './pages/Auth/AdminLoginGlass';
import DashboardPageGlass from './pages/Dashboard/DashboardPageGlass';
import LawyerDashboard from './pages/Lawyer/LawyerDashboardGlass';
import LawyerSchedulePage from './pages/Lawyer/LawyerSchedulePage';
import LawyerReviewsPage from './pages/Lawyer/LawyerReviewsPage';
import AdminDashboard from './pages/Admin/AdminDashboardGlass';
import AIChatPage from './pages/AI/AIChatPage';
import AIChatPageGlass from './pages/AI/AIChatPageGlass';
import ConsultationsPage from './pages/Consultations/ConsultationsPage';
import ConsultationsPageGlass from './pages/Consultations/ConsultationsPageGlass';
import VideoCallPage from './pages/Consultations/VideoCallPage';
import LawyersPage from './pages/Lawyers/LawyersPage';
import LawyersPageGlass from './pages/Lawyers/LawyersPageGlass';
import LawyerProfilePage from './pages/Lawyers/LawyerProfilePage';
import LawyerProfilePageGlass from './pages/Lawyers/LawyerProfilePageGlass';
import DocumentsPage from './pages/Documents/DocumentsPage';
import DocumentsPageGlass from './pages/Documents/DocumentsPageGlass';
import ProfilePageGlass from './pages/Profile/ProfilePageGlass';
import SettingsPageGlass from './pages/Settings/SettingsPageGlass';
import HelpPage from './pages/Help/HelpPage';
import SpecializationsPageGlass from './pages/Admin/SpecializationsPageGlass';
import { corporateTheme } from './theme/corporateTheme';

// Using Corporate Minimalism Theme
const theme = corporateTheme;

// Query client configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

// App content component
const AppContent = () => {
  const dispatch = useDispatch();
  const { isAuthenticated, loading } = useSelector((state) => state.auth);

  useEffect(() => {
    // Initialize app
    dispatch(initializeApp());
  }, [dispatch]);

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <LoadingSpinner />
      </Box>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Main landing page - redirect based on auth status */}
        <Route path="/" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
        } />

        {/* Public routes - Role-based login */}
        <Route path="/login/client" element={!isAuthenticated ? <ClientLogin /> : <Navigate to="/dashboard" />} />
        <Route path="/login/lawyer" element={!isAuthenticated ? <LawyerLogin /> : <Navigate to="/lawyer/dashboard" />} />
        <Route path="/login/admin" element={!isAuthenticated ? <AdminLogin /> : <Navigate to="/admin/dashboard" />} />
        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/dashboard" />} />

        {/* Protected routes - Client Dashboard */}
        <Route element={
          <ProtectedRoute allowedRoles={['client']}>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="dashboard" element={<DashboardPageGlass />} />
          <Route path="ai-chat" element={<AIChatPageGlass />} />
          <Route path="consultations" element={<ConsultationsPageGlass />} />
          <Route path="consultations/video/:consultationId" element={<VideoCallPage />} />
          <Route path="lawyers" element={<LawyersPageGlass />} />
          <Route path="lawyers/:lawyerId" element={<LawyerProfilePage />} />
          <Route path="documents" element={<DocumentsPageGlass />} />
          <Route path="profile" element={<ProfilePageGlass />} />
          <Route path="settings" element={<SettingsPageGlass />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="admin/specializations" element={<SpecializationsPageGlass />} />
        </Route>

        {/* Protected routes - Lawyer Dashboard */}
        <Route path="/lawyer/dashboard" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerDashboard />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/schedule" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerSchedulePage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/reviews" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerReviewsPage />
          </ProtectedRoute>
        } />

        {/* Protected routes - Admin Dashboard */}
        <Route path="/admin/dashboard" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        } />

        {/* Catch all route */}
        <Route path="*" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
        } />
      </Routes>
    </Router>
  );
};

// Main App component
function App() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <AppContent />
            <ToastContainer
              position="top-right"
              autoClose={5000}
              hideProgressBar={false}
              newestOnTop={false}
              closeOnClick
              rtl={false}
              pauseOnFocusLoss
              draggable
              pauseOnHover
              theme="light"
            />
          </ThemeProvider>
        </LanguageProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </Provider>
  );
}

export default App;