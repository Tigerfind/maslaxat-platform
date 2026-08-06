import { createSlice } from '@reduxjs/toolkit';
import { SPECIALIZATIONS } from '../../constants/specializations';

const initialState = {
  // Единый справочник (см. constants/specializations.js) — совпадает с тем, что
  // предлагают онбординг и редактор профиля, поэтому область юриста всегда матчится.
  specializations: SPECIALIZATIONS,
  loading: false,
  error: null,
};

const specializationsSlice = createSlice({
  name: 'specializations',
  initialState,
  reducers: {
    addSpecialization: (state, action) => {
      state.specializations.push({
        ...action.payload,
        id: `spec_${Date.now()}`,
        active: true,
        order: state.specializations.length + 1,
      });
    },
    updateSpecialization: (state, action) => {
      const index = state.specializations.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.specializations[index] = { ...state.specializations[index], ...action.payload };
      }
    },
    deleteSpecialization: (state, action) => {
      state.specializations = state.specializations.filter(s => s.id !== action.payload);
    },
    toggleSpecialization: (state, action) => {
      const spec = state.specializations.find(s => s.id === action.payload);
      if (spec) {
        spec.active = !spec.active;
      }
    },
    reorderSpecializations: (state, action) => {
      state.specializations = action.payload;
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
  },
});

export const specializationsActions = specializationsSlice.actions;
export default specializationsSlice.reducer;
