import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  TextField,
  InputAdornment,
  IconButton,
  Rating,
  Slider,
  FormControl,
  Select,
  MenuItem,
  Pagination,
  Drawer,
  useMediaQuery,
} from '@mui/material';
import {
  SearchOutlined,
  Close,
  StarRounded,
  FavoriteBorderOutlined,
  FavoriteRounded,
  TuneOutlined,
  CheckRounded,
  CardGiftcardOutlined,
  GridViewOutlined,
  BalanceOutlined,
  PeopleAltOutlined,
  BusinessOutlined,
  ShieldOutlined,
  HomeOutlined,
  WorkOutline,
  PercentOutlined,
  LightbulbOutlined,
  AccountBalanceOutlined,
  DescriptionOutlined,
  PublicOutlined,
  ArrowUpwardRounded,
  ArrowDownwardRounded,
  AccessTimeRounded,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import BookingModal from '../../components/BookingModal';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';
import { SkeletonCard } from '../../components/UI/Skeleton';

/*
  ─────────────────────────────────────────────────────────────
  LAWYERS CATALOG  (/lawyers)
  Ported 1:1 from ClaudeDesign → client/04_LAWYERS_CATALOG.html.
  Sidebar filters (specialization / min-rating / price / experience) +
  search & sort row + glass lawyer cards (avatar, rating, tags, exp,
  "от N сум", favorite heart → toggle, "Записаться" → BookingModal).
  Data layer unchanged: clientService.lawyers.searchLawyers,
  clientService.favorites.{get,add,remove}. Chrome = <GlassShell>.
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

const AV_BG = [
  'linear-gradient(135deg,#B8956E,#8B7355)',
  'linear-gradient(135deg,#6A8A9A,#4A6A7A)',
  'linear-gradient(135deg,#7A9A6B,#5A7A4B)',
  'linear-gradient(135deg,#9A7BA0,#6A4A7A)',
];

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

// Иконка категории по названию специализации
const specIcon = (name = '', id) => {
  const s = { fontSize: 18 };
  if (!id) return <GridViewOutlined sx={s} />;
  const n = name.toLowerCase();
  if (n.includes('граждан')) return <BalanceOutlined sx={s} />;
  if (n.includes('семей')) return <PeopleAltOutlined sx={s} />;
  if (n.includes('корпоратив')) return <BusinessOutlined sx={s} />;
  if (n.includes('уголов')) return <ShieldOutlined sx={s} />;
  if (n.includes('недвиж') || n.includes('земел') || n.includes('жилищ')) return <HomeOutlined sx={s} />;
  if (n.includes('труд')) return <WorkOutline sx={s} />;
  if (n.includes('налог')) return <PercentOutlined sx={s} />;
  if (n.includes('интеллект')) return <LightbulbOutlined sx={s} />;
  if (n.includes('админ')) return <AccountBalanceOutlined sx={s} />;
  if (n.includes('договор')) return <DescriptionOutlined sx={s} />;
  if (n.includes('миграц')) return <PublicOutlined sx={s} />;
  if (n.includes('страхов')) return <ShieldOutlined sx={s} />;
  return <BalanceOutlined sx={s} />;
};

// Опции сортировки с иконками
const SORT_OPTS = [
  { v: 'rating', k: 'sortRating', icon: <StarRounded sx={{ fontSize: 18 }} /> },
  { v: 'price-asc', k: 'sortPriceAsc', icon: <ArrowUpwardRounded sx={{ fontSize: 18 }} /> },
  { v: 'price-desc', k: 'sortPriceDesc', icon: <ArrowDownwardRounded sx={{ fontSize: 18 }} /> },
  { v: 'experience', k: 'sortExperience', icon: <AccessTimeRounded sx={{ fontSize: 18 }} /> },
];

const labelStyle = {
  fontSize: 12,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 10,
};

// Нативный select для фильтров город/язык (в стиле панели)
const selectFilterStyle = {
  width: '100%',
  padding: '11px 12px',
  marginBottom: 24,
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--canvas)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13.5,
  cursor: 'pointer',
};

// glass Select sx (used for experience + sort)
const glassSelectSx = {
  fontFamily: 'inherit',
  fontSize: 14,
  color: 'var(--text)',
  background: 'var(--card-glass)',
  borderRadius: 'var(--radius)',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)' },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)', borderWidth: 1 },
  '& .MuiSvgIcon-root': { color: 'var(--text3)' },
};

const LawyersPageGlass = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { specializations } = useSelector((state) => state.specializations);
  const isMobile = useMediaQuery('(max-width:900px)');

  const [lawyers, setLawyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedLawyer, setSelectedLawyer] = useState(null);
  const [favoriteLawyers, setFavoriteLawyers] = useState(new Set());
  const [firstFree, setFirstFree] = useState(false);

  // Акция «первая консультация бесплатно» — показываем объявление, если доступна
  useEffect(() => {
    api.get('/client/consultations/loyalty')
      .then((res) => setFirstFree(!!res.data?.freeNow))
      .catch(() => setFirstFree(false));
  }, []);

  const [filters, setFilters] = useState({
    specialization: '',
    minRating: 0,
    priceRange: [0, 500000],
    experience: '',
    sortBy: 'rating',
    onlineOnly: false,
    location: '',
    language: '',
  });
  const [filterOptions, setFilterOptions] = useState({ locations: [], languages: [] });

  useEffect(() => {
    fetchLawyers();
    loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, currentPage, searchQuery]);

  useEffect(() => {
    clientService.lawyers.getFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  const loadFavorites = async () => {
    try {
      const favorites = await clientService.favorites.getFavorites();
      const favoriteIds = new Set(favorites.map((f) => f.id));
      setFavoriteLawyers(favoriteIds);
    } catch (error) {
      console.error('Error loading favorites:', error);
    }
  };

  const fetchLawyers = async () => {
    try {
      setLoading(true);
      const response = await clientService.lawyers.searchLawyers({
        ...filters,
        search: searchQuery,
        page: currentPage,
        limit: 9,
      });

      setLawyers(response.lawyers || []);
      setTotalPages(response.totalPages || 1);
    } catch (error) {
      console.error('Error fetching lawyers:', error);
      setLawyers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setFilters({
      specialization: '',
      minRating: 0,
      priceRange: [0, 500000],
      experience: '',
      sortBy: 'rating',
      onlineOnly: false,
      location: '',
      language: '',
    });
    setSearchQuery('');
    setCurrentPage(1);
  };

  const handleBookConsultation = (lawyer) => {
    setSelectedLawyer(lawyer);
    setBookingModalOpen(true);
  };

  const handleCloseBookingModal = () => {
    setBookingModalOpen(false);
    setSelectedLawyer(null);
  };

  const handleViewProfile = (lawyerId) => {
    navigate(`/lawyers/${lawyerId}`);
  };

  const handleToggleFavorite = async (e, lawyerId) => {
    e.stopPropagation();
    try {
      if (favoriteLawyers.has(lawyerId)) {
        await clientService.favorites.removeFavorite(lawyerId);
        setFavoriteLawyers((prev) => {
          const next = new Set(prev);
          next.delete(lawyerId);
          return next;
        });
        toast.success(t('lawyers.favRemoved'));
      } else {
        await clientService.favorites.addFavorite(lawyerId);
        setFavoriteLawyers((prev) => new Set(prev).add(lawyerId));
        toast.success(t('lawyers.favAdded'));
      }
    } catch (error) {
      toast.error(t('lawyers.favError'));
    }
  };

  const activeSpecs = specializations.filter((s) => s.active);

  // ---- Filters panel (shared between desktop sidebar + mobile drawer) ----
  const filtersPanel = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
          {t('lawyers.filters')}
        </div>
        {isMobile && (
          <IconButton size="small" onClick={() => setFilterDrawerOpen(false)}>
            <Close fontSize="small" sx={{ color: 'var(--text2)' }} />
          </IconButton>
        )}
      </div>

      {/* Specialization — icons + highlight */}
      <div style={labelStyle}>{t('lawyers.specialization')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 24 }}>
        {[{ id: '', name: t('lawyers.all') }, ...activeSpecs].map((sp) => {
          const checked = filters.specialization === sp.id;
          return (
            <div
              key={sp.id || 'all'}
              onClick={() => handleFilterChange('specialization', sp.id)}
              onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 7%, transparent)'; }}
              onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 12, cursor: 'pointer',
                fontSize: 14, color: checked ? 'var(--text)' : 'var(--text2)', fontWeight: checked ? 500 : 400,
                background: checked ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
                border: `1px solid ${checked ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'transparent'}`,
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
            >
              <span style={{
                width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: checked ? 'linear-gradient(135deg, var(--accent), var(--accent-dark))' : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: checked ? '#FFFFFF' : 'var(--accent-dark)',
                transition: 'all 0.15s ease',
              }}>
                {specIcon(sp.name, sp.id)}
              </span>
              {sp.name}
            </div>
          );
        })}
      </div>

      {/* Min rating */}
      <div style={labelStyle}>{t('lawyers.minRating')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Rating
          value={filters.minRating}
          onChange={(e, value) => handleFilterChange('minRating', value || 0)}
          precision={1}
          sx={{
            '& .MuiRating-iconFilled': { color: 'var(--accent)' },
            '& .MuiRating-iconEmpty': { color: 'var(--border-strong)' },
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>
          {filters.minRating ? `${filters.minRating} ★` : t('lawyers.any')}
        </span>
      </div>

      {/* Price range — денежный стиль с пузырями значений */}
      <div style={labelStyle}>{t('lawyers.priceSum')}</div>
      <div style={{ padding: '42px 8px 0' }}>
        <Slider
          value={filters.priceRange}
          onChange={(e, value) => handleFilterChange('priceRange', value)}
          valueLabelDisplay="on"
          valueLabelFormat={(v) => `${v.toLocaleString()} ${t('lawyers.sum')}`}
          min={0}
          max={500000}
          step={1000}
          sx={{
            height: 6,
            color: 'var(--accent)',
            '& .MuiSlider-rail': { background: 'var(--border-strong)', opacity: 0.6, height: 6, borderRadius: 6 },
            '& .MuiSlider-track': {
              border: 'none', height: 6, borderRadius: 6,
              background: 'linear-gradient(90deg, var(--accent), var(--accent))',
              transition: 'all 0.25s cubic-bezier(.4,0,.2,1)',
            },
            '& .MuiSlider-thumb': {
              width: 20, height: 20,
              background: 'radial-gradient(circle at 35% 30%, #F3E2CA, var(--accent))',
              border: '3px solid var(--surface)',
              boxShadow: '0 2px 8px rgba(139,115,85,0.28)',
              transition: 'box-shadow 0.25s ease',
              '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 9px rgba(184,149,110,0.12), 0 2px 8px rgba(139,115,85,0.28)' },
              '&:active': { boxShadow: '0 0 0 13px rgba(184,149,110,0.14), 0 2px 8px rgba(139,115,85,0.28)' },
              '&:before': { boxShadow: 'none' },
            },
            '& .MuiSlider-valueLabel': {
              background: 'var(--accent)',
              color: '#FFFFFF', fontSize: 12, fontWeight: 600,
              borderRadius: '10px', padding: '3px 10px', top: -2,
              boxShadow: '0 4px 12px rgba(184,149,110,0.24)', whiteSpace: 'nowrap',
              transition: 'transform 0.2s cubic-bezier(.4,0,.2,1)',
              '&:before': { backgroundColor: 'var(--accent)' },
            },
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', letterSpacing: '0.04em', marginTop: 4, marginBottom: 24 }}>
        <span>0</span>
        <span>{(500000).toLocaleString()}</span>
      </div>

      {/* Experience — пилюли */}
      <div style={labelStyle}>{t('lawyers.experience')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {[
          { v: '', label: t('lawyers.any') },
          { v: '0-5', label: `0–5 ${t('lawyers.years')}` },
          { v: '5-10', label: `5–10 ${t('lawyers.years')}` },
          { v: '10-15', label: `10–15 ${t('lawyers.years')}` },
          { v: '15+', label: `15+ ${t('lawyers.years')}` },
        ].map((o) => {
          const active = filters.experience === o.v;
          return (
            <button
              key={o.v || 'any'}
              onClick={() => handleFilterChange('experience', o.v)}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)'; } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; } }}
              style={{
                fontSize: 13, padding: '9px 14px', borderRadius: 22, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-dark))' : 'transparent',
                color: active ? '#FFFFFF' : 'var(--text2)',
                boxShadow: active ? '0 4px 12px rgba(184,149,110,0.3)' : 'none',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Город */}
      {filterOptions.locations.length > 0 && (
        <>
          <div style={labelStyle}>{t('lawyers.city')}</div>
          <select
            value={filters.location}
            onChange={(e) => handleFilterChange('location', e.target.value)}
            style={selectFilterStyle}
          >
            <option value="">{t('lawyers.allCities')}</option>
            {filterOptions.locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
          </select>
        </>
      )}

      {/* Язык */}
      {filterOptions.languages.length > 0 && (
        <>
          <div style={labelStyle}>{t('lawyers.language')}</div>
          <select
            value={filters.language}
            onChange={(e) => handleFilterChange('language', e.target.value)}
            style={selectFilterStyle}
          >
            <option value="">{t('lawyers.allLanguages')}</option>
            {filterOptions.languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </>
      )}

      {/* Только онлайн */}
      <button
        onClick={() => handleFilterChange('onlineOnly', !filters.onlineOnly)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '11px 14px', marginBottom: 24, borderRadius: 'var(--radius)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13.5, color: 'var(--text)',
          border: `1px solid ${filters.onlineOnly ? 'var(--accent)' : 'var(--border)'}`,
          background: filters.onlineOnly ? 'rgba(90,160,106,0.08)' : 'transparent',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5AA06A' }} />
          {t('lawyers.onlineOnly')}
        </span>
        <span style={{
          width: 38, height: 21, borderRadius: 12, position: 'relative', flexShrink: 0,
          background: filters.onlineOnly ? 'var(--accent)' : 'var(--border)', transition: 'background .2s',
        }}>
          <span style={{
            position: 'absolute', top: 2, left: filters.onlineOnly ? 19 : 2, width: 17, height: 17,
            borderRadius: '50%', background: '#FFF', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </span>
      </button>

      <button
        onClick={() => { handleClearFilters(); if (isMobile) setFilterDrawerOpen(false); }}
        style={{
          width: '100%', marginTop: 6, padding: '11px 16px', background: 'transparent',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text2)',
        }}
      >
        {t('lawyers.resetFilters')}
      </button>
    </>
  );

  // ---- Lawyer card ----
  const renderCard = (lawyer, index) => {
    const isFav = favoriteLawyers.has(lawyer.id);
    const reviews = lawyer.reviewsCount ?? 0;
    const tags = lawyer.specializations || [];
    const grad = AV_BG[index % AV_BG.length];
    const roundedRating = Math.round(lawyer.rating || 0);
    return (
      <div
        key={lawyer.id}
        style={{
          ...glassCard,
          padding: '24px 20px 20px',
          textAlign: 'center',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all .25s cubic-bezier(.4,0,.2,1)',
          animation: `cardRise 0.4s ease ${index * 0.05}s both`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.boxShadow = '0 16px 34px rgba(26,26,26,0.13)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--card-shadow)';
        }}
      >
        {/* favorite */}
        <button
          onClick={(e) => handleToggleFavorite(e, lawyer.id)}
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 2, color: isFav ? 'var(--accent)' : 'var(--text3)' }}
        >
          {isFav ? <FavoriteRounded sx={{ fontSize: 22 }} /> : <FavoriteBorderOutlined sx={{ fontSize: 22 }} />}
        </button>

        {/* avatar */}
        <div
          onClick={() => handleViewProfile(lawyer.id)}
          style={{
            width: 66, height: 66, borderRadius: '50%', margin: '0 auto 12px', cursor: 'pointer', position: 'relative',
            background: lawyer.avatar ? `center/cover url(${lawyer.avatar})` : grad,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 21, fontWeight: 600,
            boxShadow: '0 6px 16px rgba(26,26,26,0.14)',
          }}
        >
          {!lawyer.avatar && initialsOf(lawyer.name)}
          {lawyer.isVerified && (
            <span style={{
              position: 'absolute', bottom: 0, right: 2, width: 20, height: 20, borderRadius: '50%',
              background: '#5AA06A', border: '3px solid var(--surface)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
            }}>
              <CheckRounded sx={{ fontSize: 11 }} />
            </span>
          )}
        </div>

        {/* name */}
        <div
          onClick={() => handleViewProfile(lawyer.id)}
          style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {lawyer.name}
        </div>

        {/* online now */}
        {lawyer.isAvailable && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, color: '#5AA06A', fontWeight: 500 }}>
            <span className="online-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#5AA06A' }} />
            {t('lawyers.onlineNow')}
          </div>
        )}

        {/* stars + rating */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14, fontSize: 13, color: 'var(--text3)' }}>
          <span style={{ display: 'flex', gap: 1 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <StarRounded key={n} sx={{ fontSize: 16, color: n <= roundedRating ? '#C9A36E' : 'var(--border)' }} />
            ))}
          </span>
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{lawyer.rating || 0}</strong>
          <span>· {reviews} {t('lawyers.reviews')}</span>
        </div>

        {/* specialization */}
        {tags.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ background: 'rgba(184,149,110,0.14)', color: 'var(--accent-dark)', fontSize: 12, padding: '5px 12px', borderRadius: 20 }}>
              {tags[0]}
            </span>
          </div>
        )}

        {/* meta line: опыт | цена */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 30, padding: '14px 0', marginBottom: 18, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('lawyers.expPrefix')}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginTop: 3 }}>{lawyer.experience || 0} {t('lawyers.years')}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('lawyers.from')}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginTop: 3 }}>
              {(lawyer.priceFrom || 0).toLocaleString()} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>{t('lawyers.sum')}</span>
            </div>
          </div>
        </div>

        {/* CTA (прижат к низу) */}
        <button
          onClick={(e) => { e.stopPropagation(); handleBookConsultation(lawyer); }}
          style={{
            marginTop: 'auto', width: '100%',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
            color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', textTransform: 'uppercase', padding: '13px 20px',
            borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 4px 14px rgba(184,149,110,0.35)', transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(184,149,110,0.45)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(184,149,110,0.35)'; }}
        >
          {t('lawyers.bookConsultation')} →
        </button>
      </div>
    );
  };

  // Фильтр «только онлайн» применяем на текущей странице (доступность приходит в списке)
  const visibleLawyers = filters.onlineOnly ? lawyers.filter((l) => l.isAvailable) : lawyers;

  return (
    <GlassShell active="/lawyers" title={t('lawyers.title')} subtitle={t('lawyers.subtitle')}>
      {/* Mobile filter drawer */}
      <Drawer
        anchor="bottom"
        open={isMobile && filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        PaperProps={{
          sx: {
            borderRadius: '16px 16px 0 0',
            maxHeight: '85vh',
            background: 'var(--surface)',
            padding: 3,
          },
        }}
      >
        {filtersPanel}
      </Drawer>

      {/* ─── Объявление: первая консультация бесплатно ─── */}
      {firstFree && (
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '16px 20px',
            borderRadius: 'var(--radius)',
            background: 'linear-gradient(135deg, rgba(184,149,110,0.16), rgba(184,149,110,0.05))',
            border: '1px solid var(--accent)',
          }}
        >
          <div
            style={{
              width: 44, height: 44, flexShrink: 0, borderRadius: '50%',
              background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CardGiftcardOutlined sx={{ fontSize: 24, color: 'var(--accent-dark)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-dark)', marginBottom: 2 }}>
              {t('lawyers.promoTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              {t('lawyers.promoSub')}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '258px 1fr',
          gap: 24,
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        {/* Sidebar filters (desktop) */}
        {!isMobile && (
          <div style={{ ...glassCard, padding: 22, alignSelf: 'start', position: 'sticky', top: 0 }}>
            {filtersPanel}
          </div>
        )}

        {/* Content column */}
        <div>
          {/* search + sort row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
            <TextField
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('lawyers.searchPlaceholder')}
              size="small"
              sx={{
                flex: 1,
                minWidth: 220,
                '& .MuiOutlinedInput-root': {
                  background: 'var(--card-glass)',
                  backdropFilter: 'blur(24px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                  borderRadius: 'var(--radius)',
                  fontFamily: 'inherit',
                  color: 'var(--text)',
                  '& fieldset': { borderColor: 'var(--card-brd)' },
                  '&:hover fieldset': { borderColor: 'var(--accent)' },
                  '&.Mui-focused fieldset': { borderColor: 'var(--accent)', borderWidth: 1 },
                },
                '& input::placeholder': { color: 'var(--text3)', opacity: 1 },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined sx={{ color: 'var(--text3)', fontSize: 20 }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                      <Close sx={{ color: 'var(--text3)', fontSize: 18 }} />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {isMobile && (
              <button
                onClick={() => setFilterDrawerOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, ...glassCard, padding: '10px 16px',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--text2)',
                }}
              >
                <TuneOutlined sx={{ fontSize: 18 }} /> {t('lawyers.filters')}
              </button>
            )}

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select
                value={filters.sortBy}
                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                sx={glassSelectSx}
                renderValue={(val) => {
                  const o = SORT_OPTS.find((x) => x.v === val) || SORT_OPTS[0];
                  return (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--accent)', display: 'flex' }}>{o.icon}</span>
                      {t('lawyers.' + o.k)}
                    </span>
                  );
                }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      mt: 1, borderRadius: '14px', border: '1px solid var(--card-brd)', background: 'var(--surface)',
                      boxShadow: '0 12px 34px rgba(60,45,30,0.16)', p: 0.75,
                      '& .MuiList-root': { p: 0 },
                    },
                  },
                }}
              >
                {SORT_OPTS.map((o) => {
                  const active = filters.sortBy === o.v;
                  return (
                    <MenuItem
                      key={o.v}
                      value={o.v}
                      disableRipple
                      sx={{
                        borderRadius: '10px', px: 1.25, py: 1.1, gap: 1.25, fontSize: 14,
                        color: active ? 'var(--text)' : 'var(--text2)', fontWeight: active ? 500 : 400,
                        '&:hover': { background: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
                        '&.Mui-selected': { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
                        '&.Mui-selected:hover': { background: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
                      }}
                    >
                      <span style={{ display: 'flex', color: active ? 'var(--accent-dark)' : 'var(--text3)' }}>{o.icon}</span>
                      <span style={{ flex: 1 }}>{t('lawyers.' + o.k)}</span>
                      {active && <CheckRounded sx={{ fontSize: 18, color: 'var(--accent)' }} />}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          </div>

          {/* results */}
          {loading ? (
            <div className="lawyers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
            </div>
          ) : visibleLawyers.length > 0 ? (
            <>
              <div className="lawyers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
                {visibleLawyers.map((lawyer, index) => renderCard(lawyer, index))}
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
                  <Pagination
                    count={totalPages}
                    page={currentPage}
                    onChange={(e, page) => setCurrentPage(page)}
                    sx={{
                      '& .MuiPaginationItem-root': {
                        color: 'var(--text2)', fontFamily: 'inherit', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', background: 'var(--card-glass)',
                        '&:hover': { borderColor: 'var(--accent)' },
                      },
                      '& .Mui-selected': {
                        background: 'var(--accent) !important', color: '#FFFFFF', borderColor: 'var(--accent)',
                      },
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div style={{ ...glassCard, padding: '64px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 300, letterSpacing: '0.05em', color: 'var(--text)', marginBottom: 10 }}>
                {t('lawyers.emptyTitle')}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 22 }}>
                {t('lawyers.emptySub')}
              </div>
              <button
                onClick={handleClearFilters}
                style={{
                  background: 'var(--accent)', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500,
                  letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 26px',
                  borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('lawyers.resetFilters')}
              </button>
            </div>
          )}
        </div>
      </div>

      <BookingModal open={bookingModalOpen} onClose={handleCloseBookingModal} lawyer={selectedLawyer} />

      <style>{`
        @media (max-width: 640px){ .lawyers-grid { grid-template-columns: 1fr !important; } }
        .online-dot { animation: onlinePulse 2s ease-in-out infinite; }
        @keyframes onlinePulse { 0%,100%{ box-shadow: 0 0 0 0 rgba(90,160,106,0.5) } 50%{ box-shadow: 0 0 0 4px rgba(90,160,106,0) } }
        @media (prefers-reduced-motion: reduce){ .online-dot { animation: none } }
      `}</style>
    </GlassShell>
  );
};

export default LawyersPageGlass;
