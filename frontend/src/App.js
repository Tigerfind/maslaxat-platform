import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './styles/toast.css';

import store from './store/store';
import { initializeApp } from './store/slices/appSlice';
import {
  getHomePath,
  hydrateSession,
  logout,
  synchronizeModeFromStorage,
  synchronizeTokenFromStorage,
} from './store/slices/authSlice';
import { LanguageProvider } from './i18n';
import { registerPrivateCacheClearer, subscribeSessionEvents } from './services/sessionRuntime';
import {
  isAuthBootstrapPending,
  shouldMountOperationalCallSocket,
} from './appSession';

// Components
import Layout from './components/Layout/Layout';
import GlobalCallListener from './components/Call/GlobalCallListener';
import ProtectedRoute from './components/ProtectedRoute';
import LoadingSpinner from './components/UI/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';
import PerspectiveScreen from './components/PerspectiveScreen';

// Pages
import LoginPage from './pages/Auth/LoginPage';
import RegisterPage from './pages/Auth/RegisterPage';
import DashboardPageGlass from './pages/Dashboard/DashboardPageGlass';
import LawyerDashboard from './pages/Lawyer/LawyerDashboardGlass';
import LawyerSchedulePage from './pages/Lawyer/LawyerSchedulePage';
import LawyerConsultationsPage from './pages/Lawyer/LawyerConsultationsPage';
import LawyerAnalyticsPage from './pages/Lawyer/LawyerAnalyticsPage';
import LawyerReviewsPage from './pages/Lawyer/LawyerReviewsPage';
import LawyerProfileEditPage from './pages/Lawyer/LawyerProfileEditPage';
import LawyerPromotionsPage from './pages/Lawyer/LawyerPromotionsPage';
import LawyerApplicantPage from './pages/Lawyer/LawyerApplicantPage';
import AdminDashboard from './pages/Admin/AdminDashboardGlass';
import AIChatPageGlass from './pages/AI/AIChatPageGlass';
import ConsultationsPageGlass from './pages/Consultations/ConsultationsPageGlass';
import VideoCallPage from './pages/Consultations/VideoCallPage';
import ChatPage from './pages/Consultations/ChatPage';
import LawyersPageGlass from './pages/Lawyers/LawyersPageGlass';
import LawyerProfilePage from './pages/Lawyers/LawyerProfilePage';
import DocumentsPageGlass from './pages/Documents/DocumentsPageGlass';
import ProfilePageGlass from './pages/Profile/ProfilePageGlass';
import SettingsPageGlass from './pages/Settings/SettingsPageGlass';
import HelpPage from './pages/Help/HelpPage';
import ForgotPasswordPage from './pages/Auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/Auth/ResetPasswordPage';
import SpecializationsPageGlass from './pages/Admin/SpecializationsPageGlass';
import AdminLawyersPage from './pages/Admin/AdminLawyersPage';
import AdminUsersPage from './pages/Admin/AdminUsersPage';
import AdminPromosPage from './pages/Admin/AdminPromosPage';
import AdminPromotionsPage from './pages/Admin/AdminPromotionsPage';
import AdminSupportPage from './pages/Admin/AdminSupportPage';
import AdminReviewsPage from './pages/Admin/AdminReviewsPage';
import FavoritesPage from './pages/Client/FavoritesPage';
import PortfolioPage from './pages/Client/PortfolioPage';
import PaymentsPageGlass from './pages/Payments/PaymentsPageGlass';
import VerifyEmailPage from './pages/Auth/VerifyEmailPage';
import LandingPage from './pages/Landing/LandingPage';

// MaslaXat Premium Theme
import { axelionTheme } from './theme/axelionTheme';

const theme = axelionTheme;

// Query client configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,
    },
  },
});

const HomeRedirect = () => {
  const auth = useSelector((state) => state.auth);
  return <Navigate to={getHomePath(auth)} replace />;
};

// App content component
const AppContent = () => {
  const dispatch = useDispatch();
  const auth = useSelector((state) => state.auth);
  const { isAuthenticated, token, bootstrapStatus } = auth;

  useEffect(() => {
    dispatch(initializeApp());
  }, [dispatch]);

  useEffect(() => registerPrivateCacheClearer(() => queryClient.clear()), []);

  useEffect(() => subscribeSessionEvents((event) => {
    if (event?.type === 'logout') dispatch(logout({ broadcast: false }));
  }), [dispatch]);

  useEffect(() => {
    if (token && bootstrapStatus === 'pending') {
      dispatch(hydrateSession()).catch(() => undefined);
    }
  }, [bootstrapStatus, dispatch, token]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === 'token') {
        if (!event.newValue) dispatch(logout({ broadcast: false }));
        else if (event.newValue !== token) {
          dispatch(synchronizeTokenFromStorage(event.newValue)).catch(() => undefined);
        }
      }
      if (event.key === 'maslaxatMode' && event.newValue) {
        dispatch(synchronizeModeFromStorage(event.newValue));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [dispatch, token]);

  if (isAuthBootstrapPending(auth)) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        sx={{ backgroundColor: '#F5F1EB' }}
      >
        <LoadingSpinner />
      </Box>
    );
  }

  return (
    <Router>
      {shouldMountOperationalCallSocket(auth) && <GlobalCallListener />}
      <Routes>
        <Route path="/" element={
          isAuthenticated ? <HomeRedirect /> : <LandingPage />
        } />

        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <HomeRedirect />} />
        <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <HomeRedirect />} />
        <Route path="/forgot-password" element={!isAuthenticated ? <ForgotPasswordPage /> : <HomeRedirect />} />
        <Route path="/reset-password" element={!isAuthenticated ? <ResetPasswordPage /> : <HomeRedirect />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route element={
          <ProtectedRoute capability="client" mode="client">
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="dashboard" element={<DashboardPageGlass />} />
          <Route path="ai-chat" element={<AIChatPageGlass />} />
          <Route path="consultations" element={<ConsultationsPageGlass />} />
          <Route path="lawyers" element={<LawyersPageGlass />} />
          <Route path="lawyers/:lawyerId" element={<LawyerProfilePage />} />
          <Route path="documents" element={<DocumentsPageGlass />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="portfolio" element={<PortfolioPage />} />
          <Route path="payments" element={<PaymentsPageGlass />} />
          <Route path="profile" element={<ProfilePageGlass />} />
        </Route>

        {/* Video call — accessible to both client and lawyer, fullscreen (no Layout) */}
        <Route path="/consultations/video/:consultationId" element={
          <ProtectedRoute perspectives={['client', 'lawyer']}>
            <PerspectiveScreen component={VideoCallPage} />
          </ProtectedRoute>
        } />

        {/* Chat — accessible to both client and lawyer */}
        <Route path="/consultations/chat/:consultationId" element={
          <ProtectedRoute perspectives={['client', 'lawyer']}>
            <PerspectiveScreen component={ChatPage} />
          </ProtectedRoute>
        } />

        {/* Settings & Help — доступны всем авторизованным ролям (свой GlassShell-каркас) */}
        <Route path="/settings" element={
          <ProtectedRoute>
            <SettingsPageGlass />
          </ProtectedRoute>
        } />
        <Route path="/help" element={
          <ProtectedRoute>
            <HelpPage />
          </ProtectedRoute>
        } />

        <Route path="/lawyer/onboarding" element={
          <ProtectedRoute capability="lawyerApplicant" mode="lawyer">
            <LawyerApplicantPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/imports" element={
          <ProtectedRoute capability="lawyerApplicant" mode="lawyer">
            <LawyerApplicantPage />
          </ProtectedRoute>
        } />

        <Route path="/lawyer/dashboard" element={
          <ProtectedRoute capability="lawyer" mode="lawyer">
            <LawyerDashboard />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/consultations" element={
          <ProtectedRoute capability="lawyer" mode="lawyer">
            <LawyerConsultationsPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/schedule" element={
          <ProtectedRoute capability="lawyer" mode="lawyer">
            <LawyerSchedulePage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/analytics" element={
          <ProtectedRoute capability="lawyer" mode="lawyer">
            <LawyerAnalyticsPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/profile/edit" element={
          <ProtectedRoute capability="lawyerApplicant" mode="lawyer">
            <LawyerProfileEditPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/reviews" element={
          <ProtectedRoute capability="lawyer" mode="lawyer">
            <LawyerReviewsPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/promotions" element={
          <ProtectedRoute capability="lawyer" mode="lawyer">
            <LawyerPromotionsPage />
          </ProtectedRoute>
        } />

        <Route path="/admin/dashboard" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="/admin/specializations" element={
          <ProtectedRoute capability="admin" mode="admin">
            <SpecializationsPageGlass />
          </ProtectedRoute>
        } />
        <Route path="/admin/lawyers" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminLawyersPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminUsersPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/promos" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminPromosPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/promotions" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminPromotionsPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/support" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminSupportPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/reviews" element={
          <ProtectedRoute capability="admin" mode="admin">
            <AdminReviewsPage />
          </ProtectedRoute>
        } />

        <Route path="*" element={
          isAuthenticated ? <HomeRedirect /> : <Navigate to="/login" />
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
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
            <ToastContainer
              position="top-right"
              autoClose={4000}
              hideProgressBar={false}
              newestOnTop
              closeOnClick
              rtl={false}
              pauseOnFocusLoss
              draggable
              pauseOnHover
              theme="dark"
              toastStyle={{
                background: 'linear-gradient(150deg, #241F1A, #332B22)',
                color: '#F1E7D8',
                borderRadius: '15px',
                boxShadow: '0 14px 34px rgba(0, 0, 0, 0.34)',
                border: '1px solid rgba(201, 169, 128, 0.22)',
                fontFamily: '"Inter", sans-serif',
              }}
            />
          </ThemeProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </Provider>
  );
}

export default App;
