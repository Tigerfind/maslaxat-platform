import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Box,
  Card,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { axelionColors } from '../../theme/axelionTheme';

/**
 * ResponsiveTable
 *
 * На десктопе показывает таблицу, на мобиле — карточки
 *
 * Props:
 * - columns: [{ key: string, label: string, align?: string, render?: (row) => JSX }]
 * - rows: [{ id: string/number, ...data }]
 * - renderMobileCard: (row, index) => JSX (кастомный рендер карточки для мобиле)
 * - emptyMessage: string (сообщение когда нет данных)
 */
const ResponsiveTable = ({
  columns = [],
  rows = [],
  renderMobileCard,
  emptyMessage = 'Нет данных',
}) => {
  const isMobile = useMediaQuery('(max-width:767px)');

  if (rows.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography sx={{ color: axelionColors.textMuted, fontSize: '0.9rem' }}>
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  if (isMobile) {
    // Mobile: render cards
    if (renderMobileCard) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {rows.map((row, index) => renderMobileCard(row, index))}
        </Box>
      );
    }

    // Default mobile card fallback
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {rows.map((row) => (
          <Card
            key={row.id}
            sx={{
              p: 2,
              bgcolor: axelionColors.bgWarm,
              border: `1px solid ${axelionColors.borderLight}`,
              borderRadius: '8px',
            }}
          >
            {columns.map((col) => (
              <Box key={col.key} sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
                <Typography
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: axelionColors.textMuted,
                    mb: 0.5,
                  }}
                >
                  {col.label}
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', color: axelionColors.textDark }}>
                  {col.render ? col.render(row) : row[col.key]}
                </Typography>
              </Box>
            ))}
          </Card>
        ))}
      </Box>
    );
  }

  // Desktop: render table
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                align={col.align || 'left'}
                sx={{
                  color: axelionColors.textMuted,
                  fontWeight: 500,
                  fontSize: '0.7rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  borderBottom: `1px solid ${axelionColors.borderLight}`,
                  backgroundColor: axelionColors.bgWarm,
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              sx={{
                '&:hover': {
                  backgroundColor: axelionColors.bgWarm,
                },
              }}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  align={col.align || 'left'}
                  sx={{
                    borderBottom: `1px solid ${axelionColors.borderLight}`,
                  }}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ResponsiveTable;
