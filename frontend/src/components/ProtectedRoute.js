import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { isAuthenticated, user, role } = useSelector((state) => state.auth);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If allowedRoles is specified, check if user has the right role
  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = role || user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      // Redirect to appropriate dashboard based on user's actual role
      if (userRole === 'admin') {
        return <Navigate to="/admin/dashboard" replace />;
      } else if (userRole === 'lawyer') {
        return <Navigate to="/lawyer/dashboard" replace />;
      } else {
        return <Navigate to="/dashboard" replace />;
      }
    }
  }

  return children;
};

export default ProtectedRoute;
