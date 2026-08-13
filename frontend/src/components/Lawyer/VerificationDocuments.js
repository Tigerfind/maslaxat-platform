import React, { useState, useEffect, useRef } from 'react';
import { CircularProgress } from '@mui/material';
import {
  UploadFileOutlined,
  DeleteOutline,
  DescriptionOutlined,
  VerifiedOutlined,
  VisibilityOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import lawyerService from '../../services/lawyerService';
import { useTranslation } from '../../i18n';
import DocumentPreviewDialog from '../UI/DocumentPreviewDialog';

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const cardHeading = {
  fontSize: 14, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text)', marginBottom: 8,
};

const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// initialStatus — verificationStatus профиля из родителя (pending/approved/rejected).
const VerificationDocuments = ({ initialStatus = 'pending' }) => {
  const { t } = useTranslation();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState('diploma');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [checklist, setChecklist] = useState(null); // { complete, missing: [slug] }
  const fileRef = useRef(null);

  // Пункты полноты профиля — порядок и подписи. Слаги совпадают с бэкендом.
  const CHECK_ITEMS = [
    { key: 'photo', label: t('verification.chkPhoto') },
    { key: 'description', label: t('verification.chkDescription') },
    { key: 'specialization', label: t('verification.chkSpecialization') },
    { key: 'price', label: t('verification.chkPrice') },
    { key: 'schedule', label: t('verification.chkSchedule') },
    { key: 'documents', label: t('verification.chkDocuments') },
  ];

  const loadChecklist = async () => {
    try { setChecklist(await lawyerService.verification.getChecklist()); }
    catch { /* оставим как есть */ }
  };

  const previewFetch = React.useCallback(
    async () => lawyerService.verification.getDocumentBlob(previewDoc.id),
    [previewDoc],
  );

  const DOC_TYPES = [
    { key: 'diploma', label: t('verification.typeDiploma') },
    { key: 'license', label: t('verification.typeLicense') },
    { key: 'id', label: t('verification.typeId') },
    { key: 'other', label: t('verification.typeOther') },
  ];
  const typeLabel = (k) => (DOC_TYPES.find((d) => d.key === k) || {}).label || k;

  const load = async () => {
    try {
      const data = await lawyerService.verification.getDocuments();
      setDocs(data.documents || []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); loadChecklist(); }, []);
  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const onPick = () => fileRef.current && fileRef.current.click();

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // позволяет повторно выбрать тот же файл
    if (!file) return;
    setUploading(true);
    try {
      await lawyerService.verification.uploadDocument(file, type);
      toast.success(t('verification.uploaded'));
      await load();
      await loadChecklist();
    } catch (err) {
      toast.error(err.response?.data?.error || t('verification.error'));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t('verification.confirmDelete'))) return;
    try {
      await lawyerService.verification.deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      await loadChecklist();
    } catch {
      toast.error(t('verification.error'));
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await lawyerService.verification.submitForReview();
      setStatus('pending');
      toast.success(t('verification.submitted'));
      await loadChecklist();
    } catch (err) {
      // Бэкенд вернул список незаполненного — обновляем чек-лист и подсказываем.
      if (err.response?.data?.missing) {
        setChecklist({ complete: false, missing: err.response.data.missing });
        toast.error(t('verification.incomplete'));
      } else {
        toast.error(err.response?.data?.error || t('verification.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ ...glassCard, padding: 26 }}>
      <div style={cardHeading}>{t('verification.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 18 }}>
        {t('verification.hint')}
      </div>

      {/* Тип + загрузка */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 18 }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{
            padding: '11px 14px', borderRadius: 12, border: '1px solid var(--card-brd)',
            background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit',
            fontSize: 14, cursor: 'pointer', minWidth: 190,
          }}
        >
          {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <button
          onClick={onPick}
          disabled={uploading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--accent-soft, rgba(184,149,110,0.14))', color: 'var(--accent-dark, #8B7355)',
            border: '1px solid var(--card-brd)', borderRadius: 12, padding: '11px 18px',
            fontSize: 13, fontWeight: 600, cursor: uploading ? 'default' : 'pointer',
            fontFamily: 'inherit', opacity: uploading ? 0.7 : 1,
          }}
        >
          {uploading ? <CircularProgress size={15} /> : <UploadFileOutlined sx={{ fontSize: 18 }} />}
          {t('verification.upload')}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={onFile} style={{ display: 'none' }} />
      </div>

      {/* Список документов */}
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}><CircularProgress size={22} /></div>
      ) : docs.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text3)', padding: '10px 0 4px' }}>{t('verification.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map((d) => (
            <div key={d.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
              borderRadius: 12, border: '1px solid var(--card-brd)', background: 'var(--surface)',
            }}>
              <DescriptionOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{typeLabel(d.type)}{d.size ? ` · ${fmtSize(d.size)}` : ''}</div>
              </div>
              <button onClick={() => setPreviewDoc(d)} title={t('preview.view')} style={{
                width: 34, height: 34, borderRadius: 9, border: '1px solid var(--card-brd)',
                background: 'transparent', color: 'var(--text2)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <VisibilityOutlined sx={{ fontSize: 18 }} />
              </button>
              <button onClick={() => remove(d.id)} title={t('verification.delete')} style={{
                width: 34, height: 34, borderRadius: 9, border: '1px solid var(--card-brd)',
                background: 'transparent', color: 'var(--error, #C0492F)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <DeleteOutline sx={{ fontSize: 18 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Чек-лист полноты профиля — что нужно, чтобы отправить на проверку */}
      {status !== 'approved' && checklist && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--card-brd)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 12, letterSpacing: '0.03em' }}>
            {checklist.complete ? t('verification.chkReady') : t('verification.chkTitle')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CHECK_ITEMS.map((it) => {
              const done = !(checklist.missing || []).includes(it.key);
              return (
                <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: done ? 'var(--text2)' : 'var(--text)' }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: '#fff', background: done ? '#5AA06A' : 'var(--border-strong)',
                  }}>{done ? '✓' : ''}</span>
                  <span style={{ textDecoration: done ? 'none' : 'none', fontWeight: done ? 400 : 600 }}>{it.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Отправить на проверку — если не одобрен; заблокировано пока профиль неполный */}
      {status !== 'approved' && (() => {
        const blocked = checklist ? !checklist.complete : false;
        const disabled = submitting || blocked;
        return (
          <button
            onClick={submit}
            disabled={disabled}
            title={blocked ? t('verification.incomplete') : ''}
            style={{
              marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 9,
              background: blocked ? 'var(--border-strong)' : 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
              color: '#FFFFFF', border: 'none', fontSize: 13, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '13px 26px', borderRadius: 'var(--radius)', fontFamily: 'inherit',
              cursor: disabled ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : <VerifiedOutlined sx={{ fontSize: 18 }} />}
            {t('verification.submit')}
          </button>
        );
      })()}
      {status === 'approved' && (
        <div style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, color: '#5AA06A', fontSize: 13, fontWeight: 600 }}>
          <VerifiedOutlined sx={{ fontSize: 18 }} /> {t('verification.approvedNote')}
        </div>
      )}

      <DocumentPreviewDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        name={previewDoc?.name}
        fetchBlob={previewDoc ? previewFetch : null}
      />
    </div>
  );
};

export default VerificationDocuments;
