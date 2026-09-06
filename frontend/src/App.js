import React, { lazy, Suspense, useEffect } from 'react';
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
import { axelionTheme } from './theme/axelionTheme';

// Pages
const LoginPage = lazy(() => import('./pages/Auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/Auth/RegisterPage'));
const LinkedInCallbackPage = lazy(() => import('./pages/Auth/LinkedInCallbackPage'));
const DashboardPageGlass = lazy(() => import('./pages/Dashboard/DashboardPageGlass'));
const LawyerDashboard = lazy(() => import('./pages/Lawyer/LawyerDashboardGlass'));
const LawyerSchedulePage = lazy(() => import('./pages/Lawyer/LawyerSchedulePage'));
const LawyerConsultationsPage = lazy(() => import('./pages/Lawyer/LawyerConsultationsPage'));
const LawyerAnalyticsPage = lazy(() => import('./pages/Lawyer/LawyerAnalyticsPage'));
const LawyerReviewsPage = lazy(() => import('./pages/Lawyer/LawyerReviewsPage'));
const LawyerProfileEditPage = lazy(() => import('./pages/Lawyer/LawyerProfileEditPage'));
const LawyerPromotionsPage = lazy(() => import('./pages/Lawyer/LawyerPromotionsPage'));
const LawyerApplicantPage = lazy(() => import('./pages/Lawyer/LawyerApplicantPage'));
const AdminDashboard = lazy(() => import('./pages/Admin/AdminDashboardGlass'));
const AIChatPageGlass = lazy(() => import('./pages/AI/AIChatPageGlass'));
const ConsultationsPageGlass = lazy(() => import('./pages/Consultations/ConsultationsPageGlass'));
const ConsultationDetailsPage = lazy(() => import('./pages/Consultations/ConsultationDetailsPage'));
const VideoCallPage = lazy(() => import('./pages/Consultations/VideoCallPage'));
const ZoomMeetingPage = lazy(() => import('./pages/Consultations/ZoomMeetingPage'));
const ChatPage = lazy(() => import('./pages/Consultations/ChatPage'));
const LawyersPageGlass = lazy(() => import('./pages/Lawyers/LawyersPageGlass'));
const LawyerProfilePage = lazy(() => import('./pages/Lawyers/LawyerProfilePage'));
const DocumentsPageGlass = lazy(() => import('./pages/Documents/DocumentsPageGlass'));
const ProfilePageGlass = lazy(() => import('./pages/Profile/ProfilePageGlass'));
const SettingsPageGlass = lazy(() => import('./pages/Settings/SettingsPageGlass'));
const HelpPage = lazy(() => import('./pages/Help/HelpPage'));
const ForgotPasswordPage = lazy(() => import('./pages/Auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/Auth/ResetPasswordPage'));
const SpecializationsPageGlass = lazy(() => import('./pages/Admin/SpecializationsPageGlass'));
const AdminLawyersPage = lazy(() => import('./pages/Admin/AdminLawyersPage'));
const AdminUsersPage = lazy(() => import('./pages/Admin/AdminUsersPage'));
const AdminPromosPage = lazy(() => import('./pages/Admin/AdminPromosPage'));
const AdminPromotionsPage = lazy(() => import('./pages/Admin/AdminPromotionsPage'));
const AdminSupportPage = lazy(() => import('./pages/Admin/AdminSupportPage'));
const AdminReviewsPage = lazy(() => import('./pages/Admin/AdminReviewsPage'));
const AdminFinancePage = lazy(() => import('./pages/Admin/AdminFinancePage'));
const AdminConsultationsPage = lazy(() => import('./pages/Admin/AdminConsultationsPage'));
const FavoritesPage = lazy(() => import('./pages/Client/FavoritesPage'));
const PortfolioPage = lazy(() => import('./pages/Client/PortfolioPage'));
const PaymentsPageGlass = lazy(() => import('./pages/Payments/PaymentsPageGlass'));
const VerifyEmailPage = lazy(() => import('./pages/Auth/VerifyEmailPage'));
const LandingPage = lazy(() => import('./pages/Landing/LandingPage'));
const LegalPage = lazy(() => import('./pages/Legal/LegalPage'));

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
      <Suspense fallback={(
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
          <LoadingSpinner />
        </Box>
      )}>
        <Routes>
        <Route path="/" element={
          isAuthenticated ? <HomeRedirect /> : <LandingPage />
        } />

        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <HomeRedirect />} />
        <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <HomeRedirect />} />
        <Route path="/oauth/linkedin" element={<LinkedInCallbackPage />} />
        <Route path="/forgot-password" element={!isAuthenticated ? <ForgotPasswordPage /> : <HomeRedirect />} />
        <Route path="/reset-password" element={!isAuthenticated ? <ResetPasswordPage /> : <HomeRedirect />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/terms" element={<LegalPage documentType="terms" />} />
        <Route path="/privacy" element={<LegalPage documentType="privacy" />} />
        <Route path="/refund-policy" element={<LegalPage documentType="refund" />} />

        <Route element={
          <ProtectedRoute capability="client" mode="client">
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="dashboard" element={<DashboardPageGlass />} />
          <Route path="ai-chat" element={<AIChatPageGlass />} />
          <Route path="consultations" element={<ConsultationsPageGlass />} />
          <Route path="consultations/:consultationId" element={<ConsultationDetailsPage />} />
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
        <Route path="/consultations/zoom/:consultationId" element={
          <ProtectedRoute allowedRoles={['client', 'lawyer']}>
            <ZoomMeetingPage />
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
        <Route path="/admin/finance" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminFinancePage />
          </ProtectedRoute>
        } />
        <Route path="/admin/consultations" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminConsultationsPage />
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
      </Suspense>
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
