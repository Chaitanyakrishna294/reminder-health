-- Liveness heartbeat for the Render bot's minute-tick scheduler. The web failover
-- cron (/api/cron/tick) reads last_beat to decide whether the bot is alive; if it
-- is stale/missing the cron takes over sending. Single-row table (id is pinned to 1).
-- service_role only (bot + web service client bypass RLS); no anon/authenticated policy.
CREATE TABLE IF NOT EXISTS public.scheduler_heartbeat (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_beat   timestamptz NOT NULL,
  instance_id text
);

ALTER TABLE public.scheduler_heartbeat ENABLE ROW LEVEL SECURITY;

-- Seed the single row so the first read never 404s. A brand-new (pre-bot-deploy)
-- last_beat in the past reads as "dead" -> failover is active until the bot ships
-- its heartbeat write, which is the fail-safe behavior we want.
INSERT INTO public.scheduler_heartbeat (id, last_beat)
VALUES (1, now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;
