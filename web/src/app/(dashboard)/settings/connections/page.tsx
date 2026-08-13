import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveUserData } from '@/lib/supabase/cached-queries';
import ConnectionsClientView from './connections-client-view';

export const revalidate = 0;

export default async function ConnectionsPage() {
  const userData = await resolveUserData();
  if (!userData) redirect('/login');

  const { user, myTelegramChatId } = userData;
  const supabase = await createClient();

  // One column, one row. The old Settings ran five queries before it could paint;
  // a page about a code should ask for the code.
  const { data } = await supabase
    .from('profiles')
    .select('connect_code')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <ConnectionsClientView
      connectCode={data?.connect_code || ''}
      hasTelegramChatId={!!myTelegramChatId}
    />
  );
}
