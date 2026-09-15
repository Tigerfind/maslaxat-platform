import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge, Box, Chip, Typography } from '@mui/material';
import { Forum } from '@mui/icons-material';
import GlassShell from '../../components/GlassKit/GlassShell';
import { cabinetCardSx, formatDateTime, OfflineAlert, PagePagination, PageState } from '../../components/Client/CabinetUI';
import clientService from '../../services/clientService';
import { useTranslation } from '../../i18n';
import useOnlineStatus from '../../hooks/useOnlineStatus';

const MessagesPage = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, conversations: [], totalPages: 1, totalUnread: 0 });
  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await clientService.cabinet.getMessages({ page, limit: 20 });
      setState({ loading: false, error: null, conversations: data.conversations, totalPages: data.totalPages || 1, totalUnread: data.totalUnread || 0 });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error }));
    }
  };
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  return <GlassShell active="/messages" title={t('cabinet.messages')} subtitle={t('cabinet.unreadTotal', { count: state.totalUnread })}>
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <OfflineAlert online={online} text={t('cabinet.offline')} />
      <PageState loading={state.loading} error={state.error} onRetry={load} empty={!state.conversations.length} emptyIcon={<Forum />} emptyTitle={t('cabinet.noMessages')} emptySubtitle={t('cabinet.noMessagesHint')}>
        <Box sx={{ ...cabinetCardSx, p: 0, overflow: 'hidden' }}>
          {state.conversations.map((conversation) => {
            const lawyer = conversation.partner || conversation.lawyer || conversation.participant || {};
            const status = conversation.consultationStatus || conversation.status;
            return <Box component="button" key={conversation.consultationId || conversation.id} onClick={() => navigate(`/consultations/chat/${conversation.consultationId || conversation.id}`)} sx={{ width: '100%', minHeight: 76, p: 2, display: 'flex', alignItems: 'center', gap: 1.5, textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', bgcolor: conversation.unreadCount ? 'rgba(184,149,110,.1)' : 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
              <Badge color="primary" badgeContent={conversation.unreadCount || 0}><Avatar src={lawyer.avatar}>{lawyer.name?.[0]}</Avatar></Badge>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={conversation.unreadCount ? 700 : 500} noWrap>{lawyer.name || conversation.lawyerName}</Typography><Typography variant="body2" color="text.secondary" noWrap>{conversation.lastMessage?.excerpt || conversation.lastMessage?.text || conversation.excerpt || t('cabinet.noMessagePreview')}</Typography></Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}><Typography variant="caption" color="text.secondary">{formatDateTime(conversation.lastMessage?.createdAt || conversation.updatedAt, language)}</Typography>{status && <Chip size="small" label={t(`consultations.status_${status}`)} sx={{ display: 'flex', mt: .5 }} />}</Box>
            </Box>;
          })}
        </Box>
        <PagePagination page={page} totalPages={state.totalPages} onChange={setPage} label={t('cabinet.pagination')} />
      </PageState>
    </Box>
  </GlassShell>;
};

export default MessagesPage;
