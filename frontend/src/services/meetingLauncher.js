import api from './api';

export const launchConsultation = async (consultation, navigate) => {
  const policy = consultation?.policy || consultation?.access;
  const isChat = consultation?.type === 'chat' && consultation?.meetingProvider !== 'zoom';
  if (isChat) {
    navigate(`/consultations/chat/${consultation.id}`);
    return;
  }
  if (policy && (!policy.canJoin || !policy.availableActions?.includes('join'))) {
    const error = new Error('Consultation join is not allowed by server policy');
    error.code = policy?.reason || 'JOIN_NOT_ALLOWED';
    throw error;
  }
  await api.post(`${policy ? '/client' : ''}/consultations/${consultation.id}/join`);
  if (consultation.meetingProvider === 'zoom') {
    navigate(`/consultations/zoom/${consultation.id}`);
    return;
  }
  const usesWebRtc = consultation.meetingProvider === 'webrtc' || ['video', 'phone', 'audio'].includes(consultation.type);
  navigate(usesWebRtc ? `/consultations/video/${consultation.id}` : `/consultations/chat/${consultation.id}`);
};
