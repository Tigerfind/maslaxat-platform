import { createSlice } from '@reduxjs/toolkit';
import {
  sessionBoundaryRotated,
  sessionCleared,
  sessionRevoked,
  tokenReplaced,
} from './authSlice';

const initialState = {
  messages: [],
  isTyping: false,
  currentCategory: null,
  recommendedLawyers: [],
  isRecording: false,
};

const aiSlice = createSlice({
  name: 'ai',
  initialState,
  reducers: {
    addMessage: (state, action) => {
      state.messages.push({
        ...action.payload,
        id: Date.now(),
        timestamp: new Date().toISOString(),
      });
    },
    setTyping: (state, action) => {
      state.isTyping = action.payload;
    },
    setCategory: (state, action) => {
      state.currentCategory = action.payload;
    },
    setRecommendedLawyers: (state, action) => {
      state.recommendedLawyers = action.payload;
    },
    setRecording: (state, action) => {
      state.isRecording = action.payload;
    },
    clearChat: (state) => {
      state.messages = [];
      state.currentCategory = null;
      state.recommendedLawyers = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sessionCleared, () => initialState)
      .addCase(sessionRevoked, () => initialState)
      .addCase(sessionBoundaryRotated, () => initialState)
      .addCase(tokenReplaced, () => initialState);
  },
});

export const aiActions = aiSlice.actions;
export default aiSlice.reducer;
