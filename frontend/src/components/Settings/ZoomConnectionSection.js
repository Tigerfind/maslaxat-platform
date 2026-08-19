import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { VideocamOutlined } from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';

const ZoomConnectionSection = () => {
  const role = useSelector((state) => state.auth.role);
  const [state, setState] = useState({ loading: true, enabled: false, connected: false, connection: null });
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/zoom/status').then(({ data }) => setState({ loading: false, ...data })).catch(() => setState((current) => ({ ...current, loading: false })));
  useEffect(() => { if (role === 'lawyer') load(); }, [role]);
  if (role !== 'lawyer') return null;

  const connect = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/zoom/oauth/authorize');
      window.location.assign(data.authorizationUrl);
    } catch (error) { toast.error(error.response?.data?.error || 'Не удалось подключить Zoom'); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Отключить Zoom? Если есть будущие Zoom-консультации, сначала отмените или перенесите их.')) return;
    setBusy(true);
    try {
      const { data } = await api.delete('/zoom/connection');
      await load();
      toast.info(data.affectedConsultations ? `Переведено консультаций на WebRTC: ${data.affectedConsultations}` : 'Zoom отключён');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось отключить Zoom');
    } finally { setBusy(false); }
  };

  return (
    <section className="glass-card" style={{ padding: 22 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><VideocamOutlined /> Подключение Zoom</h3>
      {state.loading ? <p>Проверяем подключение…</p> : !state.enabled ? <p>Zoom OAuth будет доступен после настройки credentials.</p> : state.connected ? (
        <><p>Подключён{state.connection?.zoomEmail ? `: ${state.connection.zoomEmail}` : ''}</p><button type="button" disabled={busy} onClick={disconnect}>Отключить Zoom</button></>
      ) : <button type="button" disabled={busy} onClick={connect}>Подключить Zoom</button>}
    </section>
  );
};

export default ZoomConnectionSection;
