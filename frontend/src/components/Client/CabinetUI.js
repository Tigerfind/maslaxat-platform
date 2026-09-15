import React from 'react';
import { Alert, Box, Button, CircularProgress, Pagination, Typography } from '@mui/material';
import ErrorState from '../UI/ErrorState';
import EmptyState from '../UI/EmptyState';
import { SkeletonCard } from '../UI/Skeleton';

export const cabinetCardSx = {
  bgcolor: 'var(--card-glass)', border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)',
  boxShadow: 'var(--card-shadow)', backdropFilter: 'blur(24px) saturate(180%)', p: { xs: 2, sm: 2.5 },
};

export const localeFor = (language) => ({ ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' }[language] || 'ru-RU');

export const formatDateTime = (value, language, options = {}) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const { dateOnly = false, ...intlOptions } = options;
  return new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'medium', timeStyle: dateOnly ? undefined : 'short', ...intlOptions,
  }).format(date);
};

export const PageState = ({ loading, error, empty, onRetry, emptyIcon, emptyTitle, emptySubtitle, children }) => {
  if (loading) return <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 2 }}>{[0, 1, 2].map((n) => <SkeletonCard key={n} />)}</Box>;
  if (error) return <Box sx={cabinetCardSx}><ErrorState error={error} onRetry={onRetry} /></Box>;
  if (empty) return <Box sx={cabinetCardSx}><EmptyState icon={emptyIcon} title={emptyTitle} subtitle={emptySubtitle} /></Box>;
  return children;
};

export const OfflineAlert = ({ online, text }) => !online && <Alert severity="warning" sx={{ mb: 2 }}>{text}</Alert>;

export const PagePagination = ({ page, totalPages, onChange, label }) => totalPages > 1 && (
  <Box component="nav" aria-label={label} sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
    <Pagination page={page} count={totalPages} onChange={(_, value) => onChange(value)} />
  </Box>
);

export const PrimaryButton = ({ children, ...props }) => <Button variant="contained" {...props} sx={{ minHeight: 44, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent-dark)' }, ...props.sx }}>{children}</Button>;

export class WidgetBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <Box sx={cabinetCardSx}><Typography color="error">{this.props.fallback}</Typography></Box>;
    return this.props.children;
  }
}

export const BusyButton = ({ busy, children, ...props }) => <Button {...props} disabled={busy || props.disabled} sx={{ minHeight: 44, ...props.sx }}>{busy ? <CircularProgress size={20} /> : children}</Button>;
