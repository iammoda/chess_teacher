-- 003_schema_sync.sql
-- Brings migration-based installs up to parity with schema.sql. These objects
-- were added to schema.sql over time but never got a migration, so installs
-- that only ran migrations/*.sql are missing them:
--
--   * moves engine-analysis columns — without them EVERY syncMoveAnalysis
--     update is rejected (unknown column) and silently dropped client-side.
--   * usage_daily + increment_coach_usage — without them the per-user daily
--     coach quota fails open on every request (silently unenforced).
--   * the lessons seed rows.
--
-- Idempotent: safe to run on installs that already have any of these.

begin;

-- 1. moves: engine analysis columns -------------------------------------------

alter table moves add column if not exists analysis_status text not null default 'unavailable';
alter table moves add column if not exists engine_depth integer;
alter table moves add column if not exists engine_source text;
alter table moves add column if not exists eval_before integer;
alter table moves add column if not exists eval_after integer;
alter table moves add column if not exists eval_delta integer;
alter table moves add column if not exists mate_before integer;
alter table moves add column if not exists mate_after integer;
alter table moves add column if not exists best_move_uci text;
alter table moves add column if not exists best_move_san text;
alter table moves add column if not exists principal_variation jsonb not null default '[]'::jsonb;
alter table moves add column if not exists quality_key text;
alter table moves add column if not exists quality_label text;
alter table moves add column if not exists quality_reason text;

-- 2. Daily coach usage counters ------------------------------------------------

create table if not exists usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  coach_messages integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create or replace function increment_coach_usage(p_user_id uuid, p_day date)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into usage_daily (user_id, day, coach_messages)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day)
  do update set coach_messages = usage_daily.coach_messages + 1, updated_at = now()
  returning coach_messages;
$$;

revoke all on function increment_coach_usage(uuid, date) from public, anon, authenticated;

alter table usage_daily enable row level security;
revoke all on usage_daily from anon, authenticated;

-- 3. Lessons seed ---------------------------------------------------------------

insert into lessons (id, title, category, level, summary, concepts)
values
  ('loose-pieces', 'Loose pieces', 'hanging_piece', 'starter', 'Train undefended pieces before tactics begin.', '["undefended pieces", "attacked pieces", "candidate moves"]'::jsonb),
  ('checks-captures-threats', 'Checks, captures, threats', 'candidate_moves', 'starter', 'Build the habit of scanning forcing moves first.', '["checks", "captures", "threats"]'::jsonb),
  ('opening-principles', 'Opening principles', 'opening_principle', 'starter', 'Develop pieces, contest the center, and castle before launching side plans.', '["development", "center", "king safety"]'::jsonb),
  ('king-safety', 'King safety', 'king_safety', 'starter', 'Reduce king exposure before calculating attacks.', '["castling", "open files", "king shelter"]'::jsonb),
  ('trade-quality', 'Trade quality', 'poor_trade', 'starter', 'Evaluate what remains after captures and recaptures.', '["piece value", "recapture", "simplification"]'::jsonb)
on conflict (id) do nothing;

commit;
