import React, { useState, useRef } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  CircularProgress,
  Typography,
  Paper,
  Alert,
} from '@mui/material';
import { Mic, Stop, Send } from '@mui/icons-material';
import { keyframes } from '@mui/system';
import { toast } from 'react-toastify';

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
`;

const VoiceRecorder = ({ onSendVoice, onTranscriptChange, disabled }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  const startRecording = async () => {
    try {
      // Check browser support for Speech Recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        toast.error('Ваш браузер не поддерживает распознавание речи. Используйте Chrome или Edge.');
        return;
      }

      // Start audio recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        handleSendVoice(blob);
      };

      mediaRecorder.start();

      // Initialize Speech Recognition
      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU'; // Russian language
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptPart = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcriptPart + ' ';
          } else {
            interimText += transcriptPart;
          }
        }

        if (finalText) {
          setTranscript((prev) => prev + finalText);
          if (onTranscriptChange) {
            onTranscriptChange(transcript + finalText);
          }
        }

        setInterimTranscript(interimText);
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
          toast.warning('Речь не обнаружена. Попробуйте говорить громче.');
        } else if (event.error === 'audio-capture') {
          toast.error('Микрофон не найден.');
        } else if (event.error === 'not-allowed') {
          toast.error('Доступ к микрофону запрещен.');
        }
      };

      recognition.onend = () => {
        // Auto-restart if still recording
        if (isRecording && recognitionRef.current) {
          try {
            recognition.start();
          } catch (error) {
            console.error('Error restarting recognition:', error);
          }
        }
      };

      recognition.start();
      recognitionRef.current = recognition;

      setIsRecording(true);
      setRecordingTime(0);
      setTranscript('');
      setInterimTranscript('');

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast.success('Начинаю слушать...');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      if (error.name === 'NotAllowedError') {
        toast.error('Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
      } else {
        toast.error('Не удалось получить доступ к микрофону');
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);

      // Stop speech recognition
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    }
  };

  const handleSendVoice = async (blob) => {
    setIsProcessing(true);
    try {
      // Convert blob to base64 or FormData for sending to backend
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result;
        // Send both audio and transcript
        onSendVoice(base64Audio, transcript);
        setIsProcessing(false);
        setRecordingTime(0);
        setTranscript('');
        setInterimTranscript('');
        toast.success('Голосовое сообщение отправлено');
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error processing voice:', error);
      setIsProcessing(false);
      toast.error('Ошибка обработки голосового сообщения');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isProcessing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">
          Распознавание...
        </Typography>
      </Box>
    );
  }

  if (isRecording) {
    const displayText = transcript + interimTranscript;

    return (
      <Paper
        elevation={3}
        sx={{
          p: 2,
          bgcolor: '#f3e5f5',
          border: '2px solid #9c27b0',
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: displayText ? 2 : 0 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: '#d32f2f',
              animation: `${pulse} 1s ease-in-out infinite`,
            }}
          />
          <Typography variant="body1" fontWeight="bold" sx={{ color: '#9c27b0' }}>
            Слушаю... {formatTime(recordingTime)}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title="Остановить и отправить">
            <IconButton
              onClick={stopRecording}
              sx={{
                bgcolor: '#9c27b0',
                color: 'white',
                '&:hover': { bgcolor: '#7b1fa2' }
              }}
            >
              <Stop />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Live Transcript Display */}
        {displayText && (
          <Box
            sx={{
              p: 2,
              bgcolor: 'white',
              borderRadius: 1,
              border: '1px solid #e0e0e0',
              minHeight: 60,
              maxHeight: 150,
              overflowY: 'auto',
            }}
          >
            <Typography variant="body2" sx={{ color: '#424242' }}>
              <strong>Распознанный текст:</strong>
            </Typography>
            <Typography variant="body1" sx={{ mt: 1, color: '#000' }}>
              {transcript}
              <span style={{ color: '#9e9e9e', fontStyle: 'italic' }}>{interimTranscript}</span>
            </Typography>
          </Box>
        )}

        {/* No speech detected warning */}
        {!displayText && recordingTime > 3 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Говорите в микрофон. Убедитесь, что он не выключен.
          </Alert>
        )}
      </Paper>
    );
  }

  return (
    <Tooltip title="Записать голосовое сообщение">
      <IconButton
        onClick={startRecording}
        disabled={disabled}
        color="secondary"
        sx={{
          '&:hover': {
            transform: 'scale(1.1)',
            transition: 'transform 0.2s',
          },
        }}
      >
        <Mic />
      </IconButton>
    </Tooltip>
  );
};

export default VoiceRecorder;
