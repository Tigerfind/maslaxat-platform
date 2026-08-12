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
  CloseRounded,
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

// Потолок фильтра цены (сум). Разовая консультация у топ-адвоката реально доходит до ~2–4 млн;
// 10 млн даёт запас под премиум-сегмент. Дефолт диапазона = [0, MAX_PRICE] (показывать всех).
const MAX_PRICE = 10000000;
// Пороги быстрых фильтров. Держим синхронно с backend/src/routes/lawyers.js:
// сервер присылает их в facets, эти значения — фолбэк, если фасеты не пришли.
const HIGH_RATING_FROM = 4.5;
const EXPERIENCED_PRESET = '10+';

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
    specializations: [],
    minRating: 0,
    priceRange: [0, MAX_PRICE],
    experience: '',
    sortBy: 'rating',
    onlineOnly: false,
    location: '',
    language: '',
    // Подбор «под себя»: ценовой сегмент и ступень юриста. Сортировка отвечает
    // на «в каком порядке», эти два — на «кто мне вообще подходит».
    budget: '',
    status: '',
  });
  const [filterOptions, setFilterOptions] = useState({ locations: [], languages: [] });
  // Фасеты каталога: счётчики для чипов и порог «недорого» из реальных цен.
  const [facets, setFacets] = useState(null);
  const [totalFound, setTotalFound] = useState(0);

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
      const { specializations, ...restFilters } = filters;
      const response = await clientService.lawyers.searchLawyers({
        ...restFilters,
        // Мультивыбор областей → бэкенду одной строкой через запятую (OR-совпадение).
        specialization: (specializations || []).join(','),
        search: searchQuery,
        page: currentPage,
        limit: 9,
      });

      setLawyers(response.lawyers || []);
      setTotalPages(response.totalPages || 1);
      setTotalFound(response.total || 0);
      if (response.facets) setFacets(response.facets);
    } catch (error) {
      console.error('Error fetching lawyers:', error);
      setLawyers([]);
      setTotalFound(0);
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
      specializations: [],
      minRating: 0,
      priceRange: [0, MAX_PRICE],
      experience: '',
      sortBy: 'rating',
      onlineOnly: false,
      location: '',
      language: '',
      budget: '',
      status: '',
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
          // Мультивыбор: храним ИМЕНА (так хранит/фильтрует бэкенд). «Все» = пустой список.
          const selected = filters.specializations || [];
          const checked = sp.id ? selected.includes(sp.name) : selected.length === 0;
          const toggle = () => {
            if (!sp.id) { handleFilterChange('specializations', []); return; }
            handleFilterChange('specializations', selected.includes(sp.name)
              ? selected.filter((n) => n !== sp.name)
              : [...selected, sp.name]);
          };
          return (
            <div
              key={sp.id || 'all'}
              onClick={toggle}
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
          max={MAX_PRICE}
          step={50000}
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
        <span>{MAX_PRICE.toLocaleString()}</span>
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
          padding: 20,
          position: 'relative',
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
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
          style={{ position: 'absolute', top: 14, right: 14, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 3, color: isFav ? 'var(--accent)' : 'var(--text3)' }}
        >
          {isFav ? <FavoriteRounded sx={{ fontSize: 21 }} /> : <FavoriteBorderOutlined sx={{ fontSize: 21 }} />}
        </button>

        {/* avatar */}
        <div
          onClick={() => handleViewProfile(lawyer.id)}
          style={{
            width: 60, height: 60, borderRadius: 16, flexShrink: 0, cursor: 'pointer', position: 'relative',
            background: lawyer.avatar ? `center/cover url(${lawyer.avatar})` : grad,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 19, fontWeight: 600,
            boxShadow: '0 6px 16px rgba(26,26,26,0.14)',
          }}
        >
          {!lawyer.avatar && initialsOf(lawyer.name)}
          {lawyer.verificationStatus === 'approved' && (
            <span style={{
              position: 'absolute', bottom: -2, right: -2, width: 19, height: 19, borderRadius: '50%',
              background: '#5AA06A', border: '3px solid var(--surface)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
            }}>
              <CheckRounded sx={{ fontSize: 10 }} />
            </span>
          )}
        </div>

        {/* body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* name + online */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, paddingRight: 52 }}>
            <span
              onClick={() => handleViewProfile(lawyer.id)}
              style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {lawyer.name}
            </span>
            {lawyer.isAvailable && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11.5, color: '#5AA06A', fontWeight: 500 }}>
                <span className="online-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#5AA06A' }} />
                {t('lawyers.onlineNow')}
              </span>
            )}
            {/* Ступень юриста — тем же правилом, что и фильтр «По статусу»:
                выбрал «Топ-юристы» — на карточках должен стоять «Топ». */}
            {lawyer.status && lawyer.status !== 'practitioner' && (
              <span style={{
                flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999,
                border: `1px solid ${lawyer.status === 'top' ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: lawyer.status === 'top' ? 'linear-gradient(135deg,var(--accent),var(--accent-dark))' : 'transparent',
                color: lawyer.status === 'top' ? '#fff' : 'var(--text3)',
              }}>
                {lawyer.status === 'top' ? t('lawyers.badgeTop') : t('lawyers.badgeExpert')}
              </span>
            )}
          </div>

          {/* rating + meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5, color: 'var(--text3)' }}>
            <span style={{ display: 'flex', gap: 1 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <StarRounded key={n} sx={{ fontSize: 15, color: n <= roundedRating ? '#C9A36E' : 'var(--border)' }} />
              ))}
            </span>
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{lawyer.rating || 0}</strong>
            <span>· {reviews} {t('lawyers.reviews')} · {lawyer.experience || 0} {t('lawyers.years')} · {lawyer.completedConsultations || 0} {t('lawyers.solved').toLowerCase()}</span>
          </div>

          {/* specializations */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {tags.slice(0, 3).map((tg, ti) => (
                <span
                  key={ti}
                  style={ti === 0
                    ? { background: 'rgba(184,149,110,0.14)', color: 'var(--accent-dark)', fontSize: 11.5, padding: '4px 11px', borderRadius: 20 }
                    : { border: '1px solid var(--border-strong)', color: 'var(--text2)', fontSize: 11.5, padding: '4px 11px', borderRadius: 20 }}
                >
                  {tg}
                </span>
              ))}
              {tags.length > 3 && (
                <span style={{ color: 'var(--text3)', fontSize: 11.5, padding: '4px 6px' }}>+{tags.length - 3}</span>
              )}
            </div>
          )}

          {/* footer: price + CTA */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              {t('lawyers.from')} <strong style={{ fontSize: 17, color: 'var(--text)', fontWeight: 600 }}>{(lawyer.priceFrom || 0).toLocaleString()}</strong> {t('lawyers.sum')}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleBookConsultation(lawyer); }}
              style={{
                flexShrink: 0,
                background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
                color: '#FFFFFF', border: 'none', fontSize: 12.5, fontWeight: 600,
                padding: '10px 20px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                boxShadow: '0 4px 12px rgba(184,149,110,0.3)', transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(184,149,110,0.42)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(184,149,110,0.3)'; }}
            >
              {t('lawyers.bookConsultation')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Список отдаёт сервер уже отфильтрованным (в т.ч. по «только онлайн») —
  // повторная фильтрация на клиенте лишь ломала бы счётчик и пагинацию.
  const visibleLawyers = lawyers;

  // Порог «недорого» — из фасетов сервера; без них чип неактивен.
  const budgetMax = facets?.budget?.maxPrice ?? null;

  // Активные фильтры одним списком: каждый можно снять по отдельности.
  const activeChips = (() => {
    const chips = [];
    const fmt = (k, v) => t('lawyers.' + k).replace('{n}', v);
    (filters.specializations || []).forEach((sp) => chips.push({
      key: `spec:${sp}`,
      label: fmt('fltSpec', sp),
      clear: () => handleFilterChange('specializations', filters.specializations.filter((x) => x !== sp)),
    }));
    if (searchQuery) chips.push({
      key: 'search', label: fmt('fltSearch', searchQuery), clear: () => setSearchQuery(''),
    });
    if (filters.onlineOnly) chips.push({
      key: 'online', label: t('lawyers.fltOnline'), clear: () => handleFilterChange('onlineOnly', false),
    });
    if (filters.minRating > 0) chips.push({
      key: 'rating', label: fmt('fltRating', filters.minRating), clear: () => handleFilterChange('minRating', 0),
    });
    if (filters.experience) chips.push({
      key: 'exp', label: fmt('fltExperience', filters.experience), clear: () => handleFilterChange('experience', ''),
    });
    if (filters.budget) chips.push({
      key: 'budget',
      label: t('lawyers.seg' + filters.budget.charAt(0).toUpperCase() + filters.budget.slice(1)),
      clear: () => handleFilterChange('budget', ''),
    });
    if (filters.status) chips.push({
      key: 'status',
      label: t('lawyers.' + { top: 'stTop', expert: 'stExpert', practitioner: 'stPractitioner' }[filters.status]),
      clear: () => handleFilterChange('status', ''),
    });
    if (filters.priceRange[0] > 0) chips.push({
      key: 'priceFrom',
      label: fmt('fltPriceFrom', filters.priceRange[0].toLocaleString()),
      clear: () => handleFilterChange('priceRange', [0, filters.priceRange[1]]),
    });
    if (filters.priceRange[1] < MAX_PRICE) chips.push({
      key: 'priceTo',
      label: fmt('fltPrice', filters.priceRange[1].toLocaleString()),
      clear: () => handleFilterChange('priceRange', [filters.priceRange[0], MAX_PRICE]),
    });
    if (filters.location) chips.push({
      key: 'loc', label: fmt('fltLocation', filters.location), clear: () => handleFilterChange('location', ''),
    });
    if (filters.language) chips.push({
      key: 'lang', label: fmt('fltLanguage', filters.language), clear: () => handleFilterChange('language', ''),
    });
    return chips;
  })();

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

          {/* Быстрые фильтры.
              Раньше три из четырёх были ярлыками СОРТИРОВКИ: перезаписывали друг
              друга, не выключались и дублировали выпадающий список, а «Высокий
              рейтинг» горел всегда (сортировка по умолчанию — rating). Теперь это
              настоящие независимые фильтры: комбинируются, снимаются повторным
              нажатием, показывают, сколько юристов под них попадает, и гаснут,
              если таких нет. Пороги приходят с сервера (фасеты) — «недорого»
              считается от реальных цен каталога, а не от константы. */}
          {(() => {
            const presets = [
              {
                k: 'presetOnline',
                active: filters.onlineOnly,
                count: facets?.online,
                hint: t('lawyers.presetOnlineHint'),
                apply: () => handleFilterChange('onlineOnly', !filters.onlineOnly),
              },
              {
                k: 'presetTop',
                active: filters.minRating === HIGH_RATING_FROM,
                count: facets?.highRating?.count,
                hint: t('lawyers.presetTopHint').replace('{n}', facets?.highRating?.from ?? HIGH_RATING_FROM),
                apply: () => handleFilterChange('minRating', filters.minRating === HIGH_RATING_FROM ? 0 : HIGH_RATING_FROM),
              },
              {
                k: 'presetCheap',
                active: budgetMax != null && filters.priceRange[1] === budgetMax,
                count: facets?.budget?.count,
                disabled: budgetMax == null,
                hint: budgetMax != null ? t('lawyers.presetCheapHint').replace('{n}', budgetMax.toLocaleString()) : '',
                apply: () => handleFilterChange(
                  'priceRange',
                  filters.priceRange[1] === budgetMax ? [filters.priceRange[0], MAX_PRICE] : [filters.priceRange[0], budgetMax],
                ),
              },
              {
                k: 'presetExperienced',
                active: filters.experience === EXPERIENCED_PRESET,
                count: facets?.experienced?.count,
                hint: t('lawyers.presetExperiencedHint').replace('{n}', facets?.experienced?.from ?? 10),
                apply: () => handleFilterChange('experience', filters.experience === EXPERIENCED_PRESET ? '' : EXPERIENCED_PRESET),
              },
            ];
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {presets.map((p) => {
                  // Чип без единого подходящего юриста бесполезен: гасим, чтобы
                  // клиент не тыкал в него и не получал пустой экран.
                  const empty = p.disabled || p.count === 0;
                  return (
                    <button
                      key={p.k}
                      onClick={empty ? undefined : p.apply}
                      disabled={empty}
                      title={empty ? t('lawyers.presetNone') : p.hint}
                      aria-pressed={p.active}
                      style={{
                        cursor: empty ? 'not-allowed' : 'pointer', padding: '8px 15px', borderRadius: 999,
                        fontSize: 13, fontFamily: 'inherit', fontWeight: p.active ? 600 : 400,
                        border: `1px solid ${p.active ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: p.active ? 'linear-gradient(135deg,var(--accent),var(--accent-dark))' : 'var(--surface)',
                        color: p.active ? '#fff' : 'var(--text2)', transition: 'all .15s',
                        opacity: empty ? 0.45 : 1,
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                      }}
                    >
                      {t('lawyers.' + p.k)}
                      {p.count != null && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, lineHeight: 1, padding: '3px 6px', borderRadius: 999,
                          background: p.active ? 'rgba(255,255,255,0.22)' : 'var(--border)',
                          color: p.active ? '#fff' : 'var(--text3)',
                        }}>{p.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ПОДБОР ПОД СЕБЯ.
              Сортировка отвечает только на «в каком порядке показать» — список
              при этом остаётся тем же. Здесь клиент сужает каталог до тех, кто
              ему подходит: по бюджету и по уровню юриста. Границы цен и критерии
              ступеней приходят с сервера и показаны прямо на кнопках, чтобы выбор
              не был вслепую. */}
          {(facets?.priceSegments?.length > 0 || facets?.statusSegments?.length > 0) && (
            <div style={{ ...glassCard, padding: 18, marginBottom: 18 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 14 }}>
                {t('lawyers.pickTitle')}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
                {[
                  {
                    field: 'budget',
                    label: t('lawyers.pickBudget'),
                    options: (facets.priceSegments || []).map((seg) => ({
                      v: seg.key,
                      count: seg.count,
                      title: t('lawyers.seg' + seg.key.charAt(0).toUpperCase() + seg.key.slice(1)),
                      hint: seg.key === 'economy'
                        ? t('lawyers.segEconomyHint').replace('{n}', Number(seg.to || 0).toLocaleString())
                        : seg.key === 'premium'
                          ? t('lawyers.segPremiumHint').replace('{n}', Number(seg.from || 0).toLocaleString())
                          : t('lawyers.segStandardHint')
                            .replace('{a}', Number(seg.from || 0).toLocaleString())
                            .replace('{b}', Number(seg.to || 0).toLocaleString()),
                    })),
                  },
                  {
                    field: 'status',
                    label: t('lawyers.pickStatus'),
                    options: (facets.statusSegments || []).map((seg) => {
                      const r = facets.statusRules || {};
                      const titleKey = { top: 'stTop', expert: 'stExpert', practitioner: 'stPractitioner' }[seg.key];
                      const hint = seg.key === 'top'
                        ? t('lawyers.stTopHint').replace('{r}', r.TOP_RATING ?? 4.8).replace('{n}', r.TOP_REVIEWS ?? 30)
                        : seg.key === 'expert'
                          ? t('lawyers.stExpertHint').replace('{y}', r.EXPERT_EXPERIENCE ?? 10).replace('{n}', r.EXPERT_REVIEWS ?? 20)
                          : t('lawyers.stPractitionerHint');
                      return { v: seg.key, count: seg.count, title: t('lawyers.' + titleKey), hint };
                    }),
                  },
                ].map((group) => (
                  <div key={group.field}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 9 }}>{group.label}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {group.options.map((o) => {
                        const active = filters[group.field] === o.v;
                        // Пустой сегмент выбирать незачем — он гарантированно
                        // приведёт на экран «никого не найдено».
                        const empty = o.count === 0;
                        return (
                          <button
                            key={o.v}
                            disabled={empty}
                            aria-pressed={active}
                            onClick={() => handleFilterChange(group.field, active ? '' : o.v)}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                              textAlign: 'left', width: '100%', padding: '10px 13px', borderRadius: 12,
                              cursor: empty ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                              background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                              opacity: empty ? 0.45 : 1, transition: 'all .15s',
                            }}
                          >
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 13.5, fontWeight: active ? 600 : 500, color: 'var(--text)' }}>{o.title}</span>
                              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{o.hint}</span>
                            </span>
                            <span style={{
                              flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                              background: active ? 'var(--accent)' : 'var(--border)',
                              color: active ? '#fff' : 'var(--text3)',
                            }}>{o.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Активные фильтры: видно, что именно сужает выдачу, и каждый снимается
              по отдельности — раньше был только «сбросить всё». */}
          {activeChips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {t('lawyers.activeFilters')}
              </span>
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  onClick={c.clear}
                  title={t('lawyers.clearOne')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    padding: '6px 10px 6px 12px', borderRadius: 999, fontSize: 12.5, fontFamily: 'inherit',
                    border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--text2)',
                  }}
                >
                  {c.label}
                  <CloseRounded sx={{ fontSize: 14, color: 'var(--text3)' }} />
                </button>
              ))}
              <button
                onClick={handleClearFilters}
                style={{
                  cursor: 'pointer', padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontFamily: 'inherit',
                  border: 'none', background: 'transparent', color: 'var(--accent-dark)', fontWeight: 600,
                }}
              >
                {t('lawyers.clearAll')}
              </button>
            </div>
          )}

          {/* Сколько всего нашлось — раньше количество нигде не показывалось */}
          {!loading && (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
              {totalFound > 0 ? `${t('lawyers.found')}: ${totalFound}` : t('lawyers.foundNone')}
            </div>
          )}

          {/* results */}
          {loading ? (
            <div className="lawyers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
            </div>
          ) : visibleLawyers.length > 0 ? (
            <>
              <div className="lawyers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
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

              {/* Вместо одной кнопки «сбросить всё» предлагаем снять конкретное
                  условие: чаще всего мешает один фильтр, а не все сразу. */}
              {activeChips.length > 0 && (
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 10 }}>{t('lawyers.emptyHint')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {activeChips.map((c) => (
                      <button
                        key={c.key}
                        onClick={c.clear}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontFamily: 'inherit',
                          border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--text2)',
                        }}
                      >
                        {c.label}
                        <CloseRounded sx={{ fontSize: 14, color: 'var(--text3)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
