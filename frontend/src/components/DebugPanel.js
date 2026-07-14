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
import { axelionColors } from '../theme/axelionTheme';

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
            bgcolor: axelionColors.gold,
            color: '#FFFFFF',
            '&:hover': {
              bgcolor: axelionColors.goldDark,
            },
            boxShadow: '0 4px 12px rgba(184, 149, 110, 0.3)',
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
            bgcolor: axelionColors.bgLight,
            border: `2px solid ${axelionColors.gold}`,
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <BugReport sx={{ color: axelionColors.gold }} />
              <Typography variant="h6" sx={{ fontWeight: 300, letterSpacing: '0.05em' }}>
                Debug Panel
              </Typography>
            </Box>
            <Box>
              <IconButton size="small" onClick={loadDebugData} sx={{ color: axelionColors.textSecondary }}>
                <Refresh />
              </IconButton>
              <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: axelionColors.textSecondary }}>
                <ExpandLess />
              </IconButton>
            </Box>
          </Box>

          {/* Current User Info */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: axelionColors.textMuted, mb: 1 }}>
              Current User:
            </Typography>
            <Paper sx={{ bgcolor: axelionColors.bgCream, p: 2, borderRadius: '8px', boxShadow: 'none' }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: axelionColors.textSecondary }}>
                ID: {data.currentUser?.id || 'N/A'}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: axelionColors.textSecondary }}>
                Name: {data.currentUser?.name || 'N/A'}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: axelionColors.textSecondary }}>
                Role: {data.currentUser?.role || 'N/A'}
              </Typography>
            </Paper>
          </Box>

          {/* Requests Stats */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: axelionColors.textMuted, mb: 1 }}>
              Consultation Requests Stats:
            </Typography>
            <Paper sx={{ bgcolor: axelionColors.bgCream, p: 2, borderRadius: '8px', boxShadow: 'none' }}>
              <Typography variant="body2" sx={{ color: axelionColors.textSecondary }}>Total: {data.totalRequests || 0}</Typography>
              <Typography variant="body2" sx={{ color: axelionColors.textSecondary }}>Pending: {data.pendingRequests || 0}</Typography>
              <Typography variant="body2" sx={{ color: axelionColors.textSecondary }}>Accepted: {data.acceptedRequests || 0}</Typography>
              <Typography variant="body2" sx={{ color: axelionColors.textSecondary }}>Rejected: {data.rejectedRequests || 0}</Typography>
            </Paper>
          </Box>

          {/* All Requests */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: axelionColors.textMuted, mb: 1 }}>
              All Consultation Requests:
            </Typography>
            <Paper
              sx={{
                bgcolor: axelionColors.bgCream,
                p: 2,
                maxHeight: 300,
                overflow: 'auto',
                borderRadius: '8px',
                boxShadow: 'none',
              }}
            >
              {data.consultationRequests && data.consultationRequests.length > 0 ? (
                data.consultationRequests.map((req, index) => (
                  <Box
                    key={req.id}
                    sx={{
                      mb: 2,
                      pb: 2,
                      borderBottom: index < data.consultationRequests.length - 1 ? `1px solid ${axelionColors.borderLight}` : 'none',
                    }}
                  >
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: axelionColors.textSecondary }}>
                      ID: {req.id}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: axelionColors.textSecondary }}>
                      Lawyer ID: {req.lawyerId || 'N/A'}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: axelionColors.textSecondary }}>
                      Lawyer Name: {req.lawyerName || 'N/A'}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: axelionColors.textSecondary }}>
                      Client: {req.client?.name || 'N/A'}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: axelionColors.textSecondary }}>
                      Status: {req.status}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: axelionColors.textSecondary }}>
                      Question: {req.question?.substring(0, 50)}...
                    </Typography>
                  </Box>
                ))
              ) : (
                <Typography variant="body2" sx={{ color: axelionColors.textMuted }}>
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
              startIcon={<Delete />}
              onClick={handleClearRequests}
              fullWidth
              sx={{
                borderColor: axelionColors.error,
                color: axelionColors.error,
                borderRadius: '8px',
                textTransform: 'none',
                '&:hover': {
                  borderColor: axelionColors.error,
                  bgcolor: axelionColors.errorLight,
                },
              }}
            >
              Clear All Requests
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh />}
              onClick={loadDebugData}
              fullWidth
              sx={{
                borderColor: axelionColors.gold,
                color: axelionColors.gold,
                borderRadius: '8px',
                textTransform: 'none',
                '&:hover': {
                  borderColor: axelionColors.goldDark,
                  bgcolor: axelionColors.accentLight,
                },
              }}
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
