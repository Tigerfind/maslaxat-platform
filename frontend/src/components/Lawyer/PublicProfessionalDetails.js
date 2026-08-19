import React from 'react';
import { publicProvenanceLabel, safeLinkedinProfileUrl } from '../../utils/publicLawyerProfile';
import { useTranslation } from '../../i18n';

const Provenance = ({ value }) => {
  const { t } = useTranslation();
  const label = publicProvenanceLabel(value);
  if (!label) return null;
  return <span style={{ display: 'inline-flex', marginLeft: 8, padding: '3px 8px', borderRadius: 999, background: 'var(--canvas)', color: 'var(--text3)', fontSize: 11 }}>{t(`lawyerProfile.provenance_${label}`)}</span>;
};

const Section = ({ title, source, children }) => <section style={{ marginTop: 22 }}>
  <h3 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{title}<Provenance value={source} /></h3>
  {children}
</section>;

const PublicProfessionalDetails = ({ profile = {} }) => {
  const { t } = useTranslation();
  const linkedinUrl = safeLinkedinProfileUrl(profile.linkedinUrl);
  const work = Array.isArray(profile.workExperience) ? profile.workExperience : [];
  const education = Array.isArray(profile.education) ? profile.education : [];
  const certificates = Array.isArray(profile.certificates) ? profile.certificates : [];
  const provenance = profile.provenance || {};
  if (!profile.headline && !work.length && !education.length && !certificates.length && !linkedinUrl) return null;

  return <div>
    {profile.headline && <Section title={t('lawyerProfile.headline')} source={provenance.headline}><p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text2)' }}>{profile.headline}</p></Section>}
    {work.length > 0 && <Section title={t('lawyerProfile.workExperience')} source={provenance.workExperience}><div style={{ display: 'grid', gap: 10 }}>{work.map((item, index) => <div key={`${item.title}-${index}`} style={{ padding: 14, border: '1px solid var(--card-brd)', borderRadius: 10 }}><strong>{item.title}</strong>{item.company && <div>{item.company}</div>}<div style={{ color: 'var(--text3)', fontSize: 12 }}>{[item.startDate, item.endDate].filter(Boolean).join(' - ')}</div>{item.description && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.description}</p>}</div>)}</div></Section>}
    {education.length > 0 && <Section title={t('lawyerProfile.education')} source={provenance.education}><div style={{ display: 'grid', gap: 8 }}>{education.map((item, index) => <div key={`${item.institution}-${index}`}>{[item.institution, item.degree, item.endDate].filter(Boolean).join(' · ')}</div>)}</div></Section>}
    {certificates.length > 0 && <Section title={t('lawyerProfile.achievements')} source={provenance.certificates}><div style={{ display: 'grid', gap: 8 }}>{certificates.map((item, index) => <div key={`${item.name}-${index}`}>{[item.name, item.issuer, item.issuedAt].filter(Boolean).join(' · ')}</div>)}</div></Section>}
    {linkedinUrl && <a href={linkedinUrl} target="_blank" rel="noopener noreferrer nofollow" style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', marginTop: 20, color: 'var(--accent-dark)' }}>{t('lawyerProfile.linkedin')}</a>}
  </div>;
};

export { Provenance };
export default PublicProfessionalDetails;
