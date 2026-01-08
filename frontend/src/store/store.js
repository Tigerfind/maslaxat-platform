import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import appReducer from './slices/appSlice';
import aiReducer from './slices/aiSlice';
import specializationsReducer from './slices/specializationsSlice';

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

export default store;
