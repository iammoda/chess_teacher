create extension if not exists "pgcrypto";

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
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
  category text not null unique,
  label text not null,
  count integer not null default 0,
  severity integer not null default 1,
  last_seen timestamptz not null default now(),
  examples jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists weakness_events (
  id uuid primary key default gen_random_uuid(),
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
  exercise_id uuid references exercises(id) on delete set null,
  source_key text,
  fen text not null,
  chosen_move text,
  expected_moves jsonb not null default '[]'::jsonb,
  result text not null check (result in ('solved', 'missed', 'skipped')),
  created_at timestamptz not null default now()
);

insert into lessons (id, title, category, level, summary, concepts)
values
  ('loose-pieces', 'Loose pieces', 'hanging_piece', 'starter', 'Train undefended pieces before tactics begin.', '["undefended pieces", "attacked pieces", "candidate moves"]'::jsonb),
  ('checks-captures-threats', 'Checks, captures, threats', 'candidate_moves', 'starter', 'Build the habit of scanning forcing moves first.', '["checks", "captures", "threats"]'::jsonb),
  ('opening-principles', 'Opening principles', 'opening_principle', 'starter', 'Develop pieces, contest the center, and castle before launching side plans.', '["development", "center", "king safety"]'::jsonb),
  ('king-safety', 'King safety', 'king_safety', 'starter', 'Reduce king exposure before calculating attacks.', '["castling", "open files", "king shelter"]'::jsonb),
  ('trade-quality', 'Trade quality', 'poor_trade', 'starter', 'Evaluate what remains after captures and recaptures.', '["piece value", "recapture", "simplification"]'::jsonb)
on conflict (id) do nothing;
