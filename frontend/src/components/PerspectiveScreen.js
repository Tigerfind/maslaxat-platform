import React from 'react';
import { useSelector } from 'react-redux';

const PerspectiveScreen = ({ component: Component }) => {
  const { activeMode, sessionEpoch } = useSelector((state) => state.auth);
  return <Component key={`${activeMode}:${sessionEpoch}`} perspective={activeMode} />;
};

export default PerspectiveScreen;
