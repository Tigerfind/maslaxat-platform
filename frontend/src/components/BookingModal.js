import React, { useState, useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Dialog } from '@mui/material';
import { CalendarTodayOutlined, MailOutline, CardGiftcardOutlined } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import clientService from '../services/clientService';
import api from '../services/api';
import ConflictDetector from '../shared/validators/conflict-detector';
import { useTranslation } from '../i18n';

/**
 * MaslaXat Booking Modal — 4-step consultation booking flow.
 * Re-skinned 1:1 to ClaudeDesign mockup 15_BOOKING_MODAL.html (+ success
 * animation from 16_ACHIEVEMENT_MODAL / glass.css checkPop/checkDraw).
 * Data-wiring preserved: clientService.lawyers.bookConsultation + ConflictDetector.
 */

const DURATIONS = [30, 60, 90];

const TIME_SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // JS getDay() → ключ расписания

const STEPS = [1, 2, 3];

const emptyForm = {
  // Мультизапрос: список проблем; у КАЖДОЙ несколько категорий права ({ text, categories: [] }).
  problems: [{ text: '', categories: [] }],
  description: '',
  preferredDate: '',
  preferredTime: '',
  consultationType: 'video',
};

const BookingModal = ({ open, onClose, lawyer }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { specializations } = useSelector((state) => state.specializations);
  const activeSpecs = useMemo(() => specializations.filter((s) => s.active), [specializations]);

  // Умный подбор: области права юриста (имена-строки) → id категорий брони.
  // Совпадение по имени (specializations хранит имена, категории брони — по id).
  const lawyerSpecNames = useMemo(() => {
    if (Array.isArray(lawyer?.specializations) && lawyer.specializations.length) return lawyer.specializations;
    const single = lawyer?.profile?.specialization;
    return single ? [single] : [];
  }, [lawyer]);
  const lawyerCatIds = useMemo(() => {
    const names = new Set(lawyerSpecNames);
    return activeSpecs.filter((s) => names.has(s.name)).map((s) => s.id);
  }, [activeSpecs, lawyerSpecNames]);
  const lawyerCatSet = useMemo(() => new Set(lawyerCatIds), [lawyerCatIds]);
  // Юрист «ведёт» эту категорию?
  const covers = (cid) => lawyerCatSet.has(cid);
  const MONTHS = t('booking.months');
  const DOWS = t('booking.dows');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState(emptyForm);
  const [openCat, setOpenCat] = useState(-1); // индекс проблемы с открытым списком категорий (-1 — закрыто)
  const [duration, setDuration] = useState(60);
  const [dateLabel, setDateLabel] = useState('');
  const [promo, setPromo] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoBad, setPromoBad] = useState(false);
  const [promoPercent, setPromoPercent] = useState(0);
  const [promoMsg, setPromoMsg] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [notify, setNotify] = useState(true);
  const [payMethod, setPayMethod] = useState('payme');
  const [schedule, setSchedule] = useState(null); // недельные часы приёма юриста
  const [loyalty, setLoyalty] = useState(null);
  const [useFree, setUseFree] = useState(false);
  const [subLeft, setSubLeft] = useState(0);
  const [useSubFree, setUseSubFree] = useState(false);
  const [paymentConsent, setPaymentConsent] = useState(false);

  // При открытии: сначала акция «первая бесплатно» (приоритетнее), затем —
  // бесплатная консультация, включённая в подписку (если лоялти недоступна).
  useEffect(() => {
    if (!open) return;
    setUseFree(false);
    setPaymentConsent(false);
    setUseSubFree(false);
    setSubLeft(0);
    // Память брони: подставляем последний выбор клиента (тип/длительность/оплата),
    // чтобы постоянному клиенту не переклиивать одно и то же.
    try {
      const prefs = JSON.parse(localStorage.getItem('booking:prefs') || '{}');
      if (prefs.consultationType) setFormData((prev) => ({ ...prev, consultationType: prefs.consultationType }));
      if (DURATIONS.includes(prefs.duration)) setDuration(prefs.duration);
      if (prefs.payMethod) setPayMethod(prefs.payMethod);
    } catch { /* нет сохранённых предпочтений */ }
    let alive = true;
    (async () => {
      let freeNow = false;
      try {
        const l = await api.get('/client/consultations/loyalty');
        if (!alive) return;
        setLoyalty(l.data);
        freeNow = !!l.data?.freeNow;
      } catch { if (alive) setLoyalty(null); }
      if (freeNow) { if (alive) setUseFree(true); return; }
      try {
        const s = await api.get('/subscriptions/my');
        if (!alive) return;
        const left = s.data?.consultationsLeft || 0;
        setSubLeft(left);
        if (left > 0) setUseSubFree(true);
      } catch { /* нет подписки */ }
    })();
    return () => { alive = false; };
  }, [open]);

  // Каталог может передать карточку без расписания, поэтому при смене юриста
  // обновляем prop сразу и затем запрашиваем полный публичный профиль.
  useEffect(() => {
    if (!open || !lawyer?.id) return undefined;
    let alive = true;
    setSchedule(lawyer.profile?.schedule || null);
    api.get(`/lawyers/${lawyer.id}`)
      .then((r) => { if (alive) setSchedule(r.data?.lawyer?.profile?.schedule || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, lawyer?.id, lawyer?.profile?.schedule]);

  // Префилл первой проблемы обновляется, когда догрузился справочник категорий.
  useEffect(() => {
    if (!open || !lawyerCatIds.length) return;
    setFormData((prev) => (prev.problems[0]?.categories?.length ? prev : {
      ...prev,
      problems: prev.problems.map((p, i) => (i === 0 ? { ...p, categories: [...lawyerCatIds] } : p)),
    }));
  }, [open, lawyerCatIds]);

  // Закрывать выпадающий список категорий по клику вне него
  useEffect(() => {
    if (openCat < 0) return undefined;
    const onDown = (e) => { if (!e.target.closest('.cat-dd')) setOpenCat(-1); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openCat]);

  const hasSchedule = schedule && typeof schedule === 'object'
    && Object.values(schedule).some((d) => d && d.enabled);

  const dates = useMemo(() => {
    const arr = [];
    const scan = hasSchedule ? 21 : 5; // ищем открытые дни среди ближайших
    const want = hasSchedule ? 8 : 5;
    for (let i = 1; i <= scan && arr.length < want; i += 1) {
      const dt = new Date();
      dt.setDate(dt.getDate() + i);
      if (hasSchedule) {
        const day = schedule[DAY_KEYS[dt.getDay()]];
        if (!day || !day.enabled) continue; // закрытые дни не показываем
      }
      arr.push({
        iso: dt.toISOString().split('T')[0],
        dow: DOWS[dt.getDay()],
        d: dt.getDate(),
        label: `${dt.getDate()} ${MONTHS[dt.getMonth()]}`,
      });
    }
    return arr;
  }, [t, schedule, hasSchedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Слоты выбранного дня: почасовые старты внутри [from, to) расписания юриста.
  // Без расписания — прежний фиксированный список (фолбэк, не блокируем бронь).
  const timeSlots = useMemo(() => {
    if (!hasSchedule) return TIME_SLOTS;
    if (!formData.preferredDate) return [];
    const day = schedule[DAY_KEYS[new Date(`${formData.preferredDate}T00:00:00`).getDay()]];
    if (!day || !day.enabled) return [];
    const fromH = parseInt(String(day.from).split(':')[0], 10);
    const toH = parseInt(String(day.to).split(':')[0], 10);
    const out = [];
    for (let h = fromH; h < toH; h += 1) out.push(`${String(h).padStart(2, '0')}:00`);
    return out;
  }, [hasSchedule, schedule, formData.preferredDate]);

  // Если выбранное время выпало из доступных слотов (сменился день/юрист) — сбрасываем.
  useEffect(() => {
    if (formData.preferredTime && !timeSlots.includes(formData.preferredTime)) {
      setFormData((p) => ({ ...p, preferredTime: '' }));
    }
  }, [timeSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lawyer) return null;

  // ---- Расчёт цены (акция/промо; total уходит в оплату) ----
  const basePrice = lawyer.priceFrom || lawyer.price || lawyer.profile?.price || 0;
  const subtotal = Math.round((basePrice * duration) / 60);
  const discount = promoApplied && promoPercent ? Math.round((subtotal * promoPercent) / 100) : 0;
  const freeBooking = useFree || useSubFree; // бесплатно (акция ИЛИ подписка)
  const total = freeBooking ? 0 : Math.max(0, subtotal - discount);
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  const profName = lawyer.name || '';
  const profInitials = profName
    .split(' ')
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const profRating = lawyer.rating || lawyer.profile?.rating || '5.0';
  const durLabel = `${duration} ${t('booking.min')}`;

  const handleChange = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const resetAll = () => {
    setStep(1);
    setFormData(emptyForm);
    setDuration(60);
    setDateLabel('');
    setPromo('');
    setPromoApplied(false);
    setPromoBad(false);
    setPromoPercent(0);
    setPromoMsg('');
    setNotify(true);
    setPayMethod('payme');
    setUseFree(false);
    setLoading(false);
  };

  const handleClose = () => {
    onClose();
    // defer reset so it doesn't flash the first step during close animation
    setTimeout(resetAll, 250);
  };

  const applyPromo = async () => {
    const code = promo.trim();
    if (!code || promoLoading) return;
    setPromoLoading(true);
    try {
      const res = await clientService.promo.validate(code, subtotal);
      if (res.valid) {
        setPromoApplied(true);
        setPromoBad(false);
        setPromoPercent(res.discountPercent || 0);
        setPromoMsg('');
      } else {
        setPromoApplied(false);
        setPromoBad(true);
        setPromoPercent(0);
        // Переводим причину по коду reason; fallback — сообщение с сервера
        setPromoMsg(res.reason ? t('booking.promo_' + res.reason) : (res.message || ''));
      }
    } finally {
      setPromoLoading(false);
    }
  };

  // ---- Мультизапрос: у каждой проблемы свой текст и НЕСКОЛЬКО категорий ----
  const setProblemText = (i, val) => setFormData((prev) => ({ ...prev, problems: prev.problems.map((p, idx) => (idx === i ? { ...p, text: val } : p)) }));
  const toggleProblemCategory = (i, catId) => setFormData((prev) => ({
    ...prev,
    problems: prev.problems.map((p, idx) => {
      if (idx !== i) return p;
      const has = p.categories.includes(catId);
      return { ...p, categories: has ? p.categories.filter((c) => c !== catId) : [...p.categories, catId] };
    }),
  }));
  const addProblem = () => { setOpenCat(-1); setFormData((prev) => (prev.problems.length >= 10 ? prev : { ...prev, problems: [...prev.problems, { text: '', categories: [] }] })); };
  const removeProblem = (i) => { setOpenCat(-1); setFormData((prev) => ({ ...prev, problems: prev.problems.length > 1 ? prev.problems.filter((_, idx) => idx !== i) : prev.problems })); };

  const goNext = () => {
    if (step === 1) {
      const filled = formData.problems.filter((p) => p.text.trim());
      if (filled.length === 0) {
        toast.error(t('booking.toastQuestion'));
        return;
      }
      if (filled.some((p) => !p.categories.length)) {
        toast.error(t('booking.toastCategory'));
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!formData.preferredDate || !formData.preferredTime) {
        toast.error(t('booking.toastDateTime'));
        return;
      }
      setStep(3);
    }
  };

  const goBack = () => {
    if (step === 1) {
      handleClose();
    } else {
      setStep((s) => s - 1);
    }
  };

  // ---- Бронирование по кнопке «Оплатить»: dev — имитация, прод — Payme-редирект ----
  const handlePayNow = async () => {
    if (!paymentConsent) {
      toast.error(t('booking.consentRequired'));
      return;
    }
    try {
      setLoading(true);

      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

      const bookingData = {
        ...formData,
        // Только непустые проблемы, каждая с текстом и списком категорий.
        problems: formData.problems
          .filter((p) => p.text.trim())
          .map((p) => ({ text: p.text.trim(), categories: p.categories })),
        // captured UI choices (cosmetic until backend consumes them)
        duration,
        amount: total,
        paymentMethod: payMethod,
        notify,
        useFreePromo: useFree,
        useSubscriptionFree: useSubFree,
        promoCode: promoApplied && !freeBooking ? promo.trim().toUpperCase() : undefined,
        lawyerId: lawyer.id,
        lawyerName: lawyer.name,
        acceptedTerms: true,
        legalVersion: '2026-08-13',
        client: {
          id: currentUser.id,
          name: currentUser.name,
          avatar: null,
        },
        status: 'pending',
      };

      // Реальные консультации клиента (раньше читался несуществующий localStorage-ключ →
      // проверка конфликтов была фиктивной). Берём активные/предстоящие с сервера.
      let existingConsultations = [];
      try {
        const all = await clientService.consultations.getConsultations('all');
        existingConsultations = (Array.isArray(all) ? all : []).filter((c) =>
          ['payment_pending', 'pending', 'accepted', 'in_progress'].includes(c.status)
        );
      } catch (e) {
        existingConsultations = [];
      }

      const validation = ConflictDetector.validateConsultationBooking(bookingData, {
        existingConsultations,
        minHoursAhead: 2,
        maxConsultationsPerDay: 10,
      });

      ConflictDetector.logConflicts(validation);

      // Переводим конфликт по его типу (раньше сообщения были захардкожены по-русски)
      const conflictText = (c) => t('booking.conflict_' + c.type, { hours: c.details?.minimumAdvance ?? 2 });

      if (!validation.isValid) {
        const crit = validation.criticalConflicts[0];
        toast.error(crit ? conflictText(crit) : t('booking.toastConflict'));
        setLoading(false);
        return;
      }

      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) => {
          toast.warning(conflictText(warning), { autoClose: 5000 });
        });
      }

      const booking = await clientService.lawyers.bookConsultation(lawyer.id, bookingData);

      // Модель B «оплата через 5 минут звонка»: предоплаты при брони НЕТ
      // (requiresPayment=false). Деньги спишутся на 5-й минуте разговора.
      // Блок ниже оставлен для обратной совместимости, если сервер вернёт requiresPayment.
      const consultationId = booking?.consultation?.id;
      if (!freeBooking && booking?.requiresPayment && consultationId) {
        try {
          // dev/test-режим: имитация оплаты
          await clientService.lawyers.simulatePayment(consultationId);
        } catch (payErr) {
          // прод (заданы ключи Payme): тест-оплата отключена (403) → реальный Payme-редирект
          if (payErr.response?.status === 403) {
            const { checkoutUrl } = await clientService.lawyers.createPayment(consultationId);
            if (checkoutUrl) {
              window.location.href = checkoutUrl;
              return;
            }
          }
          throw payErr;
        }
      }

      // Запоминаем выбор для следующей брони (тип/длительность/оплата).
      try { localStorage.setItem('booking:prefs', JSON.stringify({ consultationType: formData.consultationType, duration, payMethod })); } catch { /* ignore */ }

      setStep(4);
    } catch (error) {
      // Гейт верификации: нужен подтверждённый контакт — ведём в профиль подтвердить.
      if (error.response?.data?.code === 'CONTACT_UNVERIFIED') {
        toast.info(t('booking.verifyContact'), { autoClose: 6000 });
        onClose?.();
        navigate('/profile');
        return;
      }
      toast.error(error.response?.data?.error || t('booking.toastError'));
    } finally {
      setLoading(false);
    }
  };

  // Реальный .ics: генерируем событие и скачиваем файл (раньше был фейковый тост).
  const addToCalendar = () => {
    const date = formData.preferredDate; // YYYY-MM-DD
    const time = formData.preferredTime; // HH:mm
    if (!date || !time) { toast.info(t('booking.toastCalendar')); return; }
    const [y, mo, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const start = new Date(y, mo - 1, d, hh, mm);
    const end = new Date(start.getTime() + duration * 60000);
    const pad = (n) => String(n).padStart(2, '0');
    // Плавающее локальное время (без TZID) — показывается в местном времени пользователя.
    const fmt = (dt) => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
    const esc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MaslaXat//RU', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:maslaxat-${start.getTime()}@maslaxat.uz`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(`${t('booking.calTitle')} — ${profName}`)}`,
      `DESCRIPTION:${esc(t('booking.calDesc'))}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'maslaxat-consultation.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('booking.toastCalendar'));
  };

  const bookDone = () => {
    handleClose();
    navigate('/consultations');
  };

  // ---- Shared style recipes ----
  const label = {
    fontSize: 12,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    marginBottom: 10,
  };

  const pill = (active) => ({
    flex: 1,
    textAlign: 'center',
    padding: '11px 0',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.15s ease',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(184,149,110,0.12)' : 'var(--surface)',
    color: active ? 'var(--accent-dark)' : 'var(--text2)',
    fontWeight: active ? 600 : 400,
  });

  const datePill = (active) => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 0',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.15s ease',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(184,149,110,0.12)' : 'var(--surface)',
  });

  const timePill = (active) => ({
    textAlign: 'center',
    padding: '11px 0',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.15s ease',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(184,149,110,0.12)' : 'var(--surface)',
    color: active ? 'var(--accent-dark)' : 'var(--text)',
    fontWeight: active ? 600 : 400,
  });

  const inputBase = {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '13px 15px',
    fontSize: 14,
    color: 'var(--text)',
    background: 'var(--surface)',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const insetPanel = {
    background: 'var(--canvas)',
    borderRadius: 'var(--radius)',
    padding: '16px 18px',
    marginBottom: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    color: 'var(--text2)',
  };
  const rowVal = { color: 'var(--text)', fontWeight: 500 };

  const secondaryBtn = {
    flexShrink: 0,
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text2)',
    fontSize: 13,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '15px 20px',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  const primaryBtn = {
    flex: 1,
    background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
    color: '#FFFFFF',
    border: 'none',
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    padding: 15,
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    opacity: loading ? 0.6 : 1,
  };

  // Реально подключён только Payme. Click/Uzcard оставлены в массиве на будущее
  // (soon:true), но НЕ показываются — чтобы не висели мёртвые плитки «скоро».
  // Когда подключим — просто убрать soon:true.
  const payMethods = [
    { id: 'payme', n: 'Payme', d: t('booking.paymeD') },
    { id: 'click', n: 'Click', d: t('booking.clickD'), soon: true },
    { id: 'uzcard', n: t('booking.cardN'), d: t('booking.cardD'), soon: true },
  ].filter((m) => !m.soon);

  const notDone = step <= 3;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      slotProps={{
        backdrop: {
          sx: { background: 'rgba(26,26,26,0.55)', animation: 'modalFade 0.22s ease' },
        },
      }}
      PaperProps={{
        sx: {
          width: 480,
          maxWidth: '100%',
          m: 2,
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 24px 56px rgba(26,26,26,0.24)',
          animation: 'modalPop 0.32s cubic-bezier(.34,1.56,.64,1)',
        },
      }}
    >
      {/* ---------- Header + step indicator ---------- */}
      <div style={{ padding: '22px 28px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 400,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--text)',
            }}
          >
            {t('booking.title')}
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text3)',
              fontSize: 22,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {STEPS.map((n, idx) => {
            const activeStep = Math.min(step, 4);
            const doneOrActive = n <= activeStep;
            return (
              <React.Fragment key={n}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 500,
                    background: doneOrActive ? 'var(--accent)' : 'var(--canvas)',
                    color: doneOrActive ? '#FFFFFF' : 'var(--text3)',
                    border: doneOrActive ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {n}
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      margin: '0 6px',
                      background: n < activeStep ? 'var(--accent)' : 'var(--border)',
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ---------- Body ---------- */}
      <div style={{ padding: '24px 28px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Lawyer summary */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 18,
            borderBottom: '1px solid var(--canvas)',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {profInitials}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{profName}</div>
            <div style={{ fontSize: 13, color: 'var(--accent)' }}>
              ★ {profRating} · {fmt(basePrice)} {t('booking.sum')}
            </div>
          </div>
        </div>

        {/* STEP 1: type + duration + question */}
        {step === 1 && (
          <>
            <div style={label}>{t('booking.typeLabel')}</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <div
                onClick={() => handleChange('consultationType', 'video')}
                style={pill(formData.consultationType === 'video')}
              >
                {t('booking.video')}
              </div>
              <div
                onClick={() => handleChange('consultationType', 'chat')}
                style={pill(formData.consultationType === 'chat')}
              >
                {t('booking.chat')}
              </div>
            </div>

            <div style={label}>{t('booking.duration')}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {DURATIONS.map((d) => (
                <div key={d} onClick={() => setDuration(d)} style={pill(duration === d)}>
                  {d} {t('booking.min')}
                </div>
              ))}
            </div>

            {/* Умный подбор: области, в которых этот юрист работает */}
            {lawyerCatIds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: 'rgba(184,149,110,0.10)', border: '1px solid rgba(184,149,110,0.24)' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('booking.lawyerHandles')}</span>
                {lawyerCatIds.map((cid) => {
                  const nm = activeSpecs.find((s) => s.id === cid)?.name || cid;
                  return <span key={cid} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-dark)', background: 'rgba(184,149,110,0.16)', padding: '3px 9px', borderRadius: 999 }}>{nm}</span>;
                })}
              </div>
            )}

            <div style={label}>{t('booking.problems')} <span style={{ color: 'var(--accent-dark)' }}>*</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
              {formData.problems.map((p, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', letterSpacing: '0.03em' }}>{t('booking.categoriesHint')}</div>
                    {formData.problems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProblem(i)}
                        aria-label="remove"
                        style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text3)', cursor: 'pointer', fontSize: 17, fontFamily: 'inherit', lineHeight: 1 }}
                      >×</button>
                    )}
                  </div>
                  <div className="cat-dd" style={{ position: 'relative', marginBottom: 10 }}>
                    <div
                      onClick={() => setOpenCat(openCat === i ? -1 : i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 44, padding: '8px 12px', borderRadius: 11, border: `1px solid ${openCat === i ? 'var(--accent)' : 'var(--border-strong)'}`, background: 'var(--surface)', cursor: 'pointer' }}
                    >
                      {p.categories.length === 0 && <span style={{ color: 'var(--text3)', fontSize: 13.5 }}>{t('booking.categoriesSelect')}</span>}
                      {p.categories.map((cid) => {
                        const nm = activeSpecs.find((s) => s.id === cid)?.name || cid;
                        return (
                          <span key={cid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,var(--accent),var(--accent-dark))', color: '#FFFFFF', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999 }}>
                            {nm}
                            <span onClick={(e) => { e.stopPropagation(); toggleProblemCategory(i, cid); }} style={{ cursor: 'pointer', opacity: 0.85, fontSize: 13, lineHeight: 1 }}>×</span>
                          </span>
                        );
                      })}
                      <span style={{ marginLeft: 'auto', color: 'var(--accent)', alignSelf: 'center', transform: openCat === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
                    </div>
                    {openCat === i && (
                      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 6, position: 'absolute', left: 0, right: 0, zIndex: 5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 16px 42px rgba(80,60,40,0.16)', maxHeight: 260, overflow: 'auto' }}>
                        {[...activeSpecs].sort((a, b) => (covers(b.id) ? 1 : 0) - (covers(a.id) ? 1 : 0)).map((sp) => {
                          const on = p.categories.includes(sp.id);
                          const mine = covers(sp.id); // юрист ведёт эту область
                          return (
                            <li
                              key={sp.id}
                              onClick={() => toggleProblemCategory(i, sp.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, color: on ? 'var(--text)' : 'var(--text2)', fontWeight: on ? 600 : 400, background: mine && !on ? 'rgba(184,149,110,0.07)' : 'transparent' }}
                            >
                              <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#FFFFFF', border: on ? '1px solid transparent' : '1px solid var(--border-strong)', background: on ? 'linear-gradient(135deg,var(--accent),var(--accent-dark))' : 'transparent' }}>{on ? '✓' : ''}</span>
                              <span style={{ flex: 1 }}>{sp.name}</span>
                              {mine && <span title={t('booking.lawyerHandles')} style={{ fontSize: 11, color: 'var(--accent-dark)', fontWeight: 600 }}>★</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <textarea
                    value={p.text}
                    onChange={(e) => setProblemText(i, e.target.value)}
                    placeholder={`${t('booking.problemN')} ${i + 1}`}
                    style={{ ...inputBase, minHeight: 60, resize: 'none', width: '100%', marginBottom: 0 }}
                  />
                </div>
              ))}
            </div>
            {/* Мягкое предупреждение: выбрана область, которую юрист не ведёт */}
            {lawyerCatIds.length > 0 && formData.problems.some((p) => p.categories.some((cid) => !covers(cid))) && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, padding: '10px 12px', borderRadius: 11, background: 'rgba(196,163,90,0.12)', border: '1px solid rgba(196,163,90,0.3)' }}>
                <span style={{ fontSize: 15, lineHeight: 1.3 }}>⚠️</span>
                <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.45 }}>{t('booking.categoryMismatch')}</span>
              </div>
            )}
            {formData.problems.length < 10 && (
              <button
                type="button"
                onClick={addProblem}
                style={{ background: 'transparent', border: '1px dashed var(--border-strong)', color: 'var(--accent-dark)', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 22 }}
              >
                + {t('booking.addProblem')}
              </button>
            )}
          </>
        )}

        {/* STEP 2: date + time */}
        {step === 2 && (
          <>
            <div style={label}>{t('booking.date')}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {dates.map((d) => {
                const active = formData.preferredDate === d.iso;
                return (
                  <div
                    key={d.iso}
                    onClick={() => {
                      handleChange('preferredDate', d.iso);
                      setDateLabel(d.label);
                    }}
                    style={datePill(active)}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d.dow}</div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 500,
                        color: active ? 'var(--accent-dark)' : 'var(--text)',
                        marginTop: 2,
                      }}
                    >
                      {d.d}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={label}>{t('booking.time')}</div>
            {timeSlots.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '10px 0 22px' }}>
                {formData.preferredDate ? t('booking.noSlots') : t('booking.pickDateFirst')}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  marginBottom: 22,
                }}
              >
                {timeSlots.map((slot) => (
                  <div
                    key={slot}
                    onClick={() => handleChange('preferredTime', slot)}
                    style={timePill(formData.preferredTime === slot)}
                  >
                    {slot}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* STEP 3: оплата — dev: имитация; прод (ключи Payme): редирект на checkout */}
        {step === 3 && (
          <>
            <div style={insetPanel}>
              <div style={rowStyle}>
                <span>{t('booking.dateTime')}</span>
                <span style={rowVal}>
                  {dateLabel}, {formData.preferredTime}
                </span>
              </div>
              <div style={rowStyle}>
                <span>{t('booking.duration')}</span>
                <span style={rowVal}>{durLabel}</span>
              </div>
              <div style={rowStyle}>
                <span>{t('booking.cost')}</span>
                <span style={rowVal}>
                  {freeBooking ? (
                    <>
                      <span style={{ textDecoration: 'line-through', color: 'var(--text3)', marginRight: 8 }}>
                        {fmt(subtotal)} {t('booking.sum')}
                      </span>
                      <span style={{ color: 'var(--accent-dark)', fontWeight: 600 }}>{t('booking.free')}</span>
                    </>
                  ) : (
                    `${fmt(subtotal)} ${t('booking.sum')}`
                  )}
                </span>
              </div>
              {promoApplied && !freeBooking && (
                <div style={{ ...rowStyle, color: '#1F8A5B' }}>
                  <span>{t('booking.promo')} {promo.trim().toUpperCase()} (−{promoPercent}%)</span>
                  <span style={{ fontWeight: 500 }}>−{fmt(discount)} {t('booking.sum')}</span>
                </div>
              )}
              {(promoApplied || freeBooking) && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 14,
                    color: 'var(--text)',
                    paddingTop: 8,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{t('booking.total')}</span>
                  <span style={{ fontWeight: 600, color: freeBooking ? 'var(--accent-dark)' : undefined }}>
                    {freeBooking ? t('booking.freeTotal') : `${fmt(total)} ${t('booking.sum')}`}
                  </span>
                </div>
              )}
            </div>

            {/* ---------- Акция «первая консультация бесплатно» ---------- */}
            {loyalty && loyalty.freeNow && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'linear-gradient(135deg, rgba(184,149,110,0.12), rgba(184,149,110,0.04))',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
                padding: '12px 14px', marginBottom: 16,
              }}>
                <div style={{
                  width: 34, height: 34, flexShrink: 0, borderRadius: '50%',
                  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CardGiftcardOutlined sx={{ fontSize: 18, color: 'var(--accent-dark)' }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-dark)' }}>
                    {t('booking.firstFree')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {t('booking.firstFreeSub')}
                  </div>
                </div>
              </div>
            )}

            {/* ---------- Бесплатно по подписке (Basic/Pro) ---------- */}
            {useSubFree && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'linear-gradient(135deg, rgba(184,149,110,0.12), rgba(184,149,110,0.04))',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
                padding: '12px 14px', marginBottom: 16,
              }}>
                <div style={{
                  width: 34, height: 34, flexShrink: 0, borderRadius: '50%',
                  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CardGiftcardOutlined sx={{ fontSize: 18, color: 'var(--accent-dark)' }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-dark)' }}>
                    {t('booking.subFree')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {t('booking.subFreeSub').replace('{n}', subLeft)}
                  </div>
                </div>
              </div>
            )}

            <div style={label}>{t('booking.promo')}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
                placeholder={t('booking.promoPlaceholder')}
                style={{ ...inputBase, flex: 1, padding: '12px 14px', textTransform: 'uppercase' }}
              />
              <button
                onClick={applyPromo}
                disabled={promoLoading}
                style={{
                  flexShrink: 0,
                  background: 'var(--canvas)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  fontSize: 13,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  padding: '0 18px',
                  borderRadius: 'var(--radius)',
                  cursor: promoLoading ? 'default' : 'pointer',
                  opacity: promoLoading ? 0.6 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {promoLoading ? t('booking.checking') : t('booking.apply')}
              </button>
            </div>
            {promoApplied && (
              <div style={{ fontSize: 12, color: '#1F8A5B', marginBottom: 18 }}>
                {t('booking.promoOk')} −{promoPercent}%
              </div>
            )}
            {promoBad && (
              <div style={{ fontSize: 12, color: '#C0492F', marginBottom: 18 }}>
                {promoMsg || t('booking.promoBad')}
              </div>
            )}

            <div
              onClick={() => setNotify((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                marginBottom: 22,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                  {t('booking.notifyTitle')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('booking.notifySub')}</div>
              </div>
              <div
                style={{
                  width: 42,
                  height: 24,
                  borderRadius: 12,
                  flexShrink: 0,
                  background: notify ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 0.2s ease',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: notify ? 21 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </div>
            </div>

            {!freeBooking && (
            <>
            <div style={label}>{t('booking.payMethod')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
              {payMethods.map((m) => {
                const active = payMethod === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => { if (!m.soon) setPayMethod(m.id); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 15px',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'rgba(184,149,110,0.08)' : 'var(--surface)',
                      borderRadius: 'var(--radius)',
                      cursor: m.soon ? 'default' : 'pointer',
                      opacity: m.soon ? 0.5 : 1,
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        borderRadius: '50%',
                        border: `2px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                        boxShadow: active ? 'inset 0 0 0 3px var(--accent)' : 'none',
                        background: active ? '#FFFFFF' : 'transparent',
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{m.n}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{m.d}</div>
                    </div>
                    {m.soon && (
                      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 9px', flexShrink: 0 }}>
                        {t('booking.soon')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            </>
            )}
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: '4px 0 18px', color: 'var(--text2)', fontSize: 12.5, lineHeight: 1.5 }}>
              <input type="checkbox" checked={paymentConsent} onChange={(e) => setPaymentConsent(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
              <span>
                {t('booking.consentPrefix')}{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-dark)' }}>{t('booking.terms')}</a>,{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-dark)' }}>{t('booking.privacy')}</a>{' '}
                {t('booking.and')}{' '}
                <a href="/refund-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-dark)' }}>{t('booking.refundPolicy')}</a>.
              </span>
            </label>
          </>
        )}

        {/* STEP 4: confirmation */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(31,138,91,0.16), rgba(31,138,91,0.06))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                animation: 'checkPop 0.42s cubic-bezier(.34,1.56,.64,1)',
              }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#1F8A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" style={{ strokeDasharray: 32, animation: 'checkDraw 0.5s ease 0.2s both' }} />
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
              {t('booking.booked')}
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)', marginBottom: 22 }}>
              {t('booking.bookedText', { name: profName })}
            </p>
            <div style={{ ...insetPanel, textAlign: 'left', marginBottom: 24, gap: 10 }}>
              <div style={rowStyle}>
                <span>{t('booking.lawyer')}</span>
                <span style={rowVal}>{profName}</span>
              </div>
              <div style={rowStyle}>
                <span>{t('booking.dateTime')}</span>
                <span style={rowVal}>
                  {dateLabel}, {formData.preferredTime}
                </span>
              </div>
              <div style={rowStyle}>
                <span>{t('booking.duration')}</span>
                <span style={rowVal}>{durLabel}</span>
              </div>
              <div style={rowStyle}>
                <span>{t('booking.paid')}</span>
                <span style={rowVal}>{fmt(total)} {t('booking.sum')}</span>
              </div>
            </div>
            {notify && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  justifyContent: 'center',
                  marginBottom: 18,
                  fontSize: 13,
                  color: 'var(--text2)',
                }}
              >
                <MailOutline sx={{ fontSize: 15, color: '#1F8A5B' }} />
                {t('booking.confirmSent')}
              </div>
            )}
            <button
              onClick={addToCalendar}
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: 13,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                padding: 14,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <CalendarTodayOutlined sx={{ fontSize: 16 }} />
              {t('booking.addCalendar')}
            </button>
            <button
              onClick={bookDone}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                padding: 15,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('booking.myConsultations')}
            </button>
          </div>
        )}

        {/* ---------- Footer nav (steps 1-3) ---------- */}
        {notDone && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={goBack} style={secondaryBtn}>
              {t('booking.back')}
            </button>
            {step === 3 ? (
              <button onClick={handlePayNow} disabled={loading || !paymentConsent} style={{ ...primaryBtn, opacity: paymentConsent ? 1 : 0.55 }}>
                {loading ? t('booking.paying') : (freeBooking ? t('booking.bookFree') : `${t('booking.pay')} · ${fmt(total)} ${t('booking.sum')}`)}
              </button>
            ) : (
              <button onClick={goNext} style={primaryBtn}>
                {t('booking.next')}
              </button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default BookingModal;
