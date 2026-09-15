import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  AccessTimeOutlined,
  CalendarMonthOutlined,
  ChatBubbleOutline,
  CheckCircleOutline,
  Favorite,
  FavoriteBorder,
  HeadsetMicOutlined,
  LocationOnOutlined,
  OpenInNew,
  SchoolOutlined,
  TranslateOutlined,
  VerifiedOutlined,
  VideocamOutlined,
  WorkOutline,
  WorkspacePremiumOutlined,
} from '@mui/icons-material';
import { CircularProgress, Rating } from '@mui/material';
import clientService, { resolvePublicAssetUrl } from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';
import BookingModal from '../../components/BookingModal';
import { SkeletonLine } from '../../components/UI/Skeleton';
import { useTranslation } from '../../i18n';
import './LawyerProfilePage.css';

const REVIEW_PAGE_SIZE = 6;
const LOCALES = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' };
const FORMAT_ICONS = { chat: ChatBubbleOutline, audio: HeadsetMicOutlined, webrtc: VideocamOutlined, zoom: VideocamOutlined };

const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase() || '—';
const safeExternalUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};
const dateValue = (value) => value ? Date.parse(value) : NaN;
const formatDate = (value, language, options = { month: 'long', year: 'numeric' }) => (
  Number.isNaN(dateValue(value)) ? '' : new Intl.DateTimeFormat(LOCALES[language], options).format(new Date(value))
);
const experienceDuration = (start, end, t) => {
  if (Number.isNaN(dateValue(start))) return '';
  const from = new Date(start);
  const to = Number.isNaN(dateValue(end)) ? new Date() : new Date(end);
  const months = Math.max(0, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth());
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} ${t('lawyerProfileV2.yearShort')}` : '', rest ? `${rest} ${t('lawyerProfileV2.monthShort')}` : ''].filter(Boolean).join(' ');
};

const normalizeLawyer = (payload, fallbackName) => {
  const source = payload?.lawyer || payload || {};
  const profile = source.profile || {};
  const specializations = Array.isArray(profile.specializations) && profile.specializations.length
    ? profile.specializations : (profile.specialization ? [profile.specialization] : []);
  return {
    id: source.id,
    name: source.name || fallbackName,
    avatar: resolvePublicAssetUrl(source.avatar || source.photo),
    verified: profile.isVerifiedLawyer === true,
    professionalTitle: profile.professionalTitle || '',
    specializations,
    bio: profile.description || '',
    experience: Number(profile.experience) || 0,
    rating: Number(profile.rating) || 0,
    reviewsCount: Number(profile.reviewsCount) || 0,
    completedConsultations: Number(profile.completedCases) || 0,
    priceFrom: Number(profile.price) || 0,
    location: profile.location || '',
    region: profile.region || '',
    languages: Array.isArray(profile.languages) ? profile.languages : [],
    consultationFormats: Array.isArray(profile.consultationFormats) ? profile.consultationFormats : [],
    consultationDurations: Array.isArray(profile.consultationDurations) ? profile.consultationDurations : [],
    zoomAvailable: profile.zoomAvailable === true,
    isAvailable: profile.isAvailable === true,
    verifiedDocumentTypes: Array.isArray(profile.verifiedDocumentTypes) ? profile.verifiedDocumentTypes : [],
    medianResponseMinutes: Number.isFinite(Number(profile.medianResponseMinutes)) ? Number(profile.medianResponseMinutes) : null,
    licenseNumber: profile.licenseNumber || '',
    licenseIssuer: profile.licenseIssuer || '',
    licenseIssuedAt: profile.licenseIssuedAt || null,
    licenseExpiresAt: profile.licenseExpiresAt || null,
    linkedinUrl: safeExternalUrl(profile.linkedinUrl),
    experiences: Array.isArray(source.lawyerExperiences) ? source.lawyerExperiences : [],
    education: Array.isArray(source.lawyerEducations) ? [...source.lawyerEducations].sort((a, b) => Number(b.endYear || b.startYear || 0) - Number(a.endYear || a.startYear || 0)) : [],
    certifications: Array.isArray(source.lawyerCertificates) ? source.lawyerCertificates : [],
    online: source.presence?.online == null ? null : source.presence.online === true,
    lastSeenAt: source.presence?.lastSeenAt || null,
    presenceObservedAt: source.presence?.observedAt || null,
  };
};

const ProfileSkeleton = () => (
  <div className="lpv2-wrap" aria-label="Загрузка профиля">
    <div className="lpv2-card lpv2-skeleton-hero">
      <div className="sk lpv2-skeleton-avatar" />
      <div><SkeletonLine width="55%" height={28} /><SkeletonLine width="38%" height={15} style={{ marginTop: 14 }} /><SkeletonLine width="85%" height={13} style={{ marginTop: 20 }} /></div>
    </div>
    <div className="lpv2-layout"><div className="lpv2-card lpv2-skeleton-body"><SkeletonLine height={44} /><SkeletonLine height={18} style={{ marginTop: 28 }} /><SkeletonLine height={12} style={{ marginTop: 16 }} /><SkeletonLine width="78%" height={12} style={{ marginTop: 10 }} /></div><div className="lpv2-card lpv2-skeleton-book"><SkeletonLine width="45%" height={15} /><SkeletonLine width="70%" height={30} style={{ marginTop: 14 }} /><SkeletonLine height={44} style={{ marginTop: 28 }} /></div></div>
  </div>
);

const LawyerProfilePage = () => {
  const { lawyerId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const [lawyer, setLawyer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [activeTab, setActiveTab] = useState('about');
  const [expandedBio, setExpandedBio] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [favorite, setFavorite] = useState({ ready: false, value: false, pending: false, error: false });
  const [favoriteRetry, setFavoriteRetry] = useState(0);
  const [slots, setSlots] = useState({ loading: false, error: false, nearest: null });
  const [slotsRetry, setSlotsRetry] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [reviewSummary, setReviewSummary] = useState(null);
  const [reviewSort, setReviewSort] = useState('newest');
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPages, setReviewPages] = useState(1);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState(null);
  const [reviewsRetry, setReviewsRetry] = useState(0);
  const latestPresenceRef = useRef(null);
  const favoriteGenerationRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setAvatarFailed(false);
    setExpandedBio(false);
    setActiveTab('about');
    latestPresenceRef.current = null;
    clientService.lawyers.getLawyerDetails(lawyerId, { signal: controller.signal })
      .then((data) => {
        const normalized = normalizeLawyer(data, t('lawyerProfile.lawyerFallback'));
        const latest = latestPresenceRef.current;
        if (latest && Date.parse(latest.observedAt || 0) > Date.parse(normalized.presenceObservedAt || 0)) {
          normalized.online = latest.online === true;
          normalized.lastSeenAt = latest.lastSeenAt || null;
          normalized.presenceObservedAt = latest.observedAt;
        }
        setLawyer(normalized);
      })
      .catch((error) => {
        if (error.code !== 'ERR_CANCELED' && error.name !== 'CanceledError') setLoadError(error);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [lawyerId, retryKey, t]);

  useEffect(() => {
    const handleConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', handleConnection);
    window.addEventListener('offline', handleConnection);
    return () => { window.removeEventListener('online', handleConnection); window.removeEventListener('offline', handleConnection); };
  }, []);

  useEffect(() => {
    document.body.classList.add('lawyer-profile-active');
    return () => document.body.classList.remove('lawyer-profile-active');
  }, []);

  useEffect(() => {
    const handlePresence = ({ detail }) => {
      if (detail?.userId !== lawyerId || detail.role !== 'lawyer') return;
      const update = { ...detail, observedAt: detail.observedAt || new Date().toISOString() };
      if (latestPresenceRef.current && Date.parse(latestPresenceRef.current.observedAt || 0) >= Date.parse(update.observedAt || 0)) return;
      latestPresenceRef.current = update;
      setLawyer((current) => current && ({ ...current, online: update.online === true, lastSeenAt: update.lastSeenAt || null, presenceObservedAt: update.observedAt }));
    };
    window.addEventListener('maslaxat:presence', handlePresence);
    return () => window.removeEventListener('maslaxat:presence', handlePresence);
  }, [lawyerId]);

  useEffect(() => {
    if (!lawyer?.id) return undefined;
    const controller = new AbortController();
    const generation = ++favoriteGenerationRef.current;
    setFavorite((current) => ({ ...current, ready: false, error: false }));
    clientService.favorites.getFavorites({ signal: controller.signal })
      .then((items) => {
        if (generation === favoriteGenerationRef.current) setFavorite({ ready: true, value: items.some((item) => item.id === lawyer.id), pending: false, error: false });
      })
      .catch((error) => {
        if (generation === favoriteGenerationRef.current && error.code !== 'ERR_CANCELED' && error.name !== 'CanceledError') setFavorite({ ready: false, value: false, pending: false, error: true });
      });
    return () => controller.abort();
  }, [lawyer?.id, favoriteRetry]);

  useEffect(() => {
    if (!lawyer?.id || !lawyer.isAvailable || !lawyer.consultationDurations.length) return undefined;
    const controller = new AbortController();
    const duration = lawyer.consultationDurations.includes(60) ? 60 : lawyer.consultationDurations[0];
    setSlots({ loading: true, error: false, nearest: null });
    clientService.lawyers.getAvailableSlots(lawyer.id, {
      duration, days: 21, clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, { signal: controller.signal })
      .then((data) => {
        const date = (data.dates || []).find((item) => item.slots?.length);
        setSlots({ loading: false, error: false, nearest: date ? { date: date.slots[0].clientDate || date.date, time: date.slots[0].clientTime || date.slots[0].time } : null });
      })
      .catch((error) => {
        if (error.code !== 'ERR_CANCELED' && error.name !== 'CanceledError') setSlots({ loading: false, error: true, nearest: null });
      });
    return () => controller.abort();
  }, [lawyer?.id, lawyer?.isAvailable, lawyer?.consultationDurations, slotsRetry]);

  useEffect(() => {
    if (!lawyer?.id) return undefined;
    const controller = new AbortController();
    setReviewsLoading(true);
    setReviewsError(null);
    clientService.lawyers.getReviews(lawyer.id, { page: reviewPage, limit: REVIEW_PAGE_SIZE, sort: reviewSort }, { signal: controller.signal })
      .then((data) => {
        setReviews((current) => {
          if (reviewPage === 1) return data.reviews || [];
          const byId = new Map(current.map((item) => [item.id, item]));
          (data.reviews || []).forEach((item) => byId.set(item.id, item));
          return [...byId.values()];
        });
        setReviewPages(data.totalPages || 1);
        setReviewSummary(data.summary || null);
      })
      .catch((error) => {
        if (error.code !== 'ERR_CANCELED' && error.name !== 'CanceledError') setReviewsError(error);
      })
      .finally(() => { if (!controller.signal.aborted) setReviewsLoading(false); });
    return () => controller.abort();
  }, [lawyer?.id, reviewPage, reviewSort, reviewsRetry]);

  if (loading) return <GlassShell active="/lawyers" title={t('lawyerProfile.headerTitle')} subtitle={t('lawyerProfile.loading')}><ProfileSkeleton /></GlassShell>;

  if (loadError || !lawyer?.id) {
    const notFound = loadError?.response?.status === 404;
    return (
      <GlassShell active="/lawyers" title={t('lawyerProfile.headerTitle')} subtitle={notFound ? t('lawyerProfile.notFoundSub') : t('lawyerProfileV2.loadError')}>
        <div className="lpv2-card lpv2-state" role="alert">
          <h1>{notFound ? t('lawyerProfile.notFound') : (online ? t('lawyerProfileV2.loadError') : t('lawyerProfileV2.offlineTitle'))}</h1>
          <p>{notFound ? t('lawyerProfileV2.unavailableDesc') : (online ? t('lawyerProfileV2.loadErrorHint') : t('lawyerProfileV2.offlineHint'))}</p>
          {!notFound && <button type="button" className="lpv2-btn lpv2-btn-primary" onClick={() => setRetryKey((value) => value + 1)}>{t('lawyerProfileV2.retry')}</button>}
          <button type="button" className="lpv2-btn lpv2-btn-quiet" onClick={() => navigate('/lawyers')}>{t('lawyerProfile.backToCatalog')}</button>
        </div>
      </GlassShell>
    );
  }

  const canBook = lawyer.isAvailable && lawyer.priceFrom > 0 && lawyer.consultationFormats.length > 0 && lawyer.consultationDurations.length > 0;
  const showOnline = lawyer.isAvailable && lawyer.online === true;
  const place = [lawyer.location, lawyer.region].filter((value, index, values) => value && values.indexOf(value) === index).join(', ');
  const langNames = t('lawyerProfile.langNames');
  const tabs = [
    { id: 'about', label: t('lawyerProfile.tabAbout'), show: true },
    { id: 'experience', label: t('lawyerProfileV2.experience'), show: lawyer.experiences.length > 0 },
    { id: 'education', label: t('lawyerProfile.education'), show: lawyer.education.length > 0 },
    { id: 'certificates', label: t('lawyerProfileV2.certificates'), show: Boolean(lawyer.licenseNumber || lawyer.certifications.length) },
    { id: 'reviews', label: t('lawyerProfile.tabReviews'), show: true },
  ].filter((item) => item.show);
  const openBooking = () => { if (canBook) setBookingOpen(true); };
  const toggleFavorite = async () => {
    if (favorite.error) { setFavoriteRetry((value) => value + 1); return; }
    if (!favorite.ready || favorite.pending) return;
    const previous = favorite.value;
    const generation = favoriteGenerationRef.current;
    setFavorite({ ready: true, value: !previous, pending: true, error: false });
    try {
      if (previous) await clientService.favorites.removeFavorite(lawyer.id);
      else await clientService.favorites.addFavorite(lawyer.id);
      if (generation !== favoriteGenerationRef.current) return;
      setFavorite({ ready: true, value: !previous, pending: false, error: false });
      toast.success(t(previous ? 'lawyers.favRemoved' : 'lawyers.favAdded'));
    } catch {
      if (generation !== favoriteGenerationRef.current) return;
      setFavorite({ ready: true, value: previous, pending: false, error: false });
      toast.error(t('lawyers.favError'));
    }
  };
  const changeReviewSort = (sort) => { setReviewSort(sort); setReviewPage(1); setReviews([]); };
  const tabKeyDown = (event, index) => {
    let target = index;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[target].id);
    document.getElementById(`lawyer-tab-${tabs[target].id}`)?.focus();
  };
  const formatName = (format) => t(`lawyerProfileV2.format_${format}`);
  const nearestLabel = slots.nearest
    ? `${formatDate(`${slots.nearest.date}T12:00:00`, language, { day: 'numeric', month: 'long' })}, ${slots.nearest.time}` : '';
  const licenseExpired = lawyer.licenseExpiresAt && dateValue(`${lawyer.licenseExpiresAt}T23:59:59.999`) < Date.now();
  const trustedDocumentTypes = lawyer.verifiedDocumentTypes.filter((type) => type !== 'license' || !licenseExpired);
  const summary = reviewSummary || { rating: lawyer.rating, reviewsCount: lawyer.reviewsCount, distribution: {} };

  return (
    <GlassShell active="/lawyers" title={t('lawyerProfile.headerTitle')} subtitle={lawyer.professionalTitle || lawyer.specializations[0]}>
      <div className="lpv2-wrap">
        <button type="button" className="lpv2-back" onClick={() => navigate('/lawyers')}>{t('lawyerProfile.backToCatalog')}</button>

        <section className="lpv2-card lpv2-hero" aria-labelledby="lawyer-profile-name">
          <div className="lpv2-avatar" aria-hidden={!lawyer.avatar || avatarFailed}>
            <span>{initialsOf(lawyer.name)}</span>
            {lawyer.avatar && !avatarFailed && <img src={lawyer.avatar} alt={t('lawyerProfile.photoAlt').replace('{name}', lawyer.name)} decoding="async" fetchpriority="high" onError={() => setAvatarFailed(true)} />}
          </div>
          <div className="lpv2-identity">
            <div className="lpv2-status-row">
              {lawyer.verified && <span className="lpv2-badge lpv2-verified"><VerifiedOutlined />{t('lawyerProfileV2.verifiedLawyer')}</span>}
              {showOnline && <span className="lpv2-badge lpv2-online"><i />{t('lawyerProfile.onlineNow')}</span>}
              {!showOnline && lawyer.isAvailable && <span className="lpv2-badge">{t('lawyerProfile.available')}</span>}
            </div>
            <h1 id="lawyer-profile-name">{lawyer.name}</h1>
            {lawyer.professionalTitle && <p className="lpv2-professional-title">{lawyer.professionalTitle}</p>}
            {lawyer.specializations.length > 0 && <div className="lpv2-chips">{lawyer.specializations.map((item) => <span key={item}>{item}</span>)}</div>}
            <div className="lpv2-facts">
              {place && <span><LocationOnOutlined />{place}</span>}
              {lawyer.languages.length > 0 && <span><TranslateOutlined />{lawyer.languages.map((code) => langNames[code] || code).join(', ')}</span>}
              {lawyer.experience > 0 && <span><WorkOutline />{lawyer.experience} {t('lawyerProfile.years')}</span>}
            </div>
            <div className="lpv2-trust-row">
              <div className="lpv2-rating" aria-label={lawyer.rating ? t('lawyerProfile.ratingAria').replace('{rating}', lawyer.rating.toFixed(1)).replace('{count}', lawyer.reviewsCount) : t('lawyerProfile.noRating')}>
                {lawyer.rating > 0 ? <><Rating value={lawyer.rating} precision={0.5} readOnly aria-hidden="true" /><strong>{lawyer.rating.toFixed(1)}</strong><span>{lawyer.reviewsCount} {t('lawyerProfile.reviewsCount')}</span></> : <span>{t('lawyerProfile.noRating')}</span>}
              </div>
              <span className="lpv2-stat"><strong>{lawyer.completedConsultations}</strong> {t('lawyerProfileV2.consultations')}</span>
              {lawyer.medianResponseMinutes != null && <span className="lpv2-stat"><AccessTimeOutlined /><strong>~{Math.max(1, Math.ceil(lawyer.medianResponseMinutes / 60))}</strong> {t('lawyerProfileV2.hoursToReply')}</span>}
            </div>
            <div className="lpv2-actions">
              <button type="button" className="lpv2-btn lpv2-btn-primary" disabled={!canBook} onClick={openBooking}>{canBook ? t('lawyerProfile.book') : t('lawyerProfile.unavailable')}</button>
              <button type="button" className="lpv2-btn lpv2-btn-secondary" disabled={!canBook} onClick={openBooking}><CalendarMonthOutlined />{t('lawyerProfileV2.viewTimes')}</button>
              <button type="button" className={`lpv2-icon-btn ${favorite.value ? 'is-active' : ''}`} disabled={favorite.pending || (!favorite.ready && !favorite.error)} onClick={toggleFavorite} aria-pressed={favorite.value} aria-label={favorite.error ? t('lawyerProfileV2.retryFavorite') : t(favorite.value ? 'lawyers.removeFavoriteAria' : 'lawyers.addFavoriteAria').replace('{name}', lawyer.name)} title={favorite.error ? t('lawyerProfileV2.retryFavorite') : ''}>
                {favorite.pending ? <CircularProgress size={20} color="inherit" /> : favorite.value ? <Favorite /> : <FavoriteBorder />}
              </button>
              <button type="button" className="lpv2-btn lpv2-btn-quiet" onClick={() => navigate('/ai-chat')}><ChatBubbleOutline />{t('lawyerProfile.askAi')}</button>
            </div>
          </div>
        </section>

        <div className="lpv2-layout">
          <div className="lpv2-main">
            <div className="lpv2-card lpv2-tabs" role="tablist" aria-label={t('lawyerProfile.profileSections')}>
              {tabs.map((item, index) => <button key={item.id} id={`lawyer-tab-${item.id}`} type="button" role="tab" tabIndex={activeTab === item.id ? 0 : -1} aria-selected={activeTab === item.id} aria-controls={`lawyer-panel-${item.id}`} onClick={() => setActiveTab(item.id)} onKeyDown={(event) => tabKeyDown(event, index)}>{item.label}</button>)}
            </div>

            <div className="lpv2-panel" id={`lawyer-panel-${activeTab}`} role="tabpanel" aria-labelledby={`lawyer-tab-${activeTab}`}>
              {activeTab === 'about' && (
                <section className="lpv2-card lpv2-section">
                  <h2>{t('lawyerProfile.aboutHeading')}</h2>
                  {lawyer.bio ? <><p className={`lpv2-bio ${expandedBio ? 'is-expanded' : ''}`}>{lawyer.bio}</p>{lawyer.bio.length > 320 && <button type="button" className="lpv2-text-btn" onClick={() => setExpandedBio((value) => !value)} aria-expanded={expandedBio}>{t(expandedBio ? 'lawyerProfileV2.collapse' : 'lawyerProfileV2.expand')}</button>}</> : <p className="lpv2-muted">{t('lawyerProfile.noBio')}</p>}
                  <div className="lpv2-detail-grid">
                    {lawyer.specializations.length > 0 && <div><h3>{t('lawyerProfileV2.specializations')}</h3><div className="lpv2-chips">{lawyer.specializations.map((item) => <span key={item}>{item}</span>)}</div></div>}
                    {lawyer.languages.length > 0 && <div><h3>{t('lawyerProfile.languages')}</h3><p>{lawyer.languages.map((code) => langNames[code] || code).join(', ')}</p></div>}
                    {place && <div><h3>{t('lawyerProfileV2.workRegion')}</h3><p>{place}</p></div>}
                    {lawyer.consultationFormats.length > 0 && <div><h3>{t('lawyerProfileV2.formats')}</h3><div className="lpv2-format-list">{lawyer.consultationFormats.map((format) => { const Icon = FORMAT_ICONS[format] || ChatBubbleOutline; return <span key={format}><Icon />{formatName(format)}</span>; })}</div></div>}
                  </div>
                  {lawyer.linkedinUrl && <a className="lpv2-external" href={lawyer.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn <OpenInNew /></a>}
                </section>
              )}

              {activeTab === 'experience' && <section className="lpv2-card lpv2-section"><h2>{t('lawyerProfileV2.experience')}</h2><div className="lpv2-timeline">{lawyer.experiences.map((item) => <article key={item.id}><span className="lpv2-timeline-dot" /><div className="lpv2-item-heading"><div><h3>{item.position}</h3><p>{item.organization}</p></div>{item.isCurrent && <span className="lpv2-badge">{t('lawyerProfileV2.current')}</span>}</div><div className="lpv2-period">{formatDate(item.startDate, language)} — {item.isCurrent ? t('lawyerProfileV2.present') : formatDate(item.endDate, language)}{experienceDuration(item.startDate, item.isCurrent ? null : item.endDate, t) && ` · ${experienceDuration(item.startDate, item.isCurrent ? null : item.endDate, t)}`}</div>{item.description && <p className="lpv2-description">{item.description}</p>}</article>)}</div></section>}

              {activeTab === 'education' && <section className="lpv2-card lpv2-section"><h2>{t('lawyerProfile.education')}</h2><div className="lpv2-list">{lawyer.education.map((item) => <article key={item.id}><div className="lpv2-item-icon"><SchoolOutlined /></div><div><h3>{item.university}</h3><p>{[item.degree, item.specialty, item.faculty].filter(Boolean).join(' · ')}</p><div className="lpv2-period">{[item.startYear && item.endYear ? `${item.startYear}–${item.endYear}` : (item.endYear || item.startYear), [item.city, item.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div></div></article>)}</div></section>}

              {activeTab === 'certificates' && <section className="lpv2-card lpv2-section"><h2>{t('lawyerProfileV2.certificates')}</h2>{lawyer.licenseNumber && <article className="lpv2-license"><div className="lpv2-item-icon"><VerifiedOutlined /></div><div><div className="lpv2-item-heading"><h3>{t('lawyerProfileV2.license')} № {lawyer.licenseNumber}</h3><span className={`lpv2-badge ${licenseExpired ? 'lpv2-expired' : ''}`}>{licenseExpired ? t('lawyerProfileV2.expired') : lawyer.verifiedDocumentTypes.includes('license') ? t('lawyerProfileV2.documentVerified') : t('lawyerProfileV2.statusNotShown')}</span></div>{lawyer.licenseIssuer && <p>{lawyer.licenseIssuer}</p>}<div className="lpv2-period">{[lawyer.licenseIssuedAt && `${t('lawyerProfileV2.issued')} ${formatDate(lawyer.licenseIssuedAt, language)}`, lawyer.licenseExpiresAt && `${t('lawyerProfileV2.validUntil')} ${formatDate(lawyer.licenseExpiresAt, language)}`].filter(Boolean).join(' · ')}</div></div></article>}<div className="lpv2-list">{lawyer.certifications.map((item) => { const link = safeExternalUrl(item.credentialUrl); return <article key={item.id}><div className="lpv2-item-icon"><WorkspacePremiumOutlined /></div><div><h3>{item.title}</h3>{item.organization && <p>{item.organization}</p>}<div className="lpv2-period">{item.issuedAt && `${t('lawyerProfileV2.issued')} ${formatDate(item.issuedAt, language)}`}</div>{link && <a className="lpv2-external" href={link} target="_blank" rel="noopener noreferrer">{t('lawyerProfileV2.openCredential')} <OpenInNew /></a>}</div></article>; })}</div></section>}

              {activeTab === 'reviews' && (
                <section className="lpv2-card lpv2-section">
                  <div className="lpv2-review-heading"><div><h2>{t('lawyerProfile.tabReviews')}</h2><p>{summary.reviewsCount || 0} {t('lawyerProfile.reviewsCount')}</p></div><div className="lpv2-sort" role="group" aria-label={t('lawyerProfileV2.reviewSort')}><button type="button" aria-pressed={reviewSort === 'newest'} className={reviewSort === 'newest' ? 'is-active' : ''} onClick={() => changeReviewSort('newest')}>{t('lawyerProfileV2.newest')}</button><button type="button" aria-pressed={reviewSort === 'helpful'} className={reviewSort === 'helpful' ? 'is-active' : ''} onClick={() => changeReviewSort('helpful')}>{t('lawyerProfileV2.helpful')}</button></div></div>
                  {(summary.reviewsCount || 0) > 0 && <div className="lpv2-review-summary"><div className="lpv2-review-score"><strong>{Number(summary.rating || 0).toFixed(1)}</strong><Rating value={Number(summary.rating) || 0} precision={0.5} readOnly /><span>{summary.reviewsCount} {t('lawyerProfile.reviewsCount')}</span></div><div className="lpv2-distribution">{[5, 4, 3, 2, 1].map((star) => { const count = Number(summary.distribution?.[star] || 0); const percent = summary.reviewsCount ? (count / summary.reviewsCount) * 100 : 0; return <div key={star}><span>{star}</span><div><i style={{ width: `${percent}%` }} /></div><span>{count}</span></div>; })}</div></div>}
                  {reviewsError && <div className="lpv2-inline-state" role="alert"><p>{online ? t('lawyerProfileV2.reviewsError') : t('lawyerProfileV2.offlineHint')}</p><button type="button" className="lpv2-btn lpv2-btn-secondary" onClick={() => { setReviewsError(null); setReviewPage(1); setReviewsRetry((value) => value + 1); }}>{t('lawyerProfileV2.retry')}</button></div>}
                  {!reviewsError && reviews.length === 0 && !reviewsLoading && <div className="lpv2-inline-state"><p>{t('lawyerProfile.noReviews')}</p><span>{t('lawyerProfile.noReviewsSub')}</span></div>}
                  <div className="lpv2-reviews">{reviews.map((review) => <article key={review.id}><div className="lpv2-review-top"><div className="lpv2-reviewer"><span>{initialsOf(review.client?.name)}</span><div><h3>{review.client?.name || t('lawyerProfile.clientFallback')}</h3>{review.createdAt && <time dateTime={review.createdAt}>{formatDate(review.createdAt, language, { day: 'numeric', month: 'long', year: 'numeric' })}</time>}</div></div><Rating value={Number(review.rating) || 0} precision={0.5} readOnly aria-label={t('lawyerProfile.reviewRatingAria').replace('{rating}', Number(review.rating || 0).toFixed(1))} /></div>{review.verifiedConsultation && <div className="lpv2-confirmed"><CheckCircleOutline />{t('lawyerProfileV2.verifiedConsultation')}</div>}{review.text && <p>{review.text}</p>}{review.replyText && <blockquote><strong>{t('lawyerProfileV2.lawyerReply')}</strong>{review.replyText}</blockquote>}{Number(review.helpfulCount) > 0 && <div className="lpv2-helpful">{t('lawyerProfileV2.helpfulCount').replace('{count}', review.helpfulCount)}</div>}</article>)}</div>
                  {reviewsLoading && <div className="lpv2-review-loading" role="status" aria-label={t('lawyerProfileV2.loadingReviews')}><SkeletonLine height={90} /><SkeletonLine height={90} /></div>}
                  {!reviewsLoading && !reviewsError && reviewPage < reviewPages && <button type="button" className="lpv2-btn lpv2-btn-secondary lpv2-load-more" onClick={() => setReviewPage((page) => page + 1)}>{t('lawyerProfileV2.showMore')}</button>}
                </section>
              )}
            </div>
          </div>

          <aside className="lpv2-card lpv2-book-card" aria-label={t('lawyerProfileV2.bookingCard')}>
            <span className="lpv2-eyebrow">{t('lawyerProfileV2.rate60')}</span>
            <div className="lpv2-price">{lawyer.priceFrom.toLocaleString(LOCALES[language])} <small>{t('lawyerProfile.sum')}</small></div>
            {lawyer.consultationDurations.length > 0 && <div><h3>{t('lawyerProfileV2.duration')}</h3><div className="lpv2-duration-list">{lawyer.consultationDurations.map((duration) => <span key={duration}><strong>{duration} {t('lawyerProfileV2.min')}</strong>{lawyer.priceFrom > 0 && <small>{Math.round(lawyer.priceFrom * duration / 60).toLocaleString(LOCALES[language])} {t('lawyerProfile.sum')}</small>}</span>)}</div></div>}
            {lawyer.consultationFormats.length > 0 && <div><h3>{t('lawyerProfileV2.formats')}</h3><div className="lpv2-format-list">{lawyer.consultationFormats.map((format) => { const Icon = FORMAT_ICONS[format] || ChatBubbleOutline; return <span key={format}><Icon />{formatName(format)}</span>; })}</div></div>}
            <div className="lpv2-next-slot"><CalendarMonthOutlined /><div><span>{t('lawyerProfileV2.nearestSlot')}</span>{slots.loading ? <SkeletonLine width={150} height={14} style={{ marginTop: 6 }} /> : slots.error ? <button type="button" onClick={() => setSlotsRetry((value) => value + 1)}>{t('lawyerProfileV2.retry')}</button> : <strong>{nearestLabel || t('lawyerProfileV2.noSlots')}</strong>}</div></div>
            <button type="button" className="lpv2-btn lpv2-btn-primary" disabled={!canBook} onClick={openBooking}>{canBook ? t('lawyerProfile.book') : t('lawyerProfile.unavailable')}</button>
            {trustedDocumentTypes.length > 0 && <p className="lpv2-trust-note"><CheckCircleOutline />{t('lawyerProfile.verifiedDocuments').replace('{documents}', trustedDocumentTypes.map((type) => t(`lawyerProfile.doc_${type}`)).join(', '))}</p>}
          </aside>
        </div>

        <div className="lpv2-mobile-book" aria-label={t('lawyerProfileV2.bookingCard')}><div><span>{t('lawyerProfileV2.rate60')}</span><strong>{lawyer.priceFrom.toLocaleString(LOCALES[language])} {t('lawyerProfile.sum')}</strong></div><button type="button" disabled={!canBook} onClick={openBooking}>{canBook ? t('lawyerProfileV2.bookShort') : t('lawyerProfile.unavailable')}</button></div>
      </div>
      <BookingModal open={bookingOpen} onClose={() => setBookingOpen(false)} lawyer={lawyer} />
    </GlassShell>
  );
};

export default LawyerProfilePage;
