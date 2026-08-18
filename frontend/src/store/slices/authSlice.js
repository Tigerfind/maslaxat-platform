import { createSlice } from '@reduxjs/toolkit';

const readStoredUser = () => {
  try {
    const user = JSON.parse(localStorage.getItem('user')) || null;
    if (user?.avatar?.startsWith('/uploads/')) {
      const origin = new URL(import.meta.env.VITE_API_URL || '/api', window.location.origin).origin;
      user.avatar = `${origin}${user.avatar}`;
      localStorage.setItem('user', JSON.stringify(user));
    }
    return user;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

const initialState = {
  user: readStoredUser(),
  token: localStorage.getItem('token') || null,
  role: localStorage.getItem('role') || null, // 'client', 'lawyer', 'admin'
  isAuthenticated: !!localStorage.getItem('token'),
  loading: false,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    loginSuccess: (state, action) => {
      state.loading = false;
      state.isAuthenticated = true;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.role = action.payload.role;
      state.error = null;

      // Save to localStorage
      localStorage.setItem('token', action.payload.token);
      localStorage.setItem('role', action.payload.role);
      localStorage.setItem('user', JSON.stringify(action.payload.user));
    },
    loginFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
      state.isAuthenticated = false;
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.role = null;
      state.isAuthenticated = false;
      state.error = null;

      // Clear localStorage
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('user');
    },
    updateProfile: (state, action) => {
      state.user = { ...state.user, ...action.payload };
      localStorage.setItem('user', JSON.stringify(state.user));
    },
    updateToken: (state, action) => {
      state.token = action.payload;
      state.isAuthenticated = Boolean(action.payload);
      if (action.payload) localStorage.setItem('token', action.payload);
      else localStorage.removeItem('token');
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const {
  loginStart,
  loginSuccess,
  loginFailure,
  logout,
  updateProfile,
  updateToken,
  clearError,
} = authSlice.actions;

export default authSlice.reducer;
