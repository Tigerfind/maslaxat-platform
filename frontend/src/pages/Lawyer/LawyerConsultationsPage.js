import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { CircularProgress } from '@mui/material';
import {
  VideocamOutlined, ChatBubbleOutline, CheckOutlined, CloseOutlined,
  FolderOpenOutlined, PlayArrowOutlined, PersonOutline,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import lawyerService from '../../services/lawyerService';
import GlassShell from '../../components/GlassKit/GlassShell';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import ConsultationTimeline from '../../components/Consultations/ConsultationTimeline';
import { useTranslation } from '../../i18n';

/*
  LAWYER CONSULTATIONS  (/lawyer/consultations)
  Все дела юриста в одном месте: заявки / активные / завершённые / архив.
  Данные: GET /lawyer/consultation-requests?status=all (без изменений бэкенда).
  Действия по статусу: принять/отклонить · начать · чат/видео · документы · завершить.
*/

const glassCard = {
  background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)', borderRadius: 'var(--radius)',
};

const initials = (n = '') => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const LawyerConsultationsPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [acting, setActing] = useState(null);
  const [docsFor, setDocsFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await lawyerService.consultation.getConsultationRequests('all');
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const TABS = [
    { key: 'all', label: t('lawyerConsult.tabAll') },
    { key: 'pending', label: t('lawyerConsult.tabRequests') },
    { key: 'active', label: t('lawyerConsult.tabActive') },
    { key: 'completed', label: t('lawyerConsult.tabDone') },
    { key: 'archive', label: t('lawyerConsult.tabArchive') },
  ];
  const inTab = (c) => {
    if (tab === 'all') return true;
    if (tab === 'pending') return c.status === 'pending';
    if (tab === 'active') return ['accepted', 'in_progress'].includes(c.status);
    if (tab === 'completed') return c.status === 'completed';
    if (tab === 'archive') return ['rejected', 'cancelled', 'payment_pending'].includes(c.status);
    return true;
  };
  const countOf = (key) => items.filter((c) => {
    if (key === 'all') return true;
    if (key === 'pending') return c.status === 'pending';
    if (key === 'active') return ['accepted', 'in_progress'].includes(c.status);
    if (key === 'completed') return c.status === 'completed';
    if (key === 'archive') return ['rejected', 'cancelled', 'payment_pending'].includes(c.status);
    return false;
  }).length;

  const STATUS_META = {
    pending: { label: t('lawyerConsult.stPending'), c: '#C4A35A', bg: 'rgba(196,163,90,0.14)' },
    accepted: { label: t('lawyerConsult.stAccepted'), c: '#6A8A9A', bg: 'rgba(106,138,154,0.14)' },
    in_progress: { label: t('lawyerConsult.stInProgress'), c: '#7A9A6B', bg: 'rgba(122,154,107,0.14)' },
    completed: { label: t('lawyerConsult.stCompleted'), c: '#7A9A6B', bg: 'rgba(122,154,107,0.14)' },
    rejected: { label: t('lawyerConsult.stRejected'), c: '#C0492F', bg: 'rgba(192,73,47,0.12)' },
    cancelled: { label: t('lawyerConsult.stCancelled'), c: '#C0492F', bg: 'rgba(192,73,47,0.12)' },
    payment_pending: { label: t('lawyerConsult.stPaymentPending'), c: '#A79E93', bg: 'rgba(140,130,120,0.12)' },
  };

  const accept = async (id) => {
    setActing(id);
    try { await lawyerService.consultation.acceptConsultationRequest(id); toast.success(t('lawyerPanel.requestAccepted')); await load(); }
    catch { toast.error(t('lawyerPanel.acceptError')); } finally { setActing(null); }
  };
  const reject = async (id) => {
    const reason = window.prompt(t('lawyerConsult.rejectPrompt'));
    if (reason === null) return;
    setActing(id);
    try { await lawyerService.consultation.rejectConsultationRequest(id, reason.trim()); toast.info(t('lawyerPanel.requestRejected')); await load(); }
    catch { toast.error(t('lawyerPanel.rejectError')); } finally { setActing(null); }
  };
  const start = async (id) => {
    setActing(id);
    try { await lawyerService.consultation.startConsultation(id); await load(); }
    catch { toast.error(t('lawyerPanel.genericError')); } finally { setActing(null); }
  };
  const finish = async (id) => {
    if (!window.confirm(t('lawyerConsult.finishConfirm'))) return;
    setActing(id);
    try { await lawyerService.consultation.endConsultation(id, ''); toast.success(t('lawyerConsult.finished')); await load(); }
    catch { toast.error(t('lawyerPanel.genericError')); } finally { setActing(null); }
  };

  const footBtn = (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent',
    border: '1px solid var(--card-brd)', color, borderRadius: 10, padding: '8px 14px',
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  });

  const visible = items.filter(inTab);

  return (
    <GlassShell active="/lawyer/consultations" title={t('lawyerConsult.title')} subtitle={t('lawyerConsult.subtitle')} role="lawyer">
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
          {TABS.map((tb) => {
            const on = tab === tb.key;
            const n = countOf(tb.key);
            return (
              <button key={tb.key} onClick={() => setTab(tb.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 999,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--card-brd)'}`,
                  background: on ? 'linear-gradient(135deg,var(--accent),var(--accent-dark))' : 'var(--card-glass)',
                  color: on ? '#fff' : 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {tb.label}
                <span style={{ fontSize: 11, opacity: on ? 0.9 : 0.6, background: on ? 'rgba(255,255,255,0.2)' : 'var(--border)', borderRadius: 999, padding: '1px 7px' }}>{n}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><CircularProgress sx={{ color: 'var(--accent)' }} /></div>
        ) : visible.length === 0 ? (
          <div style={{ ...glassCard, padding: 48, textAlign: 'center', color: 'var(--text3)' }}>
            <PersonOutline sx={{ fontSize: 40, opacity: 0.5, mb: 1 }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text2)' }}>{t('lawyerConsult.empty')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {visible.map((c) => {
              const isVideo = c.consultationType === 'video';
              const sm = STATUS_META[c.status] || { label: c.status, c: 'var(--text3)', bg: 'var(--border)' };
              const busy = acting === c.id;
              return (
                <div key={c.id} style={{ ...glassCard, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: '50%', background: c.client?.avatar ? `center/cover url(${c.client.avatar})` : 'linear-gradient(135deg,#B8956E,#8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 600 }}>
                      {!c.client?.avatar && initials(c.client?.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{c.client?.name || t('lawyerPanel.clientFallback')}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: sm.c, background: sm.bg, padding: '3px 10px', borderRadius: 999 }}>{sm.label}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text3)' }}>
                          {isVideo ? <VideocamOutlined sx={{ fontSize: 15 }} /> : <ChatBubbleOutline sx={{ fontSize: 15 }} />}
                          {isVideo ? t('lawyerPanel.typeVideo') : t('lawyerPanel.typeChat')}
                        </span>
                      </div>
                      {(c.preferredDate || c.preferredTime) && (
                        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 4 }}>{c.preferredDate} {c.preferredTime}</div>
                      )}
                      {c.question && <div style={{ fontSize: 13.5, color: 'var(--text2)', marginTop: 8, lineHeight: 1.45 }}>{c.question}</div>}
                    </div>
                    {c.price != null && (
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{(c.price || 0).toLocaleString()} {t('lawyerPanel.sum')}</div>
                    )}
                  </div>

                  {/* Таймлайн статуса — где сейчас бронь и что дальше */}
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    <ConsultationTimeline status={c.status} role="lawyer" />
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                    {c.status === 'pending' && (
                      <>
                        <button disabled={busy} onClick={() => accept(c.id)} style={{ ...footBtn('#fff'), background: 'var(--accent)', border: 'none' }}>
                          <CheckOutlined sx={{ fontSize: 16 }} /> {t('lawyerPanel.accept')}
                        </button>
                        <button disabled={busy} onClick={() => reject(c.id)} style={footBtn('var(--error, #C0492F)')}>
                          <CloseOutlined sx={{ fontSize: 16 }} /> {t('lawyerPanel.reject')}
                        </button>
                      </>
                    )}
                    {c.status === 'accepted' && (
                      <button disabled={busy} onClick={() => start(c.id)} style={{ ...footBtn('#fff'), background: 'var(--accent)', border: 'none' }}>
                        <PlayArrowOutlined sx={{ fontSize: 17 }} /> {t('lawyerConsult.start')}
                      </button>
                    )}
                    {['accepted', 'in_progress'].includes(c.status) && (
                      <button onClick={() => navigate(`/consultations/${isVideo ? 'video' : 'chat'}/${c.id}`)} style={footBtn('var(--accent-dark)')}>
                        {isVideo ? <VideocamOutlined sx={{ fontSize: 16 }} /> : <ChatBubbleOutline sx={{ fontSize: 16 }} />}
                        {isVideo ? t('lawyerConsult.openVideo') : t('lawyerConsult.openChat')}
                      </button>
                    )}
                    {c.status === 'in_progress' && (
                      <button disabled={busy} onClick={() => finish(c.id)} style={footBtn('#7A9A6B')}>
                        <CheckOutlined sx={{ fontSize: 16 }} /> {t('lawyerConsult.finish')}
                      </button>
                    )}
                    {c.status === 'completed' && (
                      <button onClick={() => navigate(`/consultations/chat/${c.id}`)} style={footBtn('var(--text2)')}>
                        <ChatBubbleOutline sx={{ fontSize: 16 }} /> {t('lawyerConsult.chatHistory')}
                      </button>
                    )}
                    {['accepted', 'in_progress', 'completed'].includes(c.status) && (
                      <button onClick={() => setDocsFor(c)} style={footBtn('var(--accent-dark)')}>
                        <FolderOpenOutlined sx={{ fontSize: 16 }} /> {t('caseDocs.title')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CaseDocuments
        consultationId={docsFor?.id}
        open={Boolean(docsFor)}
        onClose={() => setDocsFor(null)}
        currentUserId={user?.id}
      />
    </GlassShell>
  );
};

export default LawyerConsultationsPage;
