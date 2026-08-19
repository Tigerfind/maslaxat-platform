/* eslint-disable testing-library/no-unnecessary-act */
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import PerspectiveScreen from './PerspectiveScreen';

global.IS_REACT_ACT_ENVIRONMENT = true;

test('perspective epoch remount clears interactive chat or video state', () => {
  const unmount = jest.fn();
  const authSlice = createSlice({
    name: 'testAuth',
    initialState: { activeMode: 'client', sessionEpoch: 1 },
    reducers: { replace: (state, action) => action.payload },
  });
  const Child = ({ perspective }) => {
    const [count, setCount] = useState(0);
    useEffect(() => () => unmount(), []);
    return <button type="button" onClick={() => setCount((value) => value + 1)}>{perspective}:{count}</button>;
  };
  const store = configureStore({ reducer: { auth: authSlice.reducer } });
  const host = document.createElement('div');
  const root = createRoot(host);

  act(() => root.render(<Provider store={store}><PerspectiveScreen component={Child} /></Provider>));
  act(() => host.querySelector('button').click());
  expect(host.textContent).toBe('client:1');

  act(() => store.dispatch(authSlice.actions.replace({ activeMode: 'lawyer', sessionEpoch: 2 })));
  expect(unmount).toHaveBeenCalledTimes(1);
  expect(host.textContent).toBe('lawyer:0');
  act(() => root.unmount());
});
