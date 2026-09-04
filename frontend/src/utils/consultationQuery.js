import { CONSULTATION_PERIODS, CONSULTATION_TABS } from './consultationPresentation';

export const parseConsultationQuery = (params, legacyTab = null) => ({
  tab: CONSULTATION_TABS.includes(params.get('tab')) ? params.get('tab') : (legacyTab || 'all'),
  search: params.get('search') || '',
  period: CONSULTATION_PERIODS.includes(params.get('period')) ? params.get('period') : 'all',
  page: Math.max(1, Number.parseInt(params.get('page'), 10) || 1),
});

export const serializeConsultationQuery = ({ tab, search, period, page }) => {
  const params = new URLSearchParams();
  if (tab && tab !== 'all') params.set('tab', tab);
  if (search?.trim()) params.set('search', search.trim());
  if (period && period !== 'all') params.set('period', period);
  if (page > 1) params.set('page', String(page));
  return params;
};

export const consultationQueryKey = (query) => JSON.stringify([
  query.tab, query.search.trim(), query.period, query.page,
]);
