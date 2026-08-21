import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, CircularProgress } from '@mui/material';
import { CalendarMonthOutlined, FolderOpenOutlined, PaymentOutlined, VideocamOutlined } from '@mui/icons-material';
import { toast } from 'react-toastify';
import clientService from '../../services/clientService';
import { launchConsultation } from '../../services/meetingLauncher';
import GlassShell from '../../components/GlassKit/GlassShell';
import CaseDocuments from '../../components/Consultations/CaseDocuments';
import ErrorState from '../../components/UI/ErrorState';
import { useTranslation } from '../../i18n';

const card = { background: 'var(--card-glass)', border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', boxShadow: 'var(--card-shadow)', padding: 22 };

const ConsultationDetailsPage = () => {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const locale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';

  const load = async () => {
    try { setLoading(true); setError(null); setData(await clientService.consultations.getConsultationDetails(consultationId)); }
    catch (requestError) { setError(requestError); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [consultationId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <GlassShell active="/consultations" title={t('consultations.detailsTitle')}><div style={{ textAlign: 'center', padding: 60 }}><CircularProgress /></div></GlassShell>;
  if (error || !data?.consultation) return <GlassShell active="/consultations" title={t('consultations.detailsTitle')}><ErrorState error={error} onRetry={load} /></GlassShell>;

  const c = data.consultation;
  const start = c.scheduledStartAt ? new Date(c.scheduledStartAt) : null;
  const dateText = start && !Number.isNaN(start.getTime()) ? start.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' }) : t('consultations.notScheduled');
  const pay = async () => {
    setPaying(true);
    try {
      const result = await clientService.lawyers.payConsultation(c.id);
      if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
      toast.success(t('consultations.paymentSuccess')); await load();
    } catch (payError) { toast.error(payError.response?.data?.error || t('consultations.paymentError')); }
    finally { setPaying(false); }
  };

  return (
    <GlassShell active="/consultations" title={t('consultations.detailsTitle')} subtitle={c.lawyer?.name || t('consultations.lawyer')}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'grid', gap: 16 }}>
        <button type="button" onClick={() => navigate('/consultations')} style={{ justifySelf: 'start', border: 0, background: 'transparent', color: 'var(--accent-dark)', cursor: 'pointer' }}>← {t('consultations.back')}</button>
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>{c.lawyer?.name}</h2>
          <p><CalendarMonthOutlined sx={{ fontSize: 17, verticalAlign: 'middle', mr: 1 }} />{dateText}</p>
          <p><VideocamOutlined sx={{ fontSize: 17, verticalAlign: 'middle', mr: 1 }} />{t(`consultations.type_${c.type}`)} · {c.duration || 60} {t('booking.min')}</p>
          <p><b>{t('consultations.status')}:</b> {t(`consultations.status_${c.status}`)}</p>
          <p><b>{t('consultations.price')}:</b> {Number(c.price || 0).toLocaleString(locale)} {t('consultations.sum')}</p>
        </section>
        <section style={card}>
          <h3>{t('consultations.paymentTitle')}</h3>
          <p>{t(`consultations.payment_${data.payment?.status || 'unpaid'}`)} · {Number(data.payment?.amount || c.price || 0).toLocaleString(locale)} {t('consultations.sum')}</p>
          {data.payment?.paidAt && <p>{t('consultations.paymentDate')}: {new Date(data.payment.paidAt).toLocaleString(locale)}</p>}
          {c.status === 'payment_pending' && <Button startIcon={<PaymentOutlined />} disabled={paying} onClick={pay}>{paying ? t('consultations.paying') : t('consultations.pay')}</Button>}
        </section>
        <section style={card}><h3>{t('consultations.yourQuestion')}</h3><p>{c.question || '—'}</p>{c.description && <p>{c.description}</p>}</section>
        {c.lawyerSummary && <section style={card}><h3>{t('consultations.lawyerSummary')}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{c.lawyerSummary}</p></section>}
        <section style={card}>
          <h3>{t('consultations.historyTitle')}</h3>
          {(data.statusHistory || []).map((item, index) => <p key={`${item.status}-${index}`}>{new Date(item.at).toLocaleString(locale)} · {t(`consultations.status_${item.status}`)}</p>)}
        </section>
        <section style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {data.access?.canJoin && <Button onClick={() => launchConsultation(c, navigate)}>{t('consultations.joinCall')}</Button>}
          <Button startIcon={<FolderOpenOutlined />} onClick={() => setDocsOpen(true)}>{t('caseDocs.title')} ({data.documents?.count || 0})</Button>
        </section>
      </div>
      <CaseDocuments consultationId={c.id} open={docsOpen} onClose={() => setDocsOpen(false)} />
    </GlassShell>
  );
};

export default ConsultationDetailsPage;
