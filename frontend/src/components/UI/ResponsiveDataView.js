import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

export const mobileCardSx = {
  p: 2,
  border: `1px solid ${axelionColors.borderLight}`,
  borderRadius: '8px',
  bgcolor: axelionColors.bgLight,
  minWidth: 0,
  overflowWrap: 'anywhere',
};

export const MobileDataField = ({ label, children, fullWidth = false }) => (
  <Box component="div" sx={{ minWidth: 0, gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
    <Typography component="dt" variant="caption" sx={{ color: axelionColors.textMuted, mb: 0.25 }}>
      {label}
    </Typography>
    <Box component="dd" sx={{ m: 0, color: axelionColors.textDark, fontSize: 14, overflowWrap: 'anywhere', minWidth: 0 }}>
      {children}
    </Box>
  </Box>
);

/** Keeps the dense table on tablet/desktop and exposes the same rows as cards on phones. */
const ResponsiveDataView = ({ items, desktop, renderMobileItem, mobileLabel, emptyLabel }) => (
  <>
    <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }} data-testid="responsive-data-table">
      {desktop}
    </Box>
    <Stack
      component="section"
      aria-label={mobileLabel}
      data-testid="responsive-data-cards"
      spacing={1.5}
      sx={{ display: { xs: 'flex', sm: 'none' }, minWidth: 0 }}
    >
      {items.length === 0 && emptyLabel ? (
        <Typography sx={{ textAlign: 'center', py: 4, color: axelionColors.textMuted }}>{emptyLabel}</Typography>
      ) : items.map((item, index) => (
        <Box component="article" key={item.id || index} sx={mobileCardSx}>
          {renderMobileItem(item, index)}
        </Box>
      ))}
    </Stack>
  </>
);

export default ResponsiveDataView;
