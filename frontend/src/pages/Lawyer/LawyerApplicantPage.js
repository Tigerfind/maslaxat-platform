import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import GlassShell from '../../components/GlassKit/GlassShell';
import LinkedInPdfImport from '../../components/Lawyer/LinkedInPdfImport';
import ProfileImportReview from '../../components/Lawyer/ProfileImportReview';
import lawyerService from '../../services/lawyerService';
import api from '../../services/api';

const LawyerApplicantPage = () => {
  const navigate = useNavigate();
  const user = useSelector((state) => state.auth.user);
  const [profile, setProfile] = useState(null);
  const [importRecord, setImportRecord] = useState(null);
  const [importResetEpoch, setImportResetEpoch] = useState(0);

  useEffect(() => {
    api.get('/lawyer/profile').then((response) => setProfile(response.data.profile)).catch(() => {});
  }, []);

  const refreshConflict = async () => {
    const [importResult, profileResult] = await Promise.all([
      lawyerService.imports.get(importRecord.id),
      api.get('/lawyer/profile'),
    ]);
    setProfile(profileResult.data.profile);
    return { import: importResult.import, profile: profileResult.data.profile };
  };

  const refreshConfirmedProfile = async (confirmedProfile) => {
    if (confirmedProfile) setProfile(confirmedProfile);
    else {
      const response = await api.get('/lawyer/profile');
      setProfile(response.data.profile);
    }
    setImportRecord(null);
  };

  return (
    <GlassShell role="lawyer" active="/lawyer/onboarding" title="Кабинет кандидата" subtitle="Подготовьте профиль к проверке">
      <section style={{ maxWidth: 760, padding: 28, border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', background: 'var(--card-glass)', boxShadow: 'var(--card-shadow)' }}>
        <div style={{ color: 'var(--accent)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Статус заявки</div>
        <h1 style={{ margin: '0 0 12px', color: 'var(--text)', fontSize: 28, fontWeight: 400 }}>
          {user?.name ? `${user.name}, профиль еще не допущен к работе` : 'Профиль еще не допущен к работе'}
        </h1>
        <p style={{ color: 'var(--text2)', lineHeight: 1.65, margin: '0 0 24px' }}>
          Заполните профессиональный профиль, включите двухфакторную защиту и отправьте данные на проверку. До одобрения консультации, расписание, аналитика, продвижение и выплаты недоступны.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" onClick={() => navigate('/lawyer/profile/edit')} style={{ minHeight: 44, padding: '10px 18px', border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            Заполнить профиль
          </button>
          <button type="button" onClick={() => navigate('/settings')} style={{ minHeight: 44, padding: '10px 18px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit' }}>
            Настроить 2FA
          </button>
        </div>
        <div style={{ marginTop: 24 }}>
          <LinkedInPdfImport key={importResetEpoch} onImportReady={setImportRecord} onConfirmedRecovery={() => refreshConfirmedProfile()} onManual={() => navigate('/lawyer/profile/edit')} />
        </div>
        {importRecord?.status === 'draft' && profile && <div style={{ marginTop: 20 }}>
          <ProfileImportReview importRecord={importRecord} profile={profile} onConflict={refreshConflict} onConfirmed={(confirmedProfile) => refreshConfirmedProfile(confirmedProfile)} onDiscarded={() => { setImportRecord(null); setImportResetEpoch((value) => value + 1); }} />
        </div>}
      </section>
    </GlassShell>
  );
};

export default LawyerApplicantPage;
