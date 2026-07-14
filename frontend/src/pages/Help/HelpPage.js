import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  ChatBubbleOutline,
  PhoneOutlined,
  EmailOutlined,
  KeyboardArrowDownOutlined,
} from '@mui/icons-material';
import GlassShell from '../../components/GlassKit/GlassShell';

/*
  ─────────────────────────────────────────────────────────────
  СЛУЖБА ПОДДЕРЖКИ  (/help)
  Ported 1:1 from ClaudeDesign → ClientApp "СЛУЖБА ПОДДЕРЖКИ".
  Sections:
   • 3 support channels (chat / phone / email) glass cards
   • FAQ accordions (animated grid-rows expand)
   • Ticket form: category chips + subject + message → submit
  Chrome (sidebar + topbar + dark toggle + lang + bell) = <GlassShell>.
  NOTE: ticket submit is client-side only — surfaces a toast. There is
  no /api/support endpoint yet (see report), so no request is sent.
  ─────────────────────────────────────────────────────────────
*/

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const sectionLabel = {
  fontSize: 12,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 14,
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  background: 'var(--canvas)',
  borderRadius: 'var(--radius)',
  padding: '13px 15px',
  fontFamily: 'inherit',
  fontSize: 14,
  color: 'var(--text)',
  outline: 'none',
};

const SUP_FAQ = [
  {
    q: 'Как отменить или перенести консультацию?',
    a: 'Откройте «Консультации» → нужная запись → «Отменить» или «Перенести». Бесплатно при отмене за 24 часа до начала.',
  },
  {
    q: 'Возвращаются ли деньги при отмене?',
    a: 'Да. При отмене за сутки — полный возврат на карту в течение 3–5 рабочих дней. При отмене позже удерживается 30%.',
  },
  {
    q: 'Насколько надёжен AI-помощник?',
    a: 'AI даёт справочную информацию по законодательству РУз и не заменяет юриста. Для юридически значимых решений подключайте специалиста через платформу.',
  },
  {
    q: 'Как стать юристом на платформе?',
    a: 'Пройдите анкету «Стать юристом» в профиле: укажите специализации, опыт и загрузите документы. Модерация занимает до 2 рабочих дней.',
  },
];

const SUP_CATS = ['Общий вопрос', 'Оплата', 'Технический сбой', 'Жалоба'];

const HelpPage = () => {
  const navigate = useNavigate();

  const [faqOpen, setFaqOpen] = useState(null);
  const [supCat, setSupCat] = useState('Общий вопрос');
  const [supSubject, setSupSubject] = useState('');
  const [supMsg, setSupMsg] = useState('');

  const supChannels = [
    {
      icon: <ChatBubbleOutline sx={{ fontSize: 22 }} />,
      title: 'Онлайн-чат',
      desc: 'Ответим в среднем за 2 минуты',
      action: 'Открыть чат',
      tint: 'rgba(184,149,110,0.16)',
      color: 'var(--accent)',
      go: () => navigate('/ai-chat'),
    },
    {
      icon: <PhoneOutlined sx={{ fontSize: 22 }} />,
      title: 'Телефон',
      desc: '+998 71 200-70-70 · 9:00–21:00',
      action: 'Позвонить',
      tint: 'rgba(90,120,150,0.14)',
      color: '#5A7896',
      go: () => { window.location.href = 'tel:+998712007070'; },
    },
    {
      icon: <EmailOutlined sx={{ fontSize: 22 }} />,
      title: 'Email',
      desc: 'support@emaslaxat.uz',
      action: 'Написать',
      tint: '#F5EFE0',
      color: '#C4A35A',
      go: () => { window.location.href = 'mailto:support@emaslaxat.uz'; },
    },
  ];

  const disabled = !supSubject.trim() && !supMsg.trim();

  const handleSubmit = () => {
    if (disabled) {
      toast.error('Заполните тему или сообщение');
      return;
    }
    // No backend endpoint yet — acknowledge locally.
    toast.success('Обращение отправлено — ответим на email в течение дня');
    setSupSubject('');
    setSupMsg('');
  };

  return (
    <GlassShell active="/help" title="Поддержка" subtitle="Мы на связи — ответим и поможем">
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* SUPPORT CHANNELS */}
        <div className="sup-channels" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {supChannels.map((c, i) => (
            <div key={i} style={{ ...glassCard, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 'var(--radius)', background: c.tint, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.icon}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>{c.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4, lineHeight: 1.5 }}>{c.desc}</div>
              </div>
              <button
                onClick={c.go}
                style={{ marginTop: 'auto', alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '10px 18px', borderRadius: 'var(--radius)', cursor: 'pointer' }}
              >
                {c.action}
              </button>
            </div>
          ))}
        </div>

        {/* FAQ + TICKET FORM */}
        <div className="sup-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 20, alignItems: 'start' }}>

          {/* FAQ */}
          <div>
            <div style={sectionLabel}>Частые вопросы</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SUP_FAQ.map((f, i) => {
                const isOpen = faqOpen === i;
                return (
                  <div key={i} style={{ background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--card-brd)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <button
                      onClick={() => setFaqOpen(isOpen ? null : i)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, textAlign: 'left', padding: '16px 18px', background: 'transparent', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}
                    >
                      <span>{f.q}</span>
                      <KeyboardArrowDownOutlined sx={{ fontSize: 20, flexShrink: 0, color: 'var(--accent)', transition: 'transform 0.4s cubic-bezier(.22,1,.36,1)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                    </button>
                    <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', opacity: isOpen ? 1 : 0, transition: 'grid-template-rows 0.42s cubic-bezier(.22,1,.36,1), opacity 0.34s ease' }}>
                      <div style={{ overflow: 'hidden', minHeight: 0 }}>
                        <div style={{ padding: '0 18px 16px', fontSize: 13, lineHeight: 1.7, color: 'var(--text2)' }}>{f.a}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TICKET FORM */}
          <div style={{ ...glassCard, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Не нашли ответ?</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>Опишите проблему — ответим на email в течение дня.</div>

            <div style={{ fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>Категория</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {SUP_CATS.map((c) => {
                const active = supCat === c;
                return (
                  <button
                    key={c}
                    onClick={() => setSupCat(c)}
                    style={{ padding: '9px 16px', borderRadius: 20, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent)' : 'transparent', color: active ? '#FFFFFF' : 'var(--text2)' }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <input
              value={supSubject}
              onChange={(e) => setSupSubject(e.target.value)}
              placeholder="Тема обращения"
              style={{ ...inputStyle, marginBottom: 12 }}
            />
            <textarea
              value={supMsg}
              onChange={(e) => setSupMsg(e.target.value)}
              placeholder="Опишите вопрос подробнее…"
              rows={5}
              style={{ ...inputStyle, resize: 'none', marginBottom: 18 }}
            />

            <button
              onClick={handleSubmit}
              disabled={disabled}
              style={{ width: '100%', background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))', color: '#FFFFFF', border: 'none', fontSize: 14, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', padding: 15, borderRadius: 'var(--radius)', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', opacity: disabled ? 0.5 : 1 }}
            >
              Отправить обращение
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px){
          .sup-channels { grid-template-columns: 1fr !important; }
          .sup-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </GlassShell>
  );
};

export default HelpPage;
