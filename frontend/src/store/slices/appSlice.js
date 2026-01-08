import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const initialState = {
  initialized: false,
  language: 'en',
};

export const initializeApp = createAsyncThunk(
  'app/initialize',
  async () => {
    return { initialized: true };
  }
);

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setLanguage: (state, action) => {
      state.language = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeApp.fulfilled, (state) => {
      state.initialized = true;
    });
  },
});

export const { setLanguage } = appSlice.actions;
export default appSlice.reducer;
