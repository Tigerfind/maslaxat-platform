import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  IconButton,
  Collapse,
  Button,
} from '@mui/material';
import {
  BugReport,
  ExpandMore,
  ExpandLess,
  Refresh,
  Delete,
} from '@mui/icons-material';
import { useSelector } from 'react-redux';

const DebugPanel = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({});
  const { user } = useSelector((state) => state.auth);

  const loadDebugData = () => {
    try {
      const consultationRequests = JSON.parse(localStorage.getItem('consultationRequests') || '[]');
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

      setData({
        currentUser,
        consultationRequests,
        totalRequests: consultationRequests.length,
        pendingRequests: consultationRequests.filter(r => r.status === 'pending').length,
        acceptedRequests: consultationRequests.filter(r => r.status === 'accepted').length,
        rejectedRequests: consultationRequests.filter(r => r.status === 'rejected').length,
      });
    } catch (error) {
      console.error('Error loading debug data:', error);
    }
  };

  useEffect(() => {
    if (open) {
      loadDebugData();
    }
  }, [open]);

  const handleClearRequests = () => {
    if (window.confirm('Очистить все запросы на консультации из localStorage?')) {
      localStorage.removeItem('consultationRequests');
      loadDebugData();
    }
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
      }}
    >
      {!open && (
        <IconButton
          onClick={() => setOpen(true)}
          sx={{
            bgcolor: '#FF6B6B',
            color: '#FFFFFF',
            '&:hover': {
              bgcolor: '#EE5A5A',
            },
            boxShadow: '0 4px 12px rgba(255, 107, 107, 0.3)',
          }}
        >
          <BugReport />
        </IconButton>
      )}

      <Collapse in={open}>
        <Paper
          sx={{
            width: 500,
            maxHeight: '80vh',
            overflow: 'auto',
            p: 3,
            bgcolor: '#FFFFFF',
            border: '2px solid #FF6B6B',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <BugReport sx={{ color: '#FF6B6B' }} />
              <Typography variant="h6" fontWeight="bold">
                Debug Panel
              </Typography>
            </Box>
            <Box>
              <IconButton size="small" onClick={loadDebugData}>
                <Refresh />
              </IconButton>
              <IconButton size="small" onClick={() => setOpen(false)}>
                <ExpandLess />
              </IconButton>
            </Box>
          </Box>

          {/* Current User Info */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#6B7280', mb: 1 }}>
              Current User:
            </Typography>
            <Paper sx={{ bgcolor: '#F4F6F8', p: 2 }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                ID: {data.currentUser?.id || 'N/A'}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                Name: {data.currentUser?.name || 'N/A'}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                Role: {data.currentUser?.role || 'N/A'}
              </Typography>
            </Paper>
          </Box>

          {/* Requests Stats */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#6B7280', mb: 1 }}>
              Consultation Requests Stats:
            </Typography>
            <Paper sx={{ bgcolor: '#F4F6F8', p: 2 }}>
              <Typography variant="body2">Total: {data.totalRequests || 0}</Typography>
              <Typography variant="body2">Pending: {data.pendingRequests || 0}</Typography>
              <Typography variant="body2">Accepted: {data.acceptedRequests || 0}</Typography>
              <Typography variant="body2">Rejected: {data.rejectedRequests || 0}</Typography>
            </Paper>
          </Box>

          {/* All Requests */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#6B7280', mb: 1 }}>
              All Consultation Requests:
            </Typography>
            <Paper
              sx={{
                bgcolor: '#F4F6F8',
                p: 2,
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              {data.consultationRequests && data.consultationRequests.length > 0 ? (
                data.consultationRequests.map((req, index) => (
                  <Box
                    key={req.id}
                    sx={{
                      mb: 2,
                      pb: 2,
                      borderBottom: index < data.consultationRequests.length - 1 ? '1px solid #E6E9EE' : 'none',
                    }}
                  >
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      ID: {req.id}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      Lawyer ID: {req.lawyerId || 'N/A'}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      Lawyer Name: {req.lawyerName || 'N/A'}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      Client: {req.client?.name || 'N/A'}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      Status: {req.status}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      Question: {req.question?.substring(0, 50)}...
                    </Typography>
                  </Box>
                ))
              ) : (
                <Typography variant="body2" sx={{ color: '#6B7280' }}>
                  No requests in localStorage
                </Typography>
              )}
            </Paper>
          </Box>

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<Delete />}
              onClick={handleClearRequests}
              fullWidth
            >
              Clear All Requests
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh />}
              onClick={loadDebugData}
              fullWidth
            >
              Refresh
            </Button>
          </Box>
        </Paper>
      </Collapse>
    </Box>
  );
};

export default DebugPanel;
