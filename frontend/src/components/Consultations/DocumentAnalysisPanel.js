import React from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material';
import { AutoAwesomeOutlined } from '@mui/icons-material';
import { useTranslation } from '../../i18n';
import { consultationDialogPaperSx, localeForLanguage } from '../../utils/consultationLocale';

const hasItems = (value) => Array.isArray(value) && value.length > 0;

const formatCompletedAt = (value, locale) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const Section = ({ title, children }) => (
  <Box component="section">
    <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700, mb: 0.75 }}>{title}</Typography>
    {children}
  </Box>
);

const TextList = ({ items }) => (
  <List dense disablePadding sx={{ pl: 2, listStyleType: 'disc' }}>
    {items.map((item, index) => (
      <ListItem key={`${item}-${index}`} disableGutters sx={{ display: 'list-item', py: 0.2 }}>
        <ListItemText primary={item} primaryTypographyProps={{ fontSize: 13.5, sx: { overflowWrap: 'anywhere' } }} />
      </ListItem>
    ))}
  </List>
);

const DocumentAnalysisPanel = ({
  open,
  onClose,
  documentName,
  analysis,
  loading = false,
  error = '',
  onRetry,
  onRefresh,
}) => {
  const { t, language } = useTranslation();
  const result = analysis?.result;
  const status = analysis?.status;
  const isProcessing = status === 'pending' || status === 'processing';
  const failed = status === 'failed';
  const completedAt = formatCompletedAt(analysis?.completedAt, localeForLanguage(language));
  const localizedStatuses = ['completed', 'processing', 'pending', 'failed'];
  const statusLabel = localizedStatuses.includes(status) ? t(`caseDocs.analysisStatus_${status}`) : status;

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="document-analysis-title" maxWidth="md" fullWidth PaperProps={{ sx: consultationDialogPaperSx }}>
      <DialogTitle id="document-analysis-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeOutlined sx={{ color: 'var(--accent)' }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" sx={{ display: 'block', fontWeight: 600 }}>{t('caseDocs.analysisTitle')}</Typography>
          <Typography component="span" sx={{ display: 'block', color: 'var(--text2)', fontSize: 12, overflowWrap: 'anywhere' }}>{documentName}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box role="status" sx={{ textAlign: 'center', py: 5 }}>
            <CircularProgress size={28} />
            <Typography sx={{ mt: 1.5, color: 'var(--text2)', fontSize: 13 }}>{t('caseDocs.analysisProcessing')}</Typography>
          </Box>
        ) : error ? (
          <Alert severity="error" action={onRetry ? <Button color="inherit" onClick={onRetry}>{t('caseDocs.retry')}</Button> : null}>
            {error}
          </Alert>
        ) : isProcessing ? (
          <Alert severity="info" action={onRefresh ? <Button color="inherit" onClick={onRefresh}>{t('caseDocs.analysisRefresh')}</Button> : null}>
            {t('caseDocs.analysisPersistedProcessing')}
          </Alert>
        ) : failed ? (
          <Alert severity="error" action={onRetry ? <Button color="inherit" onClick={onRetry}>{t('caseDocs.retry')}</Button> : null}>
            {t('caseDocs.analysisFailed')}
          </Alert>
        ) : result ? (
          <Stack spacing={2.25} divider={<Divider flexItem />}>
            {result.documentType && <Section title={t('caseDocs.analysisType')}><Typography sx={{ fontSize: 13.5 }}>{result.documentType}</Typography></Section>}
            {hasItems(result.parties) && (
              <Section title={t('caseDocs.analysisParties')}>
                <List dense disablePadding>
                  {result.parties.map((party, index) => (
                    <ListItem key={`${party.name}-${party.role}-${index}`} disableGutters sx={{ py: 0.2 }}>
                      <ListItemText primary={party.name} secondary={party.role} primaryTypographyProps={{ fontSize: 13.5 }} secondaryTypographyProps={{ fontSize: 12 }} />
                    </ListItem>
                  ))}
                </List>
              </Section>
            )}
            {hasItems(result.keyDates) && (
              <Section title={t('caseDocs.analysisDates')}>
                <List dense disablePadding>
                  {result.keyDates.map((item, index) => (
                    <ListItem key={`${item.date}-${item.description}-${index}`} disableGutters sx={{ py: 0.2 }}>
                      <ListItemText primary={item.date} secondary={item.description} primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 12.5 }} />
                    </ListItem>
                  ))}
                </List>
              </Section>
            )}
            {(hasItems(result.amounts) || result.subject) && (
              <Section title={t('caseDocs.analysisAmountsSubject')}>
                {result.subject && <Typography sx={{ fontSize: 13.5, mb: hasItems(result.amounts) ? 1 : 0 }}>{result.subject}</Typography>}
                {hasItems(result.amounts) && result.amounts.map((item, index) => (
                  <Typography key={`${item.amount}-${item.currency}-${item.purpose}-${index}`} sx={{ fontSize: 13.5, mb: 0.4 }}>
                    <Box component="span" sx={{ fontWeight: 700 }}>{item.amount} {item.currency}</Box>{item.purpose ? ` — ${item.purpose}` : ''}
                  </Typography>
                ))}
              </Section>
            )}
            {hasItems(result.obligations) && <Section title={t('caseDocs.analysisObligations')}><TextList items={result.obligations} /></Section>}
            {hasItems(result.risks) && <Section title={t('caseDocs.analysisRisks')}><TextList items={result.risks} /></Section>}
            {result.summary && <Section title={t('caseDocs.analysisSummary')}><Typography sx={{ fontSize: 13.5, lineHeight: 1.65 }}>{result.summary}</Typography></Section>}
            {(status || analysis.model || analysis.promptVersion || completedAt || analysis.cached) && (
              <Box component="section">
                <Typography component="h3" sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', mb: 0.75 }}>{t('caseDocs.analysisMetadata')}</Typography>
                <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
                  {status && <Chip size="small" label={`${t('caseDocs.analysisStatus')}: ${statusLabel}`} />}
                  {analysis.model && <Chip size="small" label={`${t('caseDocs.analysisModel')}: ${analysis.model}`} />}
                  {analysis.promptVersion && <Chip size="small" label={`${t('caseDocs.analysisPromptVersion')}: ${analysis.promptVersion}`} />}
                  {completedAt && <Chip size="small" label={`${t('caseDocs.analysisCompletedAt')}: ${completedAt}`} />}
                  {analysis.cached && <Chip size="small" color="success" label={t('caseDocs.analysisCached')} />}
                </Stack>
              </Box>
            )}
          </Stack>
        ) : (
          <Alert severity="info">{t('caseDocs.analysisNoResult')}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('caseDocs.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentAnalysisPanel;
