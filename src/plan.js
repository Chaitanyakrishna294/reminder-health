// Bot-side plan gating — resolves whether an account is on the paid Care+ plan.
// Mirrors web/src/lib/plan.ts (getActivePlan) exactly; keep the two in lockstep.
// Used to gate voice calls (a paid feature) at call time. See docs/VOICE_CALLS_DESIGN.md.
const { supabase } = require('./db');

/**
 * @param {string} telegramId
 * @returns {Promise<'free'|'care_plus'>}
 */
async function getActivePlan(telegramId) {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (!data || data.plan !== 'care_plus') return 'free';
  // Paid (active) counts; a trial counts until it expires.
  const future = !data.current_period_end || new Date(data.current_period_end) > new Date();
  const active = data.status === 'active' || (data.status === 'trialing' && future);
  return active ? 'care_plus' : 'free';
}

async function isCarePlus(telegramId) {
  return (await getActivePlan(telegramId)) === 'care_plus';
}

module.exports = { getActivePlan, isCarePlus };
