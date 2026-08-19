/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import authReducer from '../store/slices/authSlice';
import ProtectedRoute from './ProtectedRoute';

jest.mock('../services/api', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;
const Path = () => <div data-path={useLocation().pathname} />;

const mountRoute = (auth, guard, initialPath) => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth } });
  act(() => root.render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path={initialPath} element={<ProtectedRoute {...guard}><Path /></ProtectedRoute>} />
          <Route path="*" element={<Path />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  ));
  const currentPath = host.querySelector('[data-path]')?.getAttribute('data-path');
  act(() => root.unmount());
  return currentPath;
};

const ready = {
  token: 'token', user: { id: 'u1', role: 'lawyer' }, accountType: 'member',
  isAuthenticated: true, bootstrapStatus: 'ready', loading: false, error: null,
};

test('applicant cannot enter operational lawyer routes', () => {
  expect(mountRoute(
    { ...ready, capabilities: ['client', 'lawyerApplicant'], activeMode: 'lawyer' },
    { capability: 'lawyer', mode: 'lawyer' }, '/lawyer/consultations'
  )).toBe('/lawyer/onboarding');
});

test('chat and video require the capability matching the active perspective', () => {
  expect(mountRoute(
    { ...ready, capabilities: ['client', 'lawyerApplicant'], activeMode: 'client' },
    { perspectives: ['client', 'lawyer'] }, '/consultations/chat/c1'
  )).toBe('/consultations/chat/c1');
  expect(mountRoute(
    { ...ready, capabilities: ['client', 'lawyerApplicant'], activeMode: 'lawyer' },
    { perspectives: ['client', 'lawyer'] }, '/consultations/video/c1'
  )).toBe('/lawyer/onboarding');
});

test('legacy role cannot authorize an unhydrated session', () => {
  expect(mountRoute(
    { ...ready, accountType: null, capabilities: [], activeMode: null },
    { capability: 'admin', mode: 'admin' }, '/admin/dashboard'
  )).toBe('/login');
});
