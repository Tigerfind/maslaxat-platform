import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { getHomePath } from '../store/slices/authSlice';

const ProtectedRoute = ({ children, capability, mode, perspectives }) => {
  const auth = useSelector((state) => state.auth);
  const authoritative = auth.bootstrapStatus === 'ready'
    && auth.accountType
    && auth.capabilities?.length
    && auth.activeMode;

  if (!auth.isAuthenticated || !authoritative) return <Navigate to="/login" replace />;

  const home = getHomePath(auth);
  if (mode && auth.activeMode !== mode) return <Navigate to={home} replace />;

  if (perspectives) {
    const perspective = auth.activeMode;
    const allowed = perspectives.includes(perspective)
      && (perspective === 'client'
        ? auth.capabilities.includes('client')
        : auth.capabilities.includes('lawyer'));
    if (!allowed) return <Navigate to={home} replace />;
  }

  if (capability && !auth.capabilities.includes(capability)) {
    const applicantFallback = mode === 'lawyer' && auth.capabilities.includes('lawyerApplicant');
    return <Navigate to={applicantFallback ? '/lawyer/onboarding' : home} replace />;
  }

  return children;
};

export default ProtectedRoute;
