import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import {
  VideocamOutlined, ChatBubbleOutline, CheckOutlined, CloseOutlined,
  FolderOpenOutlined, PlayArrowOutlined, PersonOutline,
  SearchOutlined, EditNoteOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';
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
  const [acceptFor, setAcceptFor] = useState(null); // заявка, которую принимаем (диалог)
  const [acceptMsg, setAcceptMsg] = useState('');
  const [greeting, setGreeting] = useState('');
  const [rejectFor, setRejectFor] = useState(null); // заявка, которую отклоняем (диалог)
  const [rejectMsg, setRejectMsg] = useState('');
  const [search, setSearch] = useState('');
  const [noteFor, setNoteFor] = useState(null); // id консультации с открытым редактором заметки
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

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
  // Подтягиваем автоприветствие юриста — им пред-заполним сообщение при принятии.
  useEffect(() => {
    api.get('/lawyer/profile').then((r) => setGreeting(r.data?.profile?.greeting || '')).catch(() => {});
  }, []);

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

  // Принятие → диалог с приветствием (пред-заполнено автоприветствием юриста).
  const openAccept = (c) => { setAcceptFor(c); setAcceptMsg(greeting || ''); };
  const confirmAccept = async () => {
    const c = acceptFor; if (!c) return;
    setActing(c.id);
    try {
      await lawyerService.consultation.acceptConsultationRequest(c.id, acceptMsg.trim());
      toast.success(t('lawyerPanel.requestAccepted'));
      setAcceptFor(null); setAcceptMsg('');
      await load();
    } catch { toast.error(t('lawyerPanel.acceptError')); }
    finally { setActing(null); }
  };
  // Отклонение → диалог с готовыми причинами (вместо window.prompt).
  const openReject = (c) => { setRejectFor(c); setRejectMsg(''); };
  const confirmReject = async () => {
    const c = rejectFor; if (!c) return;
    setActing(c.id);
    try {
      await lawyerService.consultation.rejectConsultationRequest(c.id, rejectMsg.trim());
      toast.info(t('lawyerPanel.requestRejected'));
      setRejectFor(null); setRejectMsg('');
      await load();
    } catch { toast.error(t('lawyerPanel.rejectError')); }
    finally { setActing(null); }
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

  // Поиск по имени клиента и тексту вопроса/проблем.
  const q = search.trim().toLowerCase();
  const matchesSearch = (c) => {
    if (!q) return true;
    const hay = [c.client?.name, c.question, ...(Array.isArray(c.problems) ? c.problems.map((p) => (typeof p === 'string' ? p : p?.text)) : [])]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  };
  const visible = items.filter(inTab).filter(matchesSearch);

  // Проблемы дела: [{text, categories}] | строки (legacy). Категории — id справочника.
  const problemsOf = (c) => {
    const raw = Array.isArray(c.problems) && c.problems.length ? c.problems : (c.question ? [c.question] : []);
    return raw.map((p) => (typeof p === 'string'
      ? { text: p, categories: [] }
      : { text: p?.text || '', categories: Array.isArray(p?.categories) ? p.categories : (p?.category ? [p.category] : []) }))
      .filter((p) => p.text);
  };
  const catLabel = (id) => { const v = t('specNames.' + id); return (!v || v === 'specNames.' + id) ? id : v; };

  const openNote = (c) => { setNoteFor(c.id); setNoteText(c.lawyerNote || ''); };
  const saveNote = async () => {
    const id = noteFor; if (!id) return;
    setNoteSaving(true);
    try {
      await lawyerService.consultation.saveNote(id, noteText);
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, lawyerNote: noteText } : c)));
      setNoteFor(null);
      toast.success(t('lawyerConsult.noteSaved'));
    } catch { toast.error(t('lawyerPanel.genericError')); }
    finally { setNoteSaving(false); }
  };

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

        {/* Поиск по клиенту/вопросу */}
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <SearchOutlined sx={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 19, color: 'var(--text3)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('lawyerConsult.searchPlaceholder')}
            style={{ width: '100%', padding: '11px 14px 11px 42px', borderRadius: 12, border: '1px solid var(--card-brd)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' }}
          />
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
              const secLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 };
              const sec = { padding: '16px 20px', borderTop: '1px solid var(--border)' };
              return (
                <div key={c.id} style={{ ...glassCard, padding: 0, overflow: 'hidden' }}>
                  {/* ── Хедер: клиент · статус · тип/дата · цена ── */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', background: 'linear-gradient(180deg, rgba(184,149,110,0.09), transparent)' }}>
                    <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: '50%', background: c.client?.avatar ? `center/cover url(${c.client.avatar})` : 'linear-gradient(135deg,#B8956E,#8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 600 }}>
                      {!c.client?.avatar && initials(c.client?.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15.5, fontWeight: 650, color: 'var(--text)' }}>{c.client?.name || t('lawyerPanel.clientFallback')}</span>
                        {c.repeatCount > 0 && (
                          <span title={t('lawyerConsult.repeatClient')} style={{ fontSize: 11, fontWeight: 600, color: '#7A9A6B', background: 'rgba(122,154,107,0.14)', padding: '3px 10px', borderRadius: 999 }}>
                            ★ {t('lawyerConsult.repeatClient')} · {c.repeatCount}
                          </span>
                        )}
                        <span style={{ fontSize: 11, fontWeight: 600, color: sm.c, background: sm.bg, padding: '3px 10px', borderRadius: 999 }}>{sm.label}</span>
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                        {isVideo ? <VideocamOutlined sx={{ fontSize: 15 }} /> : <ChatBubbleOutline sx={{ fontSize: 15 }} />}
                        {isVideo ? t('lawyerPanel.typeVideo') : t('lawyerPanel.typeChat')}
                        {(c.preferredDate || c.preferredTime) && <span>· {c.preferredDate} {c.preferredTime}</span>}
                      </div>
                    </div>
                    {c.price != null && (
                      <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text)', whiteSpace: 'nowrap' }}>{(c.price || 0).toLocaleString()} <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>{t('lawyerPanel.sum')}</span></div>
                    )}
                  </div>

                  {/* ── Секция: Дело ── */}
                  <div style={sec}>
                    <div style={secLabel}>{t('lawyerConsult.secCase')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {problemsOf(c).map((p, pi) => (
                        <div key={pi} style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>
                          <span>{problemsOf(c).length > 1 ? `${pi + 1}. ` : ''}{p.text}</span>
                          {p.categories.length > 0 && (
                            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 5, marginLeft: 6, verticalAlign: 'middle' }}>
                              {p.categories.map((cid) => (
                                <span key={cid} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--accent-dark)', background: 'rgba(184,149,110,0.14)', padding: '2px 8px', borderRadius: 999 }}>{catLabel(cid)}</span>
                              ))}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Секция: Статус ── */}
                  <div style={sec}>
                    <div style={secLabel}>{t('lawyerConsult.secStatus')}</div>
                    <ConsultationTimeline status={c.status} role="lawyer" />
                  </div>

                  {/* ── Секция: Заметка по делу ── */}
                  <div style={sec}>
                    <div style={secLabel}>📝 {t('lawyerConsult.noteAdd')}</div>
                    {noteFor === c.id ? (
                      <div>
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder={t('lawyerConsult.notePlaceholder')}
                          rows={3}
                          autoFocus
                          style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid var(--card-brd)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: 12, resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                          <button onClick={saveNote} disabled={noteSaving} style={{ ...footBtn('#fff'), background: 'var(--accent)', border: 'none' }}>
                            {noteSaving ? '…' : t('lawyerConsult.noteSave')}
                          </button>
                          <button onClick={() => setNoteFor(null)} style={footBtn('var(--text3)')}>{t('lawyerConsult.cancel')}</button>
                        </div>
                      </div>
                    ) : c.lawyerNote ? (
                      <div onClick={() => openNote(c)} title={t('lawyerConsult.noteEdit')} style={{ cursor: 'text', display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--surface)', border: '1px solid var(--card-brd)', borderRadius: 12, padding: '13px 15px' }}>
                        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, background: 'rgba(184,149,110,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <EditNoteOutlined sx={{ fontSize: 18, color: 'var(--accent-dark)' }} />
                        </span>
                        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', paddingTop: 4 }}>{c.lawyerNote}</div>
                      </div>
                    ) : (
                      <button onClick={() => openNote(c)} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'var(--surface)', border: '1px dashed var(--border-strong)', color: 'var(--text3)', borderRadius: 12, padding: '12px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <EditNoteOutlined sx={{ fontSize: 18 }} /> {t('lawyerConsult.noteAddPrompt')}
                      </button>
                    )}
                  </div>

                  {/* ── Действия ── */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '16px 20px', borderTop: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 4%, transparent)' }}>
                    {c.status === 'pending' && (
                      <>
                        <button disabled={busy} onClick={() => openAccept(c)} style={{ ...footBtn('#fff'), background: 'var(--accent)', border: 'none' }}>
                          <CheckOutlined sx={{ fontSize: 16 }} /> {t('lawyerPanel.accept')}
                        </button>
                        <button disabled={busy} onClick={() => openReject(c)} style={footBtn('var(--error, #C0492F)')}>
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

      {/* Принятие заявки + приветствие клиенту */}
      <Dialog open={Boolean(acceptFor)} onClose={() => setAcceptFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckOutlined sx={{ color: 'var(--accent)' }} /> {t('lawyerConsult.acceptTitle')}
        </DialogTitle>
        <DialogContent dividers>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            {t('lawyerConsult.acceptHint')}{acceptFor?.client?.name ? ` — ${acceptFor.client.name}` : ''}
          </div>
          {acceptFor?.repeatCount > 0 && (
            <div style={{ fontSize: 12.5, color: '#5c7a50', background: 'rgba(122,154,107,0.12)', border: '1px solid rgba(122,154,107,0.3)', borderRadius: 8, padding: '8px 11px', marginBottom: 12 }}>
              ★ {t('lawyerConsult.repeatClientNote', { n: acceptFor.repeatCount })}
            </div>
          )}
          <TextField
            fullWidth multiline minRows={3} value={acceptMsg}
            onChange={(e) => setAcceptMsg(e.target.value)}
            placeholder={t('lawyerConsult.acceptPlaceholder')}
            inputProps={{ maxLength: 2000 }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAcceptFor(null)} sx={{ textTransform: 'none', color: 'var(--text2)' }}>
            {t('lawyerConsult.cancel')}
          </Button>
          <Button onClick={confirmAccept} disabled={acting === acceptFor?.id} variant="contained"
            sx={{ textTransform: 'none', background: 'var(--accent)', '&:hover': { background: 'var(--accent-dark)' } }}>
            {acting === acceptFor?.id ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : t('lawyerConsult.acceptConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Отклонение заявки: готовые причины + необязательный комментарий */}
      <Dialog open={Boolean(rejectFor)} onClose={() => setRejectFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CloseOutlined sx={{ color: 'var(--error, #C0492F)' }} /> {t('lawyerConsult.rejectTitle')}
        </DialogTitle>
        <DialogContent dividers>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{t('lawyerConsult.rejectHint')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {[t('lawyerConsult.rr1'), t('lawyerConsult.rr2'), t('lawyerConsult.rr3'), t('lawyerConsult.rr4')].map((r) => {
              const on = rejectMsg === r;
              return (
                <button key={r} onClick={() => setRejectMsg(r)} style={{
                  cursor: 'pointer', padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontFamily: 'inherit',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--card-brd)'}`,
                  background: on ? 'rgba(184,149,110,0.14)' : 'transparent',
                  color: on ? 'var(--accent-dark)' : 'var(--text2)', fontWeight: on ? 600 : 400,
                }}>{r}</button>
              );
            })}
          </div>
          <TextField
            fullWidth multiline minRows={2} value={rejectMsg}
            onChange={(e) => setRejectMsg(e.target.value)}
            placeholder={t('lawyerConsult.rejectPlaceholder')}
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setRejectFor(null)} sx={{ textTransform: 'none', color: 'var(--text2)' }}>
            {t('lawyerConsult.cancel')}
          </Button>
          <Button onClick={confirmReject} disabled={acting === rejectFor?.id} variant="contained"
            sx={{ textTransform: 'none', background: 'var(--error, #C0492F)', '&:hover': { background: '#a53d28' } }}>
            {acting === rejectFor?.id ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : t('lawyerConsult.rejectConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </GlassShell>
  );
};

export default LawyerConsultationsPage;
