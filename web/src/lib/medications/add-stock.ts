// The single way the web adds stock to a medication.
//
// Two implementations of this already existed — submitRefill in the dashboard
// inventory card and confirmAddStock in the medication list — and the refill gate
// would have been a third. That is exactly how this codebase ended up with three
// disagreeing definitions of "low stock"; one writer prevents the repeat.
//
// current_stock is the source of truth; a DB trigger keeps tablet_count as a
// floored mirror. Raising current_stock also clears low_stock_notified_at via the
// rearm_low_stock_notice() trigger, which is what makes the next crossing alertable.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AddStockArgs {
  supabase: SupabaseClient;
  medicationId: number;
  /** Current value; null/undefined is treated as 0. */
  currentStock: number | null | undefined;
  /** Units to ADD, not the new total. Must be > 0. */
  amount: number;
}

export async function addStock({
  supabase,
  medicationId,
  currentStock,
  amount,
}: AddStockArgs): Promise<{ newStock: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter how many units you added.');
  }

  const newStock = Number(currentStock || 0) + amount;

  const { error } = await supabase
    .from('medications')
    .update({ current_stock: newStock })
    .eq('id', medicationId);

  if (error) {
    // RLS denial is the realistic failure for a caregiver without
    // can_edit_medications — say what it means rather than leaking the code.
    console.error('[addStock] update failed:', error.message);
    throw new Error("Could not update stock. You may not have permission to edit this patient's medications.");
  }

  return { newStock };
}
