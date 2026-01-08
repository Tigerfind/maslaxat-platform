import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  specializations: [
    { id: 'civil', name: 'Гражданское право', nameUz: 'Fuqarolik huquqi', nameEn: 'Civil Law', active: true, order: 1 },
    { id: 'family', name: 'Семейное право', nameUz: 'Oila huquqi', nameEn: 'Family Law', active: true, order: 2 },
    { id: 'corporate', name: 'Корпоративное право', nameUz: 'Korporativ huquq', nameEn: 'Corporate Law', active: true, order: 3 },
    { id: 'criminal', name: 'Уголовное право', nameUz: 'Jinoyat huquqi', nameEn: 'Criminal Law', active: true, order: 4 },
    { id: 'real-estate', name: 'Недвижимость', nameUz: 'Ko\'chmas mulk', nameEn: 'Real Estate', active: true, order: 5 },
    { id: 'labor', name: 'Трудовое право', nameUz: 'Mehnat huquqi', nameEn: 'Labor Law', active: true, order: 6 },
    { id: 'tax', name: 'Налоговое право', nameUz: 'Soliq huquqi', nameEn: 'Tax Law', active: true, order: 7 },
    { id: 'intellectual', name: 'Интеллектуальная собственность', nameUz: 'Intellektual mulk', nameEn: 'Intellectual Property', active: true, order: 8 },
  ],
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
