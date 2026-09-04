import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { axelionColors } from '../../theme/axelionTheme';
import SupportFAB from '../UI/SupportFAB';
import MobileBottomNav from '../UI/MobileBottomNav';

const Layout = () => {
  const location = useLocation();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: axelionColors.bgCream,
        pb: { xs: '72px', md: 0 },
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
      <SupportFAB />
      <MobileBottomNav />
    </Box>
  );
};

export default Layout;
