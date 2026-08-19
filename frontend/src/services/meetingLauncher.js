import api from './api';

export const launchConsultation = async (consultation, navigate) => {
  if (consultation.meetingProvider === 'zoom') {
    const popup = window.open('about:blank', '_blank');
    if (!popup) throw Object.assign(new Error('POPUP_BLOCKED'), { code: 'POPUP_BLOCKED' });
    popup.opener = null;
    try {
      const { data } = await api.post(`/zoom/consultations/${consultation.id}/access`);
      popup.location.replace(data.url);
    } catch (error) {
      popup.close();
      throw error;
    }
    return;
  }
  navigate(consultation.type === 'video'
    ? `/consultations/video/${consultation.id}`
    : `/consultations/chat/${consultation.id}`);
};
