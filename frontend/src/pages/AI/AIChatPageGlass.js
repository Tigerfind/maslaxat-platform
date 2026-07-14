import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMediaQuery } from '@mui/material';
import { toast } from 'react-toastify';
import {
  AutoAwesomeOutlined,
  SendOutlined,
  AttachFileOutlined,
  MicNoneOutlined,
  DescriptionOutlined,
  ContentCopyOutlined,
  CheckOutlined,
  BookmarkBorderOutlined,
  CloseOutlined,
} from '@mui/icons-material';
import clientService from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';

/*
  ─────────────────────────────────────────────────────────────
  AI LEGAL ASSISTANT  (/ai-chat)
  Ported 1:1 from ClaudeDesign → client/03_AI_CHAT.html.
  Layout: chat panel (left, spans both rows) + conversations (top-right)
          + matched lawyers (bottom-right).
  Data wiring (unchanged):
   • conversations       ← clientService.aiChat.getConversations()
   • history             ← clientService.aiChat.getChatHistory(id)
   • send                → clientService.aiChat.sendMessage(text, id, files)
   • matched lawyers     ← clientService.lawyers.searchLawyers({specialization})
  Chrome (sidebar + topbar + dark toggle + lang + bell) = <GlassShell>.
  ─────────────────────────────────────────────────────────────
*/

const glassPanel = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

// Empty-state legal category chips → full prompt keys used by handleCategoryClick
const LAW_CATS = [
  { label: 'Гражданское', full: 'Гражданское право' },
  { label: 'Семейное', full: 'Семейное право' },
  { label: 'Трудовое', full: 'Трудовое право' },
  { label: 'Уголовное', full: 'Уголовное право' },
  { label: 'Корпоративное', full: 'Корпоративное право' },
  { label: 'Земельное', full: 'Земельное право' },
];

const AV_BG = [
  'linear-gradient(135deg,#B8956E,#8B7355)',
  'linear-gradient(135deg,#6A8A9A,#4A6A7A)',
  'linear-gradient(135deg,#7A9A6B,#5A7A4B)',
];

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';

const AIChatPageGlass = () => {
  const navigate = useNavigate();
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const isDesktop = useMediaQuery('(min-width:1024px)');

  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [matchedLawyers, setMatchedLawyers] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState(null);
  const [voiceOn, setVoiceOn] = useState(false);

  const handleCopyMessage = (text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMessageIndex(index);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    });
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (currentCategory) {
      loadMatchingLawyers(currentCategory);
    }
  }, [currentCategory]);

  const loadConversations = async () => {
    try {
      const data = await clientService.aiChat.getConversations();
      setConversations(Array.isArray(data) ? data : []);
      if (data.length > 0 && !currentConversationId) {
        loadConversationHistory(data[0].id);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const loadConversationHistory = async (conversationId) => {
    setIsLoadingHistory(true);
    setCurrentConversationId(conversationId);
    try {
      const history = await clientService.aiChat.getChatHistory(conversationId);
      setMessages(Array.isArray(history) ? history : []);
      const lastAi = [...(Array.isArray(history) ? history : [])].reverse().find((m) => !m.isUser && m.category);
      if (lastAi?.category) {
        setCurrentCategory(lastAi.category);
      }
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadMatchingLawyers = async (category) => {
    try {
      const data = await clientService.lawyers.searchLawyers({ specialization: category });
      let lawyers = Array.isArray(data) ? data : (data.lawyers || []);

      if (lawyers.length < 3) {
        const allData = await clientService.lawyers.searchLawyers({ sortBy: 'rating' });
        const allLawyers = Array.isArray(allData) ? allData : (allData.lawyers || []);
        const existingIds = new Set(lawyers.map((l) => l.id));
        const additional = allLawyers.filter((l) => !existingIds.has(l.id));
        lawyers = [...lawyers, ...additional].slice(0, 5);
      }

      setMatchedLawyers(lawyers.map((l) => ({
        id: l.id,
        name: l.name,
        specialization: l.profile?.specialization || l.specialization,
        rating: l.profile?.rating || l.rating || 0,
        reviewsCount: l.profile?.reviewsCount || l.reviewsCount || 0,
        price: l.profile?.price || l.price || 0,
        experience: l.profile?.experience || l.experience || 0,
        location: l.profile?.location || l.location || '',
        avatar: l.avatar,
        isExactMatch: (l.profile?.specialization || l.specialization) === category,
      })));
    } catch (error) {
      console.error('Error loading lawyers:', error);
      setMatchedLawyers([]);
    }
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setInputMessage('');
    setCurrentCategory(null);
    setMatchedLawyers([]);
  };

  const handleCategoryClick = (category) => {
    const prompts = {
      'Гражданское право': 'У меня вопрос по гражданскому праву. Какие основные права я имею как гражданин Узбекистана?',
      'Семейное право': 'У меня вопрос по семейному праву. Расскажите о порядке расторжения брака в Узбекистане.',
      'Трудовое право': 'У меня вопрос по трудовому праву. Какие мои права как работника в Узбекистане?',
      'Уголовное право': 'У меня вопрос по уголовному праву. Какие права имеет обвиняемый в Узбекистане?',
      'Корпоративное право': 'У меня вопрос по корпоративному праву. Как зарегистрировать ООО в Узбекистане?',
      'Земельное право': 'У меня вопрос по земельному праву. Какие документы нужны для покупки квартиры в Узбекистане?',
    };
    setInputMessage(prompts[category] || `У меня вопрос по теме: ${category}`);
  };

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files);
    const validFiles = files.filter((f) => {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} превышает 10MB`);
        return false;
      }
      return true;
    });
    setAttachedFiles((prev) => [...prev, ...validFiles]);
    event.target.value = '';
  };

  const removeFile = (index) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async () => {
    if ((!inputMessage.trim() && attachedFiles.length === 0) || isLoading) return;

    const fileNames = attachedFiles.map((f) => f.name);
    const msgText = inputMessage.trim() + (fileNames.length > 0 ? `\n\n📎 Прикреплено: ${fileNames.join(', ')}` : '');

    const userMessage = {
      text: msgText,
      isUser: true,
      timestamp: new Date().toISOString(),
      files: fileNames,
    };

    setMessages((prev) => [...prev, userMessage]);
    const sentMessage = inputMessage;
    const filesToSend = [...attachedFiles];
    setInputMessage('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      const response = await clientService.aiChat.sendMessage(sentMessage, currentConversationId, filesToSend);

      const aiMessage = {
        text: response.message || response.reply,
        isUser: false,
        timestamp: new Date().toISOString(),
        category: response.category,
      };

      setMessages((prev) => [...prev, aiMessage]);

      if (response.category) {
        setCurrentCategory(response.category);
      }

      if (response.conversationId && !currentConversationId) {
        setCurrentConversationId(response.conversationId);
        loadConversations();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => [...prev, {
        text: 'Извините, произошла ошибка. Пожалуйста, попробуйте еще раз.',
        isUser: false,
        timestamp: new Date().toISOString(),
        isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // --- Voice input (Web Speech API when available; graceful fallback) ---
  const stopVoice = () => {
    try { recognitionRef.current?.stop(); } catch (e) { /* noop */ }
    setVoiceOn(false);
  };

  const toggleVoice = () => {
    if (voiceOn) { stopVoice(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast.info('Голосовой ввод не поддерживается вашим браузером');
      return;
    }
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join('');
      setInputMessage(transcript);
    };
    rec.onend = () => setVoiceOn(false);
    rec.onerror = () => setVoiceOn(false);
    recognitionRef.current = rec;
    try { rec.start(); setVoiceOn(true); } catch (e) { setVoiceOn(false); }
  };

  const formatSize = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  const isEmpty = messages.length === 0 && !isLoadingHistory;
  const armed = inputMessage.trim().length > 0 || attachedFiles.length > 0;

  // ── Panel placement (2-col grid on desktop, stacked on mobile) ──
  const containerStyle = isDesktop
    ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gridTemplateRows: 'auto 1fr', gap: 20, height: '100%', maxWidth: 1320, margin: '0 auto' }
    : { display: 'flex', flexDirection: 'column', gap: 16, height: '100%', maxWidth: 640, margin: '0 auto' };

  const convStyle = isDesktop
    ? { ...glassPanel, gridColumn: 2, gridRow: 1, maxHeight: 244 }
    : { ...glassPanel, order: 1, maxHeight: 200 };
  const chatStyle = isDesktop
    ? { ...glassPanel, gridColumn: 1, gridRow: '1 / span 2', minHeight: 0 }
    : { ...glassPanel, order: 2, flex: 1, minHeight: 420 };
  const lawyersStyle = isDesktop
    ? { ...glassPanel, gridColumn: 2, gridRow: 2, minHeight: 0 }
    : { ...glassPanel, order: 3 };

  // ── Conversations panel ──
  const conversationsPanel = (
    <div style={convStyle}>
      <div style={{ padding: 18 }}>
        <button
          onClick={startNewConversation}
          style={{
            width: '100%', background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
            color: '#FFFFFF', border: 'none', fontSize: 13, fontWeight: 500, letterSpacing: '0.06em',
            textTransform: 'uppercase', padding: 13, borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          + Новый разговор
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
        {conversations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--text3)', fontSize: 12.5 }}>
            Нет сохранённых разговоров
          </div>
        ) : (
          conversations.map((c) => {
            const active = currentConversationId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => loadConversationHistory(c.id)}
                style={{
                  padding: '10px 12px', marginBottom: 4, borderRadius: 'var(--radius)', cursor: 'pointer',
                  background: active ? 'var(--canvas)' : 'transparent',
                  borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.title || 'Новый разговор'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  {new Date(c.updatedAt || c.createdAt).toLocaleDateString('ru-RU')}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ── Matched lawyers panel ──
  const lawyersPanel = (
    <div style={lawyersStyle}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text)' }}>
          Подходящие юристы
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
          {currentCategory ? `По теме «${currentCategory}»` : 'Задайте вопрос — подберём специалистов'}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {matchedLawyers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--text3)', fontSize: 12.5, lineHeight: 1.5 }}>
            Здесь появятся юристы, подходящие под вашу ситуацию
          </div>
        ) : (
          matchedLawyers.map((m, i) => (
            <div
              key={m.id}
              onClick={() => navigate(`/lawyers/${m.id}`)}
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14,
                marginBottom: 12, cursor: 'pointer', transition: 'all .2s',
              }}
            >
              {m.isExactMatch && (
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7A9A6B', marginBottom: 8 }}>
                  ✦ Рекомендован
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', background: AV_BG[i % AV_BG.length],
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 14, flexShrink: 0,
                }}>
                  {initialsOf(m.name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--accent)' }}>
                    ★ {m.rating || '—'}{m.experience ? ` · ${m.experience} лет` : ''}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/lawyers/${m.id}`); }}
                style={{
                  width: '100%', marginTop: 12, background: 'var(--canvas)', border: '1px solid var(--accent)',
                  color: 'var(--text)', fontSize: 12, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                  padding: 9, borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Записаться
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // ── Chat panel ──
  const chatPanel = (
    <div style={chatStyle}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {isEmpty && (
          <div style={{ textAlign: 'center', marginBottom: 6, marginTop: 'auto' }}>
            <div style={{
              width: 56, height: 56, margin: '0 auto 14px', borderRadius: '50%',
              background: 'linear-gradient(140deg, var(--accent), var(--accent-dark))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
              boxShadow: '0 6px 18px rgba(184,149,110,0.4)',
            }}>
              <AutoAwesomeOutlined sx={{ fontSize: 26 }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Юридический AI-помощник</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.5 }}>
              Опишите ситуацию — отвечу по законам Узбекистана<br />со ссылками на статьи и планом действий.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 18 }}>
              {LAW_CATS.map((cat) => (
                <button
                  key={cat.label}
                  onClick={() => handleCategoryClick(cat.full)}
                  style={{
                    background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 20,
                    padding: '8px 14px', fontSize: 13, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoadingHistory && (
          <div style={{ margin: 'auto', color: 'var(--text3)', fontSize: 13 }}>Загрузка…</div>
        )}

        {messages.map((m, index) => (
          m.isUser ? (
            <div key={index} style={{ alignSelf: 'flex-end', maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
              {m.files && m.files.length > 0 && m.files.map((fn, fi) => (
                <div key={fi} style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  background: 'color-mix(in srgb, var(--accent) 82%, #FFFFFF)', color: '#FFFFFF',
                  borderRadius: 12, padding: '9px 13px 9px 10px',
                }}>
                  <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 6, background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <DescriptionOutlined sx={{ fontSize: 16 }} />
                  </span>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{fn}</div>
                </div>
              ))}
              <div style={{ background: 'var(--accent)', color: '#FFFFFF', padding: '13px 17px', borderRadius: '12px 12px 4px 12px', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.text}
              </div>
            </div>
          ) : (
            <div key={index} className="ai-msg" style={{ alignSelf: 'flex-start', maxWidth: '82%', display: 'flex', gap: 10 }}>
              <div className="ai-av" style={{
                width: 30, height: 30, flexShrink: 0, borderRadius: '50%',
                background: 'linear-gradient(140deg, var(--accent), var(--accent-dark))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
                boxShadow: '0 2px 8px rgba(184,149,110,0.35)',
              }}>
                <AutoAwesomeOutlined sx={{ fontSize: 17 }} />
              </div>
              <div
                className="ai-reveal"
                style={{
                  flex: 1,
                  background: m.isError ? 'rgba(176,112,112,0.08)' : 'var(--canvas)',
                  border: m.isError ? '1px solid rgba(176,112,112,0.35)' : '1px solid var(--border)',
                  borderRadius: '4px 14px 14px 14px', padding: '15px 17px',
                }}
              >
                {m.category && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', borderRadius: 20, padding: '4px 11px', marginBottom: 11 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                    <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-dark)', fontWeight: 600 }}>{m.category}</span>
                  </div>
                )}
                <div style={{ fontSize: 14, lineHeight: 1.6, color: m.isError ? '#B07070' : '#2D2D2D', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                {!m.isError && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 13, borderTop: '1px dashed var(--border)' }}>
                    <button
                      onClick={() => navigate('/portfolio')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 12, color: 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 13px', cursor: 'pointer' }}
                    >
                      <BookmarkBorderOutlined sx={{ fontSize: 15 }} /> Сохранить в Досье
                    </button>
                    <button
                      onClick={() => handleCopyMessage(m.text, index)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 12, color: copiedMessageIndex === index ? '#7A9A6B' : 'var(--accent-dark)', background: 'rgba(184,149,110,0.1)', border: '1px solid rgba(184,149,110,0.28)', borderRadius: 20, padding: '6px 13px', cursor: 'pointer' }}
                    >
                      {copiedMessageIndex === index ? <CheckOutlined sx={{ fontSize: 15 }} /> : <ContentCopyOutlined sx={{ fontSize: 15 }} />}
                      {copiedMessageIndex === index ? 'Скопировано' : 'Копировать'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        ))}

        {isLoading && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 5, background: 'var(--canvas)', padding: '15px 18px', borderRadius: '12px 12px 12px 4px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite .2s' }} />
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite .4s' }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px' }}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Attachment previews */}
        {attachedFiles.map((file, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(184,149,110,0.09)',
            border: '1px solid rgba(184,149,110,0.28)', borderRadius: 'var(--radius)', padding: '8px 10px 8px 12px', marginBottom: 10,
          }}>
            <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 6, background: 'var(--accent)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DescriptionOutlined sx={{ fontSize: 17 }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Готов к анализу · {formatSize(file.size)}</div>
            </div>
            <button
              onClick={() => removeFile(i)}
              style={{ width: 26, height: 26, flexShrink: 0, borderRadius: '50%', background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <CloseOutlined sx={{ fontSize: 16 }} />
            </button>
          </div>
        ))}

        {/* Voice input panel */}
        {voiceOn && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '22px 14px 20px', marginBottom: 12,
            background: 'var(--card-glass)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', animation: 'voiceIn 0.32s cubic-bezier(.34,1.56,.64,1) both',
          }}>
            <div style={{ position: 'relative', width: 76, height: 76, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(184,149,110,0.3)', animation: 'voiceRing 1.8s ease-out infinite' }} />
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(184,149,110,0.3)', animation: 'voiceRing 1.8s ease-out infinite 0.9s' }} />
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(140deg, var(--accent), var(--accent-dark))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', animation: 'voiceGlow 1.5s ease-in-out infinite' }}>
                <MicNoneOutlined sx={{ fontSize: 26 }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 34 }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((b) => (
                <span key={b} className="vbar" style={{ height: 34, animationDelay: `${b * 0.09}s` }} />
              ))}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text2)', textAlign: 'center', minHeight: 20 }}>Слушаю…</div>
            <button
              onClick={stopVoice}
              style={{ background: 'var(--accent)', border: 'none', color: '#FFFFFF', fontSize: 13, fontWeight: 500, letterSpacing: '0.05em', padding: '11px 26px', borderRadius: 22, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Остановить
            </button>
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 4 }}
          >
            <AttachFileOutlined sx={{ fontSize: 20 }} />
          </button>
          <textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Напишите сообщение…"
            rows={1}
            disabled={isLoading}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', resize: 'none', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', padding: '8px 0', lineHeight: 1.4, maxHeight: 120 }}
          />
          <button
            onClick={toggleVoice}
            title="Голосовой ввод"
            style={{
              background: voiceOn ? 'var(--accent)' : 'transparent', border: 'none', width: 38, height: 38, borderRadius: 'var(--radius)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: voiceOn ? '#FFFFFF' : 'var(--text3)', cursor: 'pointer',
            }}
          >
            <MicNoneOutlined sx={{ fontSize: 20 }} />
          </button>
          <button
            onClick={handleSendMessage}
            disabled={!armed || isLoading}
            className={`send-btn${armed ? ' armed' : ''}`}
            style={{
              background: 'var(--accent)', border: 'none', width: 38, height: 38, borderRadius: 'var(--radius)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
              cursor: armed && !isLoading ? 'pointer' : 'default', opacity: armed ? 1 : 0.55,
            }}
          >
            <SendOutlined sx={{ fontSize: 18 }} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <GlassShell active="/ai-chat" title="AI-помощник" subtitle="Юридическая помощь с подбором специалистов" role="client">
      <div style={containerStyle}>
        {conversationsPanel}
        {chatPanel}
        {lawyersPanel}
      </div>
    </GlassShell>
  );
};

export default AIChatPageGlass;
