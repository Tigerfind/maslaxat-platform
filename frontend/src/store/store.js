import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import appReducer from './slices/appSlice';
import aiReducer from './slices/aiSlice';
import specializationsReducer from './slices/specializationsSlice';
import { configureSessionRuntime } from '../services/sessionRuntime';
import { hydrateSession, logout, resolveServerMode } from './slices/authSlice';
import pushService from '../services/pushService';

const store = configureStore({
  reducer: {
    auth: authReducer,
    app: appReducer,
    ai: aiReducer,
    specializations: specializationsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

configureSessionRuntime({
  getSnapshot: () => store.getState().auth,
  chooseMode: (auth) => resolveServerMode(auth, auth.activeMode),
  reconcile: () => store.dispatch(hydrateSession()),
  onUnauthorized: () => store.dispatch(logout()),
  unbindPush: (owner) => pushService.unbindSession({ accountId: owner.userId, preservePreference: true }),
  rebindPush: (owner) => pushService.rebindSession(owner.userId),
});

export default store;
