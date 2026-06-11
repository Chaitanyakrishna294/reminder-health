-- CREATE PUSH LOGS TABLE FOR SYSTEM HEALTH MONITORING
CREATE TABLE IF NOT EXISTS public.push_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'EXPIRED', 'FAILED')),
    gateway TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- CREATE INDEX FOR BETTER SPEED
CREATE INDEX IF NOT EXISTS idx_push_logs_created_at ON public.push_logs(created_at DESC);

-- ENABLE ROW LEVEL SECURITY
ALTER TABLE public.push_logs ENABLE ROW LEVEL SECURITY;

-- ALLOW SELECT FOR AUTHENTICATED USERS (FOR ADMIN DIAGNOSTICS PAGE)
DROP POLICY IF EXISTS "Allow select push_logs for authenticated users" ON public.push_logs;
CREATE POLICY "Allow select push_logs for authenticated users" ON public.push_logs
    FOR SELECT TO authenticated
    USING (true);

-- ADD UPDATE POLICY FOR PUSH SUBSCRIPTIONS TO ENABLE UPSERTS
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update own push subscriptions" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
