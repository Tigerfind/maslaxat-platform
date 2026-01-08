/**
 * Lawyers Module - LawyerFilters Component
 * Filter panel for lawyers list
 */

import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  FormControlLabel,
  Switch,
  Button,
  Chip,
  TextField,
  InputAdornment,
} from '@mui/material';
import { Search, FilterList, Clear } from '@mui/icons-material';

const LawyerFilters = ({
  filters,
  specializations,
  onFilterChange,
  onClear,
}) => {
  const [localFilters, setLocalFilters] = useState(filters);

  const handleChange = (key, value) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    onFilterChange?.(newFilters);
  };

  const handleClear = () => {
    setLocalFilters({});
    onClear?.();
  };

  const activeFiltersCount = Object.values(localFilters).filter(Boolean).length;

  return (
    <Paper sx={{ p: 3, borderRadius: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterList color="primary" />
          <Typography variant="h6" fontWeight="bold">
            Фильтры
          </Typography>
          {activeFiltersCount > 0 && (
            <Chip
              label={activeFiltersCount}
              size="small"
              color="primary"
              sx={{ ml: 1 }}
            />
          )}
        </Box>
        {activeFiltersCount > 0 && (
          <Button
            startIcon={<Clear />}
            onClick={handleClear}
            size="small"
            color="inherit"
          >
            Сбросить
          </Button>
        )}
      </Box>

      {/* Search */}
      <TextField
        fullWidth
        placeholder="Поиск по имени..."
        value={localFilters.search || ''}
        onChange={(e) => handleChange('search', e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 3 }}
      />

      {/* Specialization */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Специализация</InputLabel>
        <Select
          value={localFilters.specialization || ''}
          onChange={(e) => handleChange('specialization', e.target.value)}
          label="Специализация"
        >
          <MenuItem value="">Все специализации</MenuItem>
          {specializations.map((spec) => (
            <MenuItem key={spec.id} value={spec.name}>
              {spec.name} ({spec.count})
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Rating */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Минимальный рейтинг: {localFilters.minRating || 0}
        </Typography>
        <Slider
          value={localFilters.minRating || 0}
          onChange={(_, value) => handleChange('minRating', value)}
          min={0}
          max={5}
          step={0.5}
          marks={[
            { value: 0, label: '0' },
            { value: 2.5, label: '2.5' },
            { value: 5, label: '5' },
          ]}
          sx={{ color: '#3d5a52' }}
        />
      </Box>

      {/* Price Range */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Макс. цена: {(localFilters.maxPrice || 500000).toLocaleString()} сум
        </Typography>
        <Slider
          value={localFilters.maxPrice || 500000}
          onChange={(_, value) => handleChange('maxPrice', value)}
          min={50000}
          max={500000}
          step={10000}
          sx={{ color: '#a67c52' }}
        />
      </Box>

      {/* Experience */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Опыт работы</InputLabel>
        <Select
          value={localFilters.experience || ''}
          onChange={(e) => handleChange('experience', e.target.value)}
          label="Опыт работы"
        >
          <MenuItem value="">Любой</MenuItem>
          <MenuItem value="1-3">1-3 года</MenuItem>
          <MenuItem value="3-5">3-5 лет</MenuItem>
          <MenuItem value="5-10">5-10 лет</MenuItem>
          <MenuItem value="10+">Более 10 лет</MenuItem>
        </Select>
      </FormControl>

      {/* Available Only */}
      <FormControlLabel
        control={
          <Switch
            checked={localFilters.available || false}
            onChange={(e) => handleChange('available', e.target.checked)}
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': {
                color: '#3d5a52',
              },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                backgroundColor: '#3d5a52',
              },
            }}
          />
        }
        label="Только доступные"
      />
    </Paper>
  );
};

export default LawyerFilters;
