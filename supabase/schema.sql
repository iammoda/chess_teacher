-- Personal Chess Teacher schema (multi-tenant).
-- Fresh installs: run this file once in the Supabase SQL editor.
-- Existing installs: run supabase/migrations/*.sql in order instead.
--
-- Access model: the browser NEVER talks to the database. The Node server is
-- the only client, using the service role key. RLS is enabled with no
-- policies and all grants are revoked from anon/authenticated, so leaked
-- publishable keys cannot read or write anything.

create extension if not exists "pgcrypto";

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  player_color text not null check (player_color in ('w', 'b')),
  engine_level integer not null default 5,
  result text not null default 'in_progress',
  opening_name text,
  opening_key text,
  pgn text,
  status text not null default 'in_progress',
  created_at timestamptz not null default now()
);

create table if not exists moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  ply integer not null,
  role text not null check (role in ('player', 'engine')),
  color text not null check (color in ('w', 'b')),
  san text not null,
  uci text not null,
  piece text not null,
  captured text,
  fen_before text not null,
  fen_after text not null,
  classification text not null default 'neutral',
  tags jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

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

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  move_id uuid references moves(id) on delete set null,
  fen text not null,
  phase text not null,
  category text not null,
  tags jsonb not null default '[]'::jsonb,
  prompt text,
  best_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists weaknesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  category text not null,
  label text not null,
  count integer not null default 0,
  severity integer not null default 1,
  last_seen timestamptz not null default now(),
  examples jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint weaknesses_user_category_key unique (user_id, category)
);

create table if not exists weakness_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  move_id uuid references moves(id) on delete set null,
  category text not null,
  label text not null,
  severity integer not null default 1,
  fen text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists lessons (
  id text primary key,
  title text not null,
  category text not null,
  level text not null default 'starter',
  summary text not null,
  concepts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  lesson_id text references lessons(id) on delete set null,
  source_position_id uuid references positions(id) on delete set null,
  fen text not null,
  prompt text not null,
  category text not null,
  target_moves jsonb not null default '[]'::jsonb,
  difficulty integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  exercise_id uuid references exercises(id) on delete set null,
  source_key text,
  fen text not null,
  chosen_move text,
  expected_moves jsonb not null default '[]'::jsonb,
  result text not null check (result in ('solved', 'missed', 'skipped')),
  created_at timestamptz not null default now()
);

create table if not exists reasoning_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  game_id uuid,
  ply integer,
  fen text,
  san text,
  question text,
  answer text,
  coach_takeaway text,
  created_at timestamptz not null default now()
);

create table if not exists coach_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  note text not null,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists skill_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  dimension text not null,
  rating integer,
  perf real,
  samples integer not null default 0,
  confidence real not null default 0,
  updated_at timestamptz not null default now(),
  constraint skill_ratings_user_dimension_key unique (user_id, dimension)
);

create table if not exists repertoire_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  line_id text not null,
  opening_id text,
  ease real not null default 2.5,
  interval_days integer not null default 0,
  due_at timestamptz,
  reps integer not null default 0,
  lapses integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint repertoire_progress_user_line_key unique (user_id, line_id)
);

create index if not exists games_user_id_idx               on games(user_id);
create index if not exists moves_user_id_idx               on moves(user_id);
create index if not exists moves_game_id_idx               on moves(game_id);
create index if not exists positions_user_id_idx           on positions(user_id);
create index if not exists weaknesses_user_id_idx          on weaknesses(user_id);
create index if not exists weakness_events_user_id_idx     on weakness_events(user_id);
create index if not exists practice_attempts_user_id_idx   on practice_attempts(user_id);
create index if not exists reasoning_traces_user_id_idx    on reasoning_traces(user_id);
create index if not exists coach_memory_user_id_idx        on coach_memory(user_id);
create index if not exists skill_ratings_user_id_idx       on skill_ratings(user_id);
create index if not exists repertoire_progress_user_id_idx on repertoire_progress(user_id);

-- Per-user daily usage counters (coach messages today; billing-ready).
-- Server-mediated only, like everything else: the browser never touches it.
create table if not exists usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  coach_messages integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Atomic increment-and-read so the coach quota check is one round trip and
-- two concurrent requests can never lose an update.
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

-- Lock everything down: service-role-only access.
alter table games               enable row level security;
alter table moves               enable row level security;
alter table positions           enable row level security;
alter table weaknesses          enable row level security;
alter table weakness_events     enable row level security;
alter table lessons             enable row level security;
alter table exercises           enable row level security;
alter table practice_attempts   enable row level security;
alter table reasoning_traces    enable row level security;
alter table coach_memory        enable row level security;
alter table skill_ratings       enable row level security;
alter table repertoire_progress enable row level security;
alter table usage_daily         enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

insert into lessons (id, title, category, level, summary, concepts)
values
  ('loose-pieces', 'Loose pieces', 'hanging_piece', 'starter', 'Train undefended pieces before tactics begin.', '["undefended pieces", "attacked pieces", "candidate moves"]'::jsonb),
  ('checks-captures-threats', 'Checks, captures, threats', 'candidate_moves', 'starter', 'Build the habit of scanning forcing moves first.', '["checks", "captures", "threats"]'::jsonb),
  ('opening-principles', 'Opening principles', 'opening_principle', 'starter', 'Develop pieces, contest the center, and castle before launching side plans.', '["development", "center", "king safety"]'::jsonb),
  ('king-safety', 'King safety', 'king_safety', 'starter', 'Reduce king exposure before calculating attacks.', '["castling", "open files", "king shelter"]'::jsonb),
  ('trade-quality', 'Trade quality', 'poor_trade', 'starter', 'Evaluate what remains after captures and recaptures.', '["piece value", "recapture", "simplification"]'::jsonb)
on conflict (id) do nothing;
