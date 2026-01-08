import { createSlice } from '@reduxjs/toolkit';

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
});

export const aiActions = aiSlice.actions;
export default aiSlice.reducer;
