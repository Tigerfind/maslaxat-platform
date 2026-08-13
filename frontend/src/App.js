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
import { LanguageProvider } from './i18n';

// Components
import Layout from './components/Layout/Layout';
import GlobalCallListener from './components/Call/GlobalCallListener';
import ProtectedRoute from './components/ProtectedRoute';
import LoadingSpinner from './components/UI/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';
import { axelionTheme } from './theme/axelionTheme';

// Pages
const LoginPage = lazy(() => import('./pages/Auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/Auth/RegisterPage'));
const DashboardPageGlass = lazy(() => import('./pages/Dashboard/DashboardPageGlass'));
const LawyerDashboard = lazy(() => import('./pages/Lawyer/LawyerDashboardGlass'));
const LawyerSchedulePage = lazy(() => import('./pages/Lawyer/LawyerSchedulePage'));
const LawyerConsultationsPage = lazy(() => import('./pages/Lawyer/LawyerConsultationsPage'));
const LawyerAnalyticsPage = lazy(() => import('./pages/Lawyer/LawyerAnalyticsPage'));
const LawyerReviewsPage = lazy(() => import('./pages/Lawyer/LawyerReviewsPage'));
const LawyerProfileEditPage = lazy(() => import('./pages/Lawyer/LawyerProfileEditPage'));
const AdminDashboard = lazy(() => import('./pages/Admin/AdminDashboardGlass'));
const AIChatPageGlass = lazy(() => import('./pages/AI/AIChatPageGlass'));
const ConsultationsPageGlass = lazy(() => import('./pages/Consultations/ConsultationsPageGlass'));
const VideoCallPage = lazy(() => import('./pages/Consultations/VideoCallPage'));
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

// App content component
const AppContent = () => {
  const dispatch = useDispatch();
  const { isAuthenticated, loading } = useSelector((state) => state.auth);

  useEffect(() => {
    dispatch(initializeApp());
  }, [dispatch]);

  if (loading) {
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
      {isAuthenticated && <GlobalCallListener />}
      <Suspense fallback={(
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
          <LoadingSpinner />
        </Box>
      )}>
        <Routes>
        <Route path="/" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <LandingPage />
        } />

        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/dashboard" />} />
        <Route path="/forgot-password" element={!isAuthenticated ? <ForgotPasswordPage /> : <Navigate to="/dashboard" />} />
        <Route path="/reset-password" element={!isAuthenticated ? <ResetPasswordPage /> : <Navigate to="/dashboard" />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/terms" element={<LegalPage documentType="terms" />} />
        <Route path="/privacy" element={<LegalPage documentType="privacy" />} />
        <Route path="/refund-policy" element={<LegalPage documentType="refund" />} />

        <Route element={
          <ProtectedRoute allowedRoles={['client']}>
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
          <ProtectedRoute allowedRoles={['client', 'lawyer']}>
            <VideoCallPage />
          </ProtectedRoute>
        } />

        {/* Chat — accessible to both client and lawyer */}
        <Route path="/consultations/chat/:consultationId" element={
          <ProtectedRoute allowedRoles={['client', 'lawyer']}>
            <ChatPage />
          </ProtectedRoute>
        } />

        {/* Settings & Help — доступны всем авторизованным ролям (свой GlassShell-каркас) */}
        <Route path="/settings" element={
          <ProtectedRoute allowedRoles={['client', 'lawyer', 'admin']}>
            <SettingsPageGlass />
          </ProtectedRoute>
        } />
        <Route path="/help" element={
          <ProtectedRoute allowedRoles={['client', 'lawyer', 'admin']}>
            <HelpPage />
          </ProtectedRoute>
        } />

        <Route path="/lawyer/dashboard" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerDashboard />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/consultations" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerConsultationsPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/schedule" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerSchedulePage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/analytics" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerAnalyticsPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/profile/edit" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerProfileEditPage />
          </ProtectedRoute>
        } />
        <Route path="/lawyer/reviews" element={
          <ProtectedRoute allowedRoles={['lawyer']}>
            <LawyerReviewsPage />
          </ProtectedRoute>
        } />

        <Route path="/admin/dashboard" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="/admin/specializations" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <SpecializationsPageGlass />
          </ProtectedRoute>
        } />
        <Route path="/admin/lawyers" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminLawyersPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminUsersPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/promos" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminPromosPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/support" element={
          <ProtectedRoute allowedRoles={['admin']}>
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
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminReviewsPage />
          </ProtectedRoute>
        } />

        <Route path="*" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
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
