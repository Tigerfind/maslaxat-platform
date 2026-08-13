import reducer, { loginSuccess, logout, updateProfile } from './authSlice';

beforeEach(() => localStorage.clear());

test('loginSuccess сохраняет сессию, updateProfile объединяет профиль, logout очищает её', () => {
  let state = reducer(undefined, loginSuccess({
    user: { id: 'u1', name: 'Клиент' }, token: 'token', role: 'client',
  }));
  expect(state.isAuthenticated).toBe(true);
  expect(localStorage.getItem('token')).toBe('token');

  state = reducer(state, updateProfile({ name: 'Новое имя' }));
  expect(state.user).toEqual({ id: 'u1', name: 'Новое имя' });

  state = reducer(state, logout());
  expect(state.isAuthenticated).toBe(false);
  expect(localStorage.getItem('token')).toBeNull();
});
