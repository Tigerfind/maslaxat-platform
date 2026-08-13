import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  ExpandMore,
  Videocam,
  SmartToy,
  Description,
  Shield,
  Gavel,
  Star,
  CheckCircle,
  ArrowForward,
} from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';
import AmbientBackground from '../../components/GlassKit/AmbientBackground';
import GlassCard from '../../components/Glass/GlassCard';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { useTranslation } from '../../i18n';

const C = axelionColors;

// Иконки для блока «Функции» (по индексу)
const FEATURE_ICONS = [SmartToy, Videocam, Description, Star, Shield];
const BADGE_ICONS = [Videocam, SmartToy, Description, Shield];

// Тарифы: цены числами (совпадают с backend/api/src/routes/subscriptions.js).
// Текст (название/фичи) берётся из переводов.
const PLAN_PRICES = [0, 99000, 299000];

const formatSum = (n) => (n === 0 ? null : n.toLocaleString('ru-RU'));

const SectionTitle = ({ children, id }) => (
  <Typography
    id={id}
    variant="h4"
    sx={{
      textAlign: 'center',
      fontWeight: 300,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: C.textDark,
      mb: { xs: 4, md: 6 },
      fontSize: { xs: 24, md: 32 },
    }}
  >
    {children}
  </Typography>
);

const LandingPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const arr = (key) => {
    const v = t(`landing.${key}`);
    return Array.isArray(v) ? v : [];
  };

  const steps = arr('steps');
  const features = arr('features');
  const specializations = arr('specializations');
  const plans = arr('plans');
  const faq = arr('faq');
  const badges = arr('heroBadges');
  const stats = arr('stats');

  const goRegister = (role) => navigate(role ? `/register?role=${role}` : '/register');

  const goldGradientBtn = {
    background: `linear-gradient(135deg, ${C.gold} 0%, ${C.goldDark} 100%)`,
    color: '#fff',
    textTransform: 'none',
    borderRadius: '8px',
    px: 4,
    py: 1.5,
    fontSize: 16,
    boxShadow: '0 6px 20px rgba(184,149,110,0.35)',
    '&:hover': { background: `linear-gradient(135deg, ${C.goldDark} 0%, ${C.bronze} 100%)`, boxShadow: '0 8px 26px rgba(184,149,110,0.45)' },
  };

  const outlineBtn = {
    color: C.textDark,
    textTransform: 'none',
    borderRadius: '8px',
    px: 4,
    py: 1.5,
    fontSize: 16,
    border: `1px solid ${C.borderMedium}`,
    '&:hover': { borderColor: C.gold, backgroundColor: C.bgCream },
  };

  const navLinks = [
    { href: '#how', label: t('landing.navHow') },
    { href: '#features', label: t('landing.navFeatures') },
    { href: '#pricing', label: t('landing.navPricing') },
    { href: '#for-lawyers', label: t('landing.navForLawyers') },
    { href: '#faq', label: t('landing.navFaq') },
  ];

  return (
    <Box sx={{ position: 'relative', minHeight: '100vh', backgroundColor: C.bgCream, overflowX: 'hidden' }}>
      <AmbientBackground />

      {/* ── Контент поверх фона ── */}
      <Box sx={{ position: 'relative', zIndex: 2 }}>
        {/* ── Топбар ── */}
        <Box
          component="header"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backdropFilter: 'blur(20px)',
            backgroundColor: 'rgba(245,241,235,0.75)',
            borderBottom: `1px solid ${C.borderLight}`,
          }}
        >
          <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, gap: 2 }}>
            {/* Лого */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '8px', background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ color: '#fff', fontWeight: 400, fontSize: 22, letterSpacing: '0.05em' }}>M</Typography>
              </Box>
              <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                <Typography sx={{ fontWeight: 500, letterSpacing: '0.12em', color: C.textDark, lineHeight: 1 }}>MASLAXAT</Typography>
                <Typography sx={{ fontSize: 10, letterSpacing: '0.2em', color: C.textMuted, textTransform: 'uppercase' }}>Legal Platform</Typography>
              </Box>
            </Box>

            {/* Навигация (desktop) */}
            <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 3 }}>
              {navLinks.map((l) => (
                <Box key={l.href} component="a" href={l.href} sx={{ color: C.textSecondary, textDecoration: 'none', fontSize: 14, '&:hover': { color: C.gold } }}>
                  {l.label}
                </Box>
              ))}
            </Box>

            {/* Действия */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                <LanguageSwitcher variant="dropdown" />
              </Box>
              <Button onClick={() => navigate('/login')} sx={{ color: C.textDark, textTransform: 'none', '&:hover': { color: C.gold } }}>
                {t('landing.login')}
              </Button>
              <Button onClick={() => navigate('/register')} variant="contained" sx={{ ...goldGradientBtn, px: 2.5, py: 1, fontSize: 14 }}>
                {t('landing.register')}
              </Button>
            </Box>
          </Container>
        </Box>

        {/* ── Hero ── */}
        <Container maxWidth="md" sx={{ textAlign: 'center', pt: { xs: 6, md: 12 }, pb: { xs: 6, md: 10 } }}>
          <Typography
            variant="h1"
            sx={{
              fontWeight: 300,
              letterSpacing: { xs: '0.06em', md: '0.1em' },
              textTransform: 'uppercase',
              color: C.textDark,
              fontSize: { xs: 32, sm: 44, md: 56 },
              lineHeight: 1.15,
              mb: 3,
            }}
          >
            {t('landing.heroTitle')}
          </Typography>
          <Typography sx={{ color: C.textSecondary, fontSize: { xs: 16, md: 20 }, maxWidth: 640, mx: 'auto', mb: 4 }}>
            {t('landing.heroSubtitle')}
          </Typography>

          {/* CTA */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', mb: 5 }}>
            <Button variant="contained" endIcon={<ArrowForward />} sx={goldGradientBtn} onClick={() => goRegister('client')}>
              {t('landing.ctaClient')}
            </Button>
            <Button variant="outlined" sx={outlineBtn} onClick={() => goRegister('lawyer')}>
              {t('landing.ctaLawyer')}
            </Button>
          </Box>

          {/* Фиче-бейджи */}
          <Box sx={{ display: 'flex', gap: { xs: 1.5, md: 3 }, justifyContent: 'center', flexWrap: 'wrap' }}>
            {badges.map((b, i) => {
              const Icon = BADGE_ICONS[i] || CheckCircle;
              return (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: C.textSecondary, fontSize: 14 }}>
                  <Icon sx={{ fontSize: 18, color: C.gold }} />
                  {b}
                </Box>
              );
            })}
          </Box>
        </Container>

        {/* ── Как это работает ── */}
        <Container maxWidth="lg" id="how" sx={{ py: { xs: 6, md: 10 } }}>
          <SectionTitle>{t('landing.howTitle')}</SectionTitle>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            {steps.map((s, i) => (
              <GlassCard key={i} variant="elevated" hover sx={{ textAlign: 'center' }}>
                <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: C.accentLight || 'rgba(184,149,110,0.12)', color: C.gold, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2, fontSize: 20, fontWeight: 500 }}>
                  {i + 1}
                </Box>
                <Typography sx={{ fontWeight: 500, color: C.textDark, mb: 1 }}>{s.title}</Typography>
                <Typography sx={{ color: C.textSecondary, fontSize: 14 }}>{s.desc}</Typography>
              </GlassCard>
            ))}
          </Box>
        </Container>

        {/* ── Функции ── */}
        <Container maxWidth="lg" id="features" sx={{ py: { xs: 6, md: 10 } }}>
          <SectionTitle>{t('landing.featuresTitle')}</SectionTitle>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' } }}>
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i] || CheckCircle;
              return (
                <GlassCard key={i} variant="flat" hover>
                  <Icon sx={{ fontSize: 32, color: C.gold, mb: 1.5 }} />
                  <Typography sx={{ fontWeight: 500, color: C.textDark, mb: 1 }}>{f.title}</Typography>
                  <Typography sx={{ color: C.textSecondary, fontSize: 14 }}>{f.desc}</Typography>
                </GlassCard>
              );
            })}
          </Box>
        </Container>

        {/* ── Направления права ── */}
        <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
          <SectionTitle>{t('landing.directionsTitle')}</SectionTitle>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' } }}>
            {specializations.map((name, i) => (
              <GlassCard key={i} variant="cream" hover sx={{ textAlign: 'center', padding: '16px' }}>
                <Gavel sx={{ fontSize: 22, color: C.gold, mb: 1 }} />
                <Typography sx={{ color: C.textDark, fontSize: 13 }}>{name}</Typography>
              </GlassCard>
            ))}
          </Box>
        </Container>

        {/* ── Соц.доказательство (юристы) ── */}
        <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            {stats.map((st, i) => (
              <Box key={i} sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: { xs: 28, md: 40 }, fontWeight: 300, color: C.gold }}>{st.value}</Typography>
                <Typography sx={{ color: C.textSecondary, fontSize: 14 }}>{st.label}</Typography>
              </Box>
            ))}
          </Box>
        </Container>

        {/* ── Тарифы ── */}
        <Container maxWidth="lg" id="pricing" sx={{ py: { xs: 6, md: 10 } }}>
          <SectionTitle>{t('landing.pricingTitle')}</SectionTitle>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, alignItems: 'stretch' }}>
            {plans.map((p, i) => {
              const highlight = i === 2;
              const price = formatSum(PLAN_PRICES[i]);
              return (
                <GlassCard key={i} variant={highlight ? 'gold' : 'elevated'} hover={!highlight} sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography sx={{ fontWeight: 500, fontSize: 18, mb: 1, color: highlight ? '#fff' : C.textDark }}>{p.name}</Typography>
                  <Box sx={{ mb: 2 }}>
                    <Typography component="span" sx={{ fontSize: 32, fontWeight: 300, color: highlight ? '#fff' : C.textDark }}>
                      {price || t('landing.priceFree')}
                    </Typography>
                    {price && (
                      <Typography component="span" sx={{ fontSize: 14, color: highlight ? 'rgba(255,255,255,0.85)' : C.textMuted }}>
                        {' '}{t('landing.sumPerMonth')}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ flex: 1, mb: 2 }}>
                    {(p.features || []).map((f, j) => (
                      <Box key={j} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                        <CheckCircle sx={{ fontSize: 18, color: highlight ? '#fff' : C.gold, mt: '2px' }} />
                        <Typography sx={{ fontSize: 14, color: highlight ? 'rgba(255,255,255,0.95)' : C.textSecondary }}>{f}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Button
                    fullWidth
                    onClick={() => goRegister('client')}
                    sx={highlight
                      ? { background: '#fff', color: C.bronze, textTransform: 'none', borderRadius: '8px', py: 1.25, '&:hover': { background: '#fff', opacity: 0.9 } }
                      : { ...goldGradientBtn, px: 2, py: 1.25, fontSize: 15 }}
                  >
                    {t('landing.planCta')}
                  </Button>
                </GlassCard>
              );
            })}
          </Box>
        </Container>

        {/* ── Для юристов ── */}
        <Container maxWidth="md" id="for-lawyers" sx={{ py: { xs: 6, md: 10 } }}>
          <GlassCard variant="cream" sx={{ textAlign: 'center', padding: { xs: '32px 20px', md: '48px' } }}>
            <Gavel sx={{ fontSize: 40, color: C.gold, mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 400, color: C.textDark, mb: 2 }}>{t('landing.forLawyersTitle')}</Typography>
            <Typography sx={{ color: C.textSecondary, maxWidth: 560, mx: 'auto', mb: 3 }}>{t('landing.forLawyersText')}</Typography>
            <Button variant="contained" sx={goldGradientBtn} onClick={() => goRegister('lawyer')}>
              {t('landing.forLawyersCta')}
            </Button>
          </GlassCard>
        </Container>

        {/* ── FAQ ── */}
        <Container maxWidth="md" id="faq" sx={{ py: { xs: 6, md: 10 } }}>
          <SectionTitle>{t('landing.faqTitle')}</SectionTitle>
          {faq.map((item, i) => (
            <Accordion key={i} disableGutters elevation={0} sx={{ border: `1px solid ${C.borderLight}`, borderRadius: '8px !important', mb: 1.5, backgroundColor: C.bgLight, '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography sx={{ fontWeight: 500, color: C.textDark }}>{item.q}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography sx={{ color: C.textSecondary, fontSize: 14 }}>{item.a}</Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Container>

        {/* ── Футер ── */}
        <Box component="footer" sx={{ borderTop: `1px solid ${C.borderLight}`, backgroundColor: 'rgba(255,255,255,0.5)', mt: 4 }}>
          <Container maxWidth="lg" sx={{ py: 5, display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, alignItems: 'center' }}>
            <Box>
              <Typography sx={{ fontWeight: 500, letterSpacing: '0.12em', color: C.textDark, mb: 1 }}>MASLAXAT</Typography>
              <Typography sx={{ color: C.textMuted, fontSize: 13, maxWidth: 360 }}>{t('landing.footerAbout')}</Typography>
            </Box>
            <Box sx={{ textAlign: { xs: 'left', sm: 'right' }, color: C.textSecondary, fontSize: 14 }}>
              <Typography sx={{ fontSize: 14 }}>support@maslaxat.uz</Typography>
              <Typography sx={{ fontSize: 14 }}>Telegram: @maslaxat_support</Typography>
              <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'flex-end' }, flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
                <Box component="a" href="/terms" sx={{ color: C.textSecondary }}>{t('landing.terms')}</Box>
                <Box component="a" href="/privacy" sx={{ color: C.textSecondary }}>{t('landing.privacy')}</Box>
                <Box component="a" href="/refund-policy" sx={{ color: C.textSecondary }}>{t('landing.refunds')}</Box>
              </Box>
            </Box>
          </Container>
          <Box sx={{ textAlign: 'center', pb: 3, color: C.textMuted, fontSize: 12 }}>
            © 2026 MaslaXat — {t('landing.rights')}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default LandingPage;
