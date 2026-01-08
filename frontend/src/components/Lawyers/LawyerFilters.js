import React from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Chip,
  Divider,
  Button,
} from '@mui/material';
import { FilterList, Clear } from '@mui/icons-material';

const LawyerFilters = ({ filters, onFilterChange, onClearFilters, specializations, regions }) => {
  const handleChange = (field) => (event) => {
    onFilterChange({ ...filters, [field]: event.target.value });
  };

  const handlePriceChange = (event, newValue) => {
    onFilterChange({ ...filters, priceRange: newValue });
  };

  const handleRatingChange = (event, newValue) => {
    onFilterChange({ ...filters, minRating: newValue });
  };

  return (
    <Paper sx={{ p: 3, position: 'sticky', top: 16 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <FilterList sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" fontWeight="bold" color="primary.main">
          Фильтры
        </Typography>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {/* Specialization Filter */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Специализация</InputLabel>
        <Select
          value={filters.specialization}
          onChange={handleChange('specialization')}
          label="Специализация"
        >
          <MenuItem value="">Все специализации</MenuItem>
          {specializations.map((spec) => (
            <MenuItem key={spec.id} value={spec.id}>
              {spec.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Region Filter */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Регион</InputLabel>
        <Select
          value={filters.region}
          onChange={handleChange('region')}
          label="Регион"
        >
          <MenuItem value="">Все регионы</MenuItem>
          {regions.map((region) => (
            <MenuItem key={region.id} value={region.id}>
              {region.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Price Range */}
      <Box sx={{ mb: 3 }}>
        <Typography gutterBottom color="text.secondary">
          Цена (сум/час)
        </Typography>
        <Box sx={{ px: 1 }}>
          <Slider
            value={filters.priceRange}
            onChange={handlePriceChange}
            valueLabelDisplay="auto"
            min={10000}
            max={500000}
            step={10000}
            marks={[
              { value: 10000, label: '10k' },
              { value: 250000, label: '250k' },
              { value: 500000, label: '500k' },
            ]}
            sx={{
              color: 'secondary.main',
              '& .MuiSlider-thumb': {
                bgcolor: 'secondary.main',
              },
            }}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {filters.priceRange[0].toLocaleString()}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {filters.priceRange[1].toLocaleString()}
          </Typography>
        </Box>
      </Box>

      {/* Rating Filter */}
      <Box sx={{ mb: 3 }}>
        <Typography gutterBottom color="text.secondary">
          Минимальный рейтинг: {filters.minRating}
        </Typography>
        <Box sx={{ px: 1 }}>
          <Slider
            value={filters.minRating}
            onChange={handleRatingChange}
            valueLabelDisplay="auto"
            min={0}
            max={5}
            step={0.5}
            marks={[
              { value: 0, label: '0' },
              { value: 2.5, label: '2.5' },
              { value: 5, label: '5' },
            ]}
            sx={{
              color: 'primary.main',
            }}
          />
        </Box>
      </Box>

      {/* Experience Filter */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Опыт работы</InputLabel>
        <Select
          value={filters.experience}
          onChange={handleChange('experience')}
          label="Опыт работы"
        >
          <MenuItem value="">Любой опыт</MenuItem>
          <MenuItem value="1-3">1-3 года</MenuItem>
          <MenuItem value="3-5">3-5 лет</MenuItem>
          <MenuItem value="5-10">5-10 лет</MenuItem>
          <MenuItem value="10+">Более 10 лет</MenuItem>
        </Select>
      </FormControl>

      {/* Sort */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Сортировка</InputLabel>
        <Select
          value={filters.sortBy}
          onChange={handleChange('sortBy')}
          label="Сортировка"
        >
          <MenuItem value="rating">По рейтингу</MenuItem>
          <MenuItem value="price-asc">По цене (возрастание)</MenuItem>
          <MenuItem value="price-desc">По цене (убывание)</MenuItem>
          <MenuItem value="experience">По опыту</MenuItem>
          <MenuItem value="consultations">По количеству консультаций</MenuItem>
        </Select>
      </FormControl>

      {/* Clear Filters Button */}
      <Button
        fullWidth
        variant="outlined"
        startIcon={<Clear />}
        onClick={onClearFilters}
        sx={{ mt: 2 }}
      >
        Очистить фильтры
      </Button>

      {/* Active Filters */}
      {(filters.specialization || filters.region || filters.experience) && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="caption" color="text.secondary" gutterBottom display="block">
            Активные фильтры:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {filters.specialization && (
              <Chip
                label={specializations.find(s => s.id === filters.specialization)?.name}
                size="small"
                onDelete={() => onFilterChange({ ...filters, specialization: '' })}
              />
            )}
            {filters.region && (
              <Chip
                label={regions.find(r => r.id === filters.region)?.name}
                size="small"
                onDelete={() => onFilterChange({ ...filters, region: '' })}
              />
            )}
            {filters.experience && (
              <Chip
                label={`Опыт: ${filters.experience} лет`}
                size="small"
                onDelete={() => onFilterChange({ ...filters, experience: '' })}
              />
            )}
          </Box>
        </Box>
      )}
    </Paper>
  );
};

export default LawyerFilters;
