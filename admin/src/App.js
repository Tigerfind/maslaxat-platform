import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import store from './store/store';
import { authActions } from './store/slices/authSlice';
import { initializeApp } from './store/slices/appSlice';

// Components
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoadingSpinner from './components/UI/LoadingSpinner';

// Pages
import DashboardPage from './pages/Dashboard/DashboardPage';
import UsersPage from './pages/Users/UsersPage';
import LawyersPage from './pages/Lawyers/LawyersPage';
import ConsultationsPage from './pages/Consultations/ConsultationsPage';
import PaymentsPage from './pages/Payments/PaymentsPage';
import DocumentsPage from './pages/Documents/DocumentsPage';
import AnalyticsPage from './pages/Analytics/AnalyticsPage';
import SettingsPage from './pages/Settings/SettingsPage';

// Create theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
      light: '#42a5f5',
      dark: '#1565c0',
    },
    secondary: {
      main: '#dc004e',
      light: '#ff5983',
      dark: '#9a0036',
    },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
    success: {
      main: '#4caf50',
      light: '#81c784',
      dark: '#388e3c',
    },
    warning: {
      main: '#ff9800',
      light: '#ffb74d',
      dark: '#f57c00',
    },
    error: {
      main: '#f44336',
      light: '#e57373',
      dark: '#d32f2f',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '2.5rem',
      fontWeight: 600,
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h3: {
      fontSize: '1.75rem',
      fontWeight: 500,
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
        },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: 'none',
        },
      },
    },
  },
});

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
  const { isAuthenticated, isLoading, user } = useSelector((state) => state.auth);

  useEffect(() => {
    // Initialize app
    dispatch(initializeApp());
    
    // Check authentication status
    const token = localStorage.getItem('accessToken');
    if (token) {
      dispatch(authActions.checkAuthStatus());
    }
  }, [dispatch]);

  if (isLoading) {
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

  // Check if user is admin
  const isAdmin = user?.role === 'admin';

  if (isAuthenticated && !isAdmin) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        textAlign="center"
      >
        <div>
          <h1>Access Denied</h1>
          <p>You don't have permission to access the admin panel.</p>
          <a href="/">Go to main application</a>
        </div>
      </Box>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Login route */}
        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/dashboard" />} />
        
        {/* Protected routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/dashboard" />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="lawyers" element={<LawyersPage />} />
          <Route path="consultations" element={<ConsultationsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Catch all route */}
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Router>
  );
};

// Login page component
const LoginPage = () => {
  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="background.default"
    >
      <Box
        component="form"
        p={4}
        bgcolor="background.paper"
        borderRadius={2}
        boxShadow={3}
        maxWidth={400}
        width="100%"
      >
        <h2>Admin Login</h2>
        <p>Please contact your system administrator for access credentials.</p>
      </Box>
    </Box>
  );
};

// Main App component
function App() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
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
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </Provider>
  );
}

export default App;