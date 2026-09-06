import api from './api';

export const launchConsultation = async (consultation, navigate) => {
  if (consultation.meetingProvider === 'zoom') {
    navigate(`/consultations/zoom/${consultation.id}`);
    return;
  }
  await api.post(`/client/consultations/${consultation.id}/join`);
  navigate(consultation.type === 'video'
    ? `/consultations/video/${consultation.id}`
    : `/consultations/chat/${consultation.id}`);
};
