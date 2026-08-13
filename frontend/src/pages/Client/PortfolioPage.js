import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  DescriptionOutlined,
  GavelOutlined,
  ChatBubbleOutline,
  FavoriteBorderOutlined,
  CheckCircleOutline,
  AutoAwesomeOutlined,
  StarBorderOutlined,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import EmptyState from '../../components/UI/EmptyState';
import GlassShell from '../../components/GlassKit/GlassShell';
import MarkdownMessage from '../../components/MarkdownMessage';
import { useTranslation } from '../../i18n';

/*
  ─────────────────────────────────────────────────────────────
  ЮРИДИЧЕСКОЕ ДОСЬЕ  (/portfolio)
  Ported 1:1 from ClaudeDesign → client/09_ДОСЬЕ_PORTFOLIO.html.
  Aggregator of everything the client has accumulated on the platform.
   • 4 glass stat cards ← documents / consultations / aiConversations / favorites
   • Tabs → Документы | Дела (MATTERS) | AI-ответы (AI ANSWERS) | Хроника (TIMELINE)
   • Empty tab → <EmptyState>
  Data layer is UNCHANGED — same Promise.all of clientService calls.
  Chrome (sidebar + topbar + dark toggle + lang + bell) = <GlassShell>.
  ─────────────────────────────────────────────────────────────
*/

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const tabBtnStyle = (active) => ({
  padding: '9px 18px',
  borderRadius: 'var(--radius)',
  border: active ? '1px solid transparent' : '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'var(--card-glass)',
  color: active ? '#FFFFFF' : 'var(--text2)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.03em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 0.2s, color 0.2s',
});

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
};

// Consultation status → visual meta for MATTERS cards
const matterMeta = (status) => {
  switch (status) {
    case 'completed':
      return { key: 'matterCompleted', color: '#7A9A6B', bg: 'rgba(122,154,107,0.14)', prog: 100 };
    case 'active':
    case 'in_progress':
      return { key: 'matterInProgress', color: 'var(--accent-dark)', bg: 'rgba(184,149,110,0.14)', prog: 60 };
    case 'confirmed':
      return { key: 'matterConfirmed', color: '#6A8A9A', bg: 'rgba(106,138,154,0.14)', prog: 40 };
    case 'cancelled':
      return { key: 'matterCancelled', color: '#B07070', bg: 'rgba(176,112,112,0.14)', prog: 0 };
    default:
      return { key: 'matterPending', color: '#B8956E', bg: 'rgba(184,149,110,0.10)', prog: 20 };
  }
};

const PortfolioPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [aiConversations, setAiConversations] = useState([]);
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    loadPortfolioData();
    // Portfolio datasets are loaded once when the route opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPortfolioData = async () => {
    try {
      setLoading(true);
      const [docsData, consData, aiData, favsData] = await Promise.all([
        clientService.documents.getDocuments(),
        clientService.consultations.getConsultations('all'),
        clientService.aiChat.getConversations(),
        clientService.favorites.getFavorites(),
      ]);

      setDocuments(Array.isArray(docsData) ? docsData : []);
      setConsultations(Array.isArray(consData) ? consData : []);
      setAiConversations(Array.isArray(aiData) ? aiData : []);
      setFavorites(Array.isArray(favsData) ? favsData : []);
    } catch (error) {
      console.error('Error loading portfolio:', error);
      toast.error(t('portfolio.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { value: documents.length, label: t('portfolio.statDocuments') },
    { value: consultations.length, label: t('portfolio.statConsultations') },
    { value: aiConversations.length, label: t('portfolio.statAiChats') },
    { value: favorites.length, label: t('portfolio.statFavorites') },
  ];

  const tabs = [t('portfolio.tabDocuments'), t('portfolio.tabMatters'), t('portfolio.tabAiAnswers'), t('portfolio.tabTimeline')];

  // Aggregated timeline (uses ALL datasets)
  const timeline = [
    ...documents.map((d) => ({
      icon: <DescriptionOutlined sx={{ fontSize: 19 }} />,
      title: `${t('portfolio.tlDocUploaded')}: ${d.name || t('portfolio.untitled')}`,
      date: d.createdAt,
      tint: 'rgba(106,138,154,0.14)',
      color: '#6A8A9A',
    })),
    ...consultations.map((c) => ({
      icon: <GavelOutlined sx={{ fontSize: 19 }} />,
      title: `${t('portfolio.tlConsultation')}: ${c.topic || c.lawyerName || t('portfolio.lawyer')}`,
      date: c.createdAt,
      tint: 'rgba(184,149,110,0.14)',
      color: 'var(--accent-dark)',
    })),
    ...aiConversations.map((a) => ({
      icon: <ChatBubbleOutline sx={{ fontSize: 19 }} />,
      title: `${t('portfolio.tlAiDialog')}: ${a.title || t('portfolio.aiConsultation')}`,
      date: a.createdAt,
      tint: 'rgba(122,154,107,0.14)',
      color: '#7A9A6B',
    })),
    ...favorites.map((f) => ({
      icon: <FavoriteBorderOutlined sx={{ fontSize: 19 }} />,
      title: `${t('portfolio.tlFavLawyer')}: ${f.name || t('portfolio.lawyer')}`,
      date: f.createdAt || f.updatedAt,
      tint: 'rgba(196,163,90,0.16)',
      color: '#C4A35A',
    })),
  ]
    .filter((e) => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <GlassShell active="/portfolio" title={t('portfolio.title')} subtitle={t('portfolio.subtitle')}>
      <div style={{ maxWidth: 1020, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Stat overview */}
        <div className="dossier-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {statCards.map((s, i) => (
            <div key={i} style={{ ...glassCard, padding: '22px 20px' }}>
              <div style={{ fontSize: 30, fontWeight: 300, color: 'var(--accent-dark)', letterSpacing: '-0.01em' }}>
                {loading ? '—' : s.value}
              </div>
              <div style={{ fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginTop: 6 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tabs.map((label, i) => (
            <button key={label} onClick={() => setActiveTab(i)} style={tabBtnStyle(activeTab === i)}>
              {label}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ ...glassCard, padding: '48px 28px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            {t('common.loading')}
          </div>
        )}

        {/* ── ДОКУМЕНТЫ ── */}
        {!loading && activeTab === 0 && (
          documents.length === 0 ? (
            <EmptyState
              icon={<DescriptionOutlined sx={{ fontSize: 36 }} />}
              title={t('portfolio.emptyDocsTitle')}
              subtitle={t('portfolio.emptyDocsSub')}
              actionLabel={t('portfolio.uploadDoc')}
              onAction={() => navigate('/documents')}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => navigate('/documents')}
                  style={{ ...glassCard, padding: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 'var(--radius)', background: 'rgba(184,149,110,0.14)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <DescriptionOutlined sx={{ fontSize: 22 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{fmtDate(doc.createdAt)}</div>
                  </div>
                  {doc.aiAnalysis && (
                    <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color: '#7A9A6B', background: 'rgba(122,154,107,0.14)', padding: '5px 10px', borderRadius: 'var(--radius)' }}>
                      <CheckCircleOutline sx={{ fontSize: 14 }} /> AI
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* ── ДЕЛА (MATTERS) ── */}
        {!loading && activeTab === 1 && (
          consultations.length === 0 ? (
            <EmptyState
              icon={<GavelOutlined sx={{ fontSize: 36 }} />}
              title={t('portfolio.emptyMattersTitle')}
              subtitle={t('portfolio.emptyMattersSub')}
              actionLabel={t('portfolio.findLawyer')}
              onAction={() => navigate('/lawyers')}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {consultations.map((m) => {
                const meta = matterMeta(m.status);
                return (
                  <div
                    key={m.id}
                    onClick={() => navigate('/consultations')}
                    style={{ ...glassCard, padding: 22, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{m.topic || t('portfolio.consultationDefault')}</div>
                        <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                          {t('portfolio.lawyerLabel')}: {m.lawyerName || '—'} · {fmtDate(m.createdAt)}
                        </div>
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: meta.color, background: meta.bg, padding: '5px 12px', borderRadius: 'var(--radius)' }}>
                        {t('portfolio.' + meta.key)}
                      </span>
                    </div>
                    <div style={{ margin: '14px 0 8px', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)' }}>
                      <span>{m.price > 0 ? `${Number(m.price).toLocaleString('ru-RU')} ${t('portfolio.sum')}` : t('portfolio.free')}</span>
                      <span style={{ fontWeight: 600 }}>{meta.prog}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ width: `${meta.prog}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-dark))' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── AI-ОТВЕТЫ (AI ANSWERS) ── */}
        {!loading && activeTab === 2 && (
          aiConversations.length === 0 ? (
            <EmptyState
              icon={<AutoAwesomeOutlined sx={{ fontSize: 36 }} />}
              title={t('portfolio.emptyAiTitle')}
              subtitle={t('portfolio.emptyAiSub')}
              actionLabel={t('portfolio.openAiChat')}
              onAction={() => navigate('/ai-chat')}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {aiConversations.map((a) => {
                const preview = a.preview || a.lastMessage || a.summary;
                return (
                  <div key={a.id} style={{ ...glassCard, padding: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: preview ? 12 : 0 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{a.title || t('portfolio.aiConsultation')}</div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                          <span style={{ color: 'var(--accent-dark)' }}>{a.category || t('portfolio.aiConsultant')}</span>
                          <span>{fmtDate(a.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    {preview && (
                      <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text2)', borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
                        <MarkdownMessage text={preview} />
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                      <button
                        onClick={() => navigate('/ai-chat')}
                        style={{ background: 'transparent', border: 'none', fontFamily: 'inherit', fontSize: 12, letterSpacing: '0.04em', color: 'var(--accent-dark)', cursor: 'pointer' }}
                      >
                        {t('portfolio.continueInChat')} →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── ХРОНИКА (TIMELINE) ── */}
        {!loading && activeTab === 3 && (
          timeline.length === 0 ? (
            <EmptyState
              icon={<StarBorderOutlined sx={{ fontSize: 36 }} />}
              title={t('portfolio.emptyTlTitle')}
              subtitle={t('portfolio.emptyTlSub')}
            />
          ) : (
            <div style={{ ...glassCard, padding: '26px 24px' }}>
              {timeline.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '12px 0',
                    borderBottom: i < timeline.length - 1 ? '1px dashed var(--border)' : 'none',
                  }}
                >
                  <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '50%', background: e.tint, color: e.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {e.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{e.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{fmtDate(e.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <style>{`@media (max-width: 720px){ .dossier-stats { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
    </GlassShell>
  );
};

export default PortfolioPage;
