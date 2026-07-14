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
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import BookingModal from '../../components/BookingModal';
import { toast } from 'react-toastify';
import GlassShell from '../../components/GlassKit/GlassShell';

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

const labelStyle = {
  fontSize: 12,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 10,
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

  const [filters, setFilters] = useState({
    specialization: '',
    minRating: 0,
    priceRange: [0, 500000],
    experience: '',
    sortBy: 'rating',
  });

  useEffect(() => {
    fetchLawyers();
    loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, currentPage, searchQuery]);

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
        toast.success('Удалено из избранного');
      } else {
        await clientService.favorites.addFavorite(lawyerId);
        setFavoriteLawyers((prev) => new Set(prev).add(lawyerId));
        toast.success('Добавлено в избранное');
      }
    } catch (error) {
      toast.error('Ошибка при изменении избранного');
    }
  };

  const activeSpecs = specializations.filter((s) => s.active);

  // ---- Filters panel (shared between desktop sidebar + mobile drawer) ----
  const filtersPanel = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
          Фильтры
        </div>
        {isMobile && (
          <IconButton size="small" onClick={() => setFilterDrawerOpen(false)}>
            <Close fontSize="small" sx={{ color: 'var(--text2)' }} />
          </IconButton>
        )}
      </div>

      {/* Specialization (single-select rows) */}
      <div style={labelStyle}>Специализация</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {[{ id: '', name: 'Все' }, ...activeSpecs].map((sp) => {
          const checked = filters.specialization === sp.id;
          return (
            <label
              key={sp.id || 'all'}
              onClick={() => handleFilterChange('specialization', sp.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text2)', cursor: 'pointer' }}
            >
              <span
                style={{
                  width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                  border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: checked ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
              >
                {checked && <CheckRounded sx={{ fontSize: 13, color: '#FFFFFF' }} />}
              </span>
              {sp.name}
            </label>
          );
        })}
      </div>

      {/* Min rating */}
      <div style={labelStyle}>Минимальный рейтинг</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Rating
          value={filters.minRating}
          onChange={(e, value) => handleFilterChange('minRating', value || 0)}
          precision={0.5}
          sx={{
            '& .MuiRating-iconFilled': { color: 'var(--accent)' },
            '& .MuiRating-iconEmpty': { color: 'var(--border-strong)' },
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>
          {filters.minRating ? `${filters.minRating}+` : 'Любой'}
        </span>
      </div>

      {/* Price range */}
      <div style={labelStyle}>Цена, сум</div>
      <div style={{ padding: '0 4px' }}>
        <Slider
          value={filters.priceRange}
          onChange={(e, value) => handleFilterChange('priceRange', value)}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => v.toLocaleString()}
          min={0}
          max={500000}
          step={10000}
          sx={{
            color: 'var(--accent)',
            '& .MuiSlider-thumb': {
              bgcolor: 'var(--accent)',
              '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 8px rgba(184,149,110,0.16)' },
            },
            '& .MuiSlider-track': { bgcolor: 'var(--accent)', border: 'none' },
            '& .MuiSlider-rail': { bgcolor: 'var(--border-strong)', opacity: 1 },
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 24 }}>
        <span>{filters.priceRange[0].toLocaleString()}</span>
        <span>{filters.priceRange[1].toLocaleString()}</span>
      </div>

      {/* Experience */}
      <div style={labelStyle}>Опыт работы</div>
      <FormControl fullWidth size="small" sx={{ marginBottom: 3 }}>
        <Select
          value={filters.experience}
          displayEmpty
          onChange={(e) => handleFilterChange('experience', e.target.value)}
          sx={glassSelectSx}
        >
          <MenuItem value="">Любой</MenuItem>
          <MenuItem value="0-5">0–5 лет</MenuItem>
          <MenuItem value="5-10">5–10 лет</MenuItem>
          <MenuItem value="10-15">10–15 лет</MenuItem>
          <MenuItem value="15+">15+ лет</MenuItem>
        </Select>
      </FormControl>

      <button
        onClick={() => { handleClearFilters(); if (isMobile) setFilterDrawerOpen(false); }}
        style={{
          width: '100%', marginTop: 6, padding: '11px 16px', background: 'transparent',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text2)',
        }}
      >
        Сбросить фильтры
      </button>
    </>
  );

  // ---- Lawyer card ----
  const renderCard = (lawyer, index) => {
    const isFav = favoriteLawyers.has(lawyer.id);
    const reviews = lawyer.reviewsCount ?? 0;
    const tags = lawyer.specializations || [];
    return (
      <div
        key={lawyer.id}
        style={{
          ...glassCard,
          padding: 22,
          transition: 'all .25s cubic-bezier(.4,0,.2,1)',
          animation: `cardRise 0.4s ease ${index * 0.05}s both`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-3px)';
          e.currentTarget.style.boxShadow = '0 14px 30px rgba(26,26,26,0.10)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--card-shadow)';
          e.currentTarget.style.borderColor = 'var(--card-brd)';
        }}
      >
        {/* header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15 }}>
          <div
            onClick={() => handleViewProfile(lawyer.id)}
            style={{
              width: 60, height: 60, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', position: 'relative',
              background: lawyer.avatar ? `center/cover url(${lawyer.avatar})` : AV_BG[index % AV_BG.length],
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 20,
            }}
          >
            {!lawyer.avatar && initialsOf(lawyer.name)}
            {lawyer.isVerified && (
              <span style={{
                position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%',
                background: '#7A9A6B', border: '2px solid var(--surface)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
              }}>
                <CheckRounded sx={{ fontSize: 12 }} />
              </span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              onClick={() => handleViewProfile(lawyer.id)}
              style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {lawyer.name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <StarRounded sx={{ fontSize: 15 }} /> {lawyer.rating || 0}
              <span style={{ color: 'var(--text3)' }}>({reviews} отзывов)</span>
            </div>
          </div>
          <button
            onClick={(e) => handleToggleFavorite(e, lawyer.id)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 2, color: isFav ? 'var(--accent)' : 'var(--text3)' }}
          >
            {isFav ? <FavoriteRounded sx={{ fontSize: 22 }} /> : <FavoriteBorderOutlined sx={{ fontSize: 22 }} />}
          </button>
        </div>

        {/* tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '16px 0' }}>
            {tags.slice(0, 3).map((tg, i) => (
              <span key={i} style={{
                background: 'rgba(184,149,110,0.14)', color: 'var(--accent-dark)', fontSize: 12,
                padding: '5px 11px', borderRadius: 'var(--radius)',
              }}>
                {tg}
              </span>
            ))}
          </div>
        )}

        {/* stats row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text2)',
          padding: '14px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
          margin: `${tags.length > 0 ? 0 : 16}px 0 16px`,
        }}>
          <span>Опыт: <strong style={{ color: 'var(--text)', fontWeight: 500 }}>{lawyer.experience || 0} лет</strong></span>
          {typeof lawyer.successRate === 'number' && (
            <span>Успех: <strong style={{ color: '#7A9A6B', fontWeight: 500 }}>{lawyer.successRate}%</strong></span>
          )}
        </div>

        {/* price + book */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>от</span>{' '}
            <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)' }}>{(lawyer.priceFrom || 0).toLocaleString()}</span>{' '}
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>сум</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleBookConsultation(lawyer); }}
            style={{
              background: '#1A1A1A', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500,
              letterSpacing: '0.06em', textTransform: 'uppercase', padding: '12px 20px',
              borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Записаться
          </button>
        </div>
      </div>
    );
  };

  return (
    <GlassShell active="/lawyers" title="Юристы" subtitle="Лучшие юристы для вашего дела">
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
              placeholder="Поиск по имени или специализации…"
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
                <TuneOutlined sx={{ fontSize: 18 }} /> Фильтры
              </button>
            )}

            <FormControl size="small" sx={{ minWidth: 190 }}>
              <Select
                value={filters.sortBy}
                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                sx={glassSelectSx}
              >
                <MenuItem value="rating">По рейтингу</MenuItem>
                <MenuItem value="price-asc">По цене (возр.)</MenuItem>
                <MenuItem value="price-desc">По цене (убыв.)</MenuItem>
                <MenuItem value="experience">По опыту</MenuItem>
              </Select>
            </FormControl>
          </div>

          {/* results */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                animation: 'spin 1s linear infinite',
              }} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : lawyers.length > 0 ? (
            <>
              <div className="lawyers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
                {lawyers.map((lawyer, index) => renderCard(lawyer, index))}
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
                Юристы не найдены
              </div>
              <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 22 }}>
                Попробуйте изменить параметры фильтров
              </div>
              <button
                onClick={handleClearFilters}
                style={{
                  background: 'var(--accent)', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500,
                  letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 26px',
                  borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          )}
        </div>
      </div>

      <BookingModal open={bookingModalOpen} onClose={handleCloseBookingModal} lawyer={selectedLawyer} />

      <style>{`@media (max-width: 640px){ .lawyers-grid { grid-template-columns: 1fr !important; } }`}</style>
    </GlassShell>
  );
};

export default LawyersPageGlass;
