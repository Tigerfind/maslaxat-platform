import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Chip,
  Avatar,
  Divider,
} from '@mui/material';
import {
  CalendarToday,
  AccessTime,
  AttachMoney,
  Send,
  Close,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import clientService from '../services/clientService';
import ConflictDetector from '../shared/validators/conflict-detector';

const BookingModal = ({ open, onClose, lawyer }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    question: '',
    description: '',
    preferredDate: '',
    preferredTime: '',
    consultationType: 'video',
  });

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.question.trim()) {
      toast.error('Пожалуйста, опишите ваш вопрос');
      return;
    }

    if (!formData.preferredDate || !formData.preferredTime) {
      toast.error('Пожалуйста, выберите желаемую дату и время');
      return;
    }

    try {
      setLoading(true);

      // Get current user from localStorage
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

      const bookingData = {
        ...formData,
        lawyerId: lawyer.id,
        lawyerName: lawyer.name,
        client: {
          id: currentUser.id,
          name: currentUser.name,
          avatar: null,
        },
        status: 'pending',
      };

      // Get existing consultations from localStorage
      const existingConsultations = JSON.parse(
        localStorage.getItem('consultationRequests') || '[]'
      );

      // Validate with conflict detector
      const validation = ConflictDetector.validateConsultationBooking(bookingData, {
        existingConsultations,
        minHoursAhead: 2,
        maxConsultationsPerDay: 10,
      });

      // Log conflicts in development mode
      ConflictDetector.logConflicts(validation);

      // Show conflicts if any critical ones exist
      if (!validation.isValid) {
        const message = ConflictDetector.formatConflictMessage(validation);
        toast.error(message || 'Обнаружены конфликты при бронировании');
        setLoading(false);
        return;
      }

      // Show warnings but allow to proceed
      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) => {
          toast.warning(warning.message, { autoClose: 5000 });
        });
      }

      // Proceed with booking if valid
      await clientService.lawyers.bookConsultation(lawyer.id, bookingData);

      toast.success('Запрос отправлен юристу! Ожидайте подтверждения.');
      onClose();

      // Сброс формы
      setFormData({
        question: '',
        description: '',
        preferredDate: '',
        preferredTime: '',
        consultationType: 'video',
      });
    } catch (error) {
      toast.error('Ошибка отправки запроса');
    } finally {
      setLoading(false);
    }
  };

  if (!lawyer) return null;

  // Генерация доступных временных слотов
  const timeSlots = [
    '09:00', '10:00', '11:00', '12:00',
    '14:00', '15:00', '16:00', '17:00',
    '18:00', '19:00', '20:00',
  ];

  // Минимальная дата - завтра
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(11, 27, 43, 0.12)',
        },
      }}
    >
      <DialogTitle
        sx={{
          bgcolor: '#FFFFFF',
          borderBottom: '1px solid #E6E9EE',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
          Запрос на консультацию
        </Typography>
        <Button
          onClick={onClose}
          sx={{ minWidth: 'auto', color: '#6B7280' }}
        >
          <Close />
        </Button>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: '#F4F6F8', py: 3 }}>
        {/* Информация о юристе */}
        <Box
          sx={{
            bgcolor: '#FFFFFF',
            borderRadius: '12px',
            p: 3,
            mb: 3,
            border: '1px solid #E6E9EE',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Avatar
              sx={{
                width: 60,
                height: 60,
                bgcolor: '#2563EB',
                fontSize: '1.5rem',
                fontWeight: 'bold',
              }}
            >
              {lawyer.name.charAt(0)}
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
                {lawyer.name}
              </Typography>
              <Typography variant="body2" sx={{ color: '#6B7280' }}>
                {lawyer.specialization}
              </Typography>
            </Box>
            <Chip
              icon={<AttachMoney sx={{ fontSize: 16 }} />}
              label={`${lawyer.price.toLocaleString()} сум`}
              sx={{
                bgcolor: '#FFFFFF',
                border: '1px solid #E6E9EE',
                fontWeight: 'bold',
                color: '#0B1B2B',
              }}
            />
          </Box>
        </Box>

        <Alert
          severity="info"
          sx={{
            mb: 3,
            borderRadius: 2,
            bgcolor: '#EFF6FF',
            border: '1px solid #DBEAFE',
          }}
        >
          Ваш запрос будет отправлен юристу. После подтверждения с его стороны, дата и время консультации будут зафиксированы.
        </Alert>

        {/* Форма */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Тип консультации */}
          <FormControl fullWidth>
            <InputLabel>Тип консультации</InputLabel>
            <Select
              value={formData.consultationType}
              onChange={(e) => handleChange('consultationType', e.target.value)}
              label="Тип консультации"
              sx={{ bgcolor: '#FFFFFF' }}
            >
              <MenuItem value="video">Видео-консультация</MenuItem>
              <MenuItem value="chat">Чат-консультация</MenuItem>
            </Select>
          </FormControl>

          {/* Вопрос */}
          <TextField
            label="Опишите ваш вопрос *"
            multiline
            rows={3}
            value={formData.question}
            onChange={(e) => handleChange('question', e.target.value)}
            placeholder="Кратко опишите суть вашего вопроса..."
            sx={{ bgcolor: '#FFFFFF' }}
          />

          {/* Дополнительное описание */}
          <TextField
            label="Дополнительная информация"
            multiline
            rows={4}
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="Предоставьте дополнительные детали, если необходимо..."
            sx={{ bgcolor: '#FFFFFF' }}
          />

          <Divider />

          {/* Дата и время */}
          <Typography variant="subtitle1" fontWeight="bold" sx={{ color: '#0B1B2B' }}>
            Желаемая дата и время
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Дата *"
              type="date"
              value={formData.preferredDate}
              onChange={(e) => handleChange('preferredDate', e.target.value)}
              InputProps={{
                startAdornment: <CalendarToday sx={{ mr: 1, color: '#6B7280' }} />,
              }}
              inputProps={{
                min: minDate,
              }}
              sx={{ bgcolor: '#FFFFFF' }}
            />

            <FormControl fullWidth>
              <InputLabel>Время *</InputLabel>
              <Select
                value={formData.preferredTime}
                onChange={(e) => handleChange('preferredTime', e.target.value)}
                label="Время *"
                startAdornment={<AccessTime sx={{ mr: 1, color: '#6B7280' }} />}
                sx={{ bgcolor: '#FFFFFF' }}
              >
                {timeSlots.map((time) => (
                  <MenuItem key={time} value={time}>
                    {time}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            Обратите внимание: дата и время будут зафиксированы только после подтверждения юриста. Вы получите уведомление о статусе вашего запроса.
          </Alert>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          bgcolor: '#FFFFFF',
          borderTop: '1px solid #E6E9EE',
          p: 3,
          gap: 2,
        }}
      >
        <Button
          onClick={onClose}
          variant="outlined"
          sx={{
            borderColor: '#E6E9EE',
            color: '#6B7280',
            '&:hover': {
              borderColor: '#6B7280',
            },
          }}
        >
          Отмена
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <Send />}
          sx={{
            bgcolor: '#2563EB',
            '&:hover': {
              bgcolor: '#1D4ED8',
            },
          }}
        >
          {loading ? 'Отправка...' : 'Отправить запрос'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BookingModal;
