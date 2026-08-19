export function parseSponsoredPositions(input) {
  const tokens = String(input).split(',').map((token) => token.trim());
  if (tokens.length < 1 || tokens.length > 2 || tokens.some((token) => !/^\d+$/.test(token))) {
    return { ok: false, value: null };
  }
  const value = tokens.map(Number);
  if (value.some((position) => position < 0 || position > 19) || new Set(value).size !== value.length) {
    return { ok: false, value: null };
  }
  return { ok: true, value };
}

export function snapshotCampaignFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
}

export function createAdminPromotionReloadTracker() {
  let packagePage = 1;
  let campaignPage = 1;
  let appliedCampaignFilters = {};
  return {
    recordPackages(page) { packagePage = page; },
    recordCampaigns(page, filters) {
      campaignPage = page;
      appliedCampaignFilters = snapshotCampaignFilters(filters);
    },
    current() {
      return {
        packagePage,
        campaignPage,
        appliedCampaignFilters: { ...appliedCampaignFilters },
      };
    },
  };
}

export async function runMutationThenRefresh({ mutate, onSaved, refresh }) {
  await mutate();
  onSaved();
  try {
    await refresh();
    return { saved: true, refreshed: true, refreshError: null };
  } catch (refreshError) {
    return { saved: true, refreshed: false, refreshError };
  }
}
