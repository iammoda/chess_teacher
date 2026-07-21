-- 001_multi_tenant.sql
-- Converts the single-user schema to a multi-tenant, service-role-only model.
--
-- After this migration:
--   * Every user-data table has a user_id column referencing auth.users.
--   * Per-user uniqueness replaces the old single-user unique keys
--     (weaknesses.category, skill_ratings.dimension, repertoire_progress.line_id).
--   * Row Level Security is enabled on every table with NO policies, and all
--     grants are revoked from anon/authenticated. Only the service role (used
--     exclusively by the Node server) can read or write. The browser never
--     talks to PostgREST anymore.
--
-- Run this once in the Supabase SQL editor (or psql via DATABASE_URL).

begin;

-- 1. user_id on every user-data table -----------------------------------------

alter table games               add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table moves               add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table positions           add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table weaknesses          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table weakness_events     add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table exercises           add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table practice_attempts   add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table reasoning_traces    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table coach_memory        add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table skill_ratings       add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table repertoire_progress add column if not exists user_id uuid references auth.users(id) on delete cascade;

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

-- 2. Per-user uniqueness -------------------------------------------------------
-- Legacy rows keep user_id NULL; Postgres treats NULLs as distinct in unique
-- constraints, so old single-user rows do not collide with the new keys.

alter table weaknesses drop constraint if exists weaknesses_category_key;
alter table weaknesses drop constraint if exists weaknesses_user_category_key;
alter table weaknesses add constraint weaknesses_user_category_key unique (user_id, category);

-- skill_ratings: primary key was (dimension); replace with surrogate id +
-- unique (user_id, dimension).
alter table skill_ratings drop constraint if exists skill_ratings_pkey;
alter table skill_ratings add column if not exists id uuid not null default gen_random_uuid();
alter table skill_ratings add primary key (id);
alter table skill_ratings drop constraint if exists skill_ratings_user_dimension_key;
alter table skill_ratings add constraint skill_ratings_user_dimension_key unique (user_id, dimension);

-- repertoire_progress: primary key was (line_id); replace with surrogate id +
-- unique (user_id, line_id).
alter table repertoire_progress drop constraint if exists repertoire_progress_pkey;
alter table repertoire_progress add column if not exists id uuid not null default gen_random_uuid();
alter table repertoire_progress add primary key (id);
alter table repertoire_progress drop constraint if exists repertoire_progress_user_line_key;
alter table repertoire_progress add constraint repertoire_progress_user_line_key unique (user_id, line_id);

-- 3. Lock the schema down ------------------------------------------------------
-- RLS with no policies denies anon/authenticated entirely; the service role
-- bypasses RLS. Grants are revoked as defense in depth.

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

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

commit;

-- 4. Optional: claim legacy single-user rows -----------------------------------
-- If you want the pre-auth development data to belong to your new account,
-- sign up first, find your user id (select id, email from auth.users;), then:
--
-- update games               set user_id = '<your-user-id>' where user_id is null;
-- update moves               set user_id = '<your-user-id>' where user_id is null;
-- update positions           set user_id = '<your-user-id>' where user_id is null;
-- update weaknesses          set user_id = '<your-user-id>' where user_id is null;
-- update weakness_events     set user_id = '<your-user-id>' where user_id is null;
-- update practice_attempts   set user_id = '<your-user-id>' where user_id is null;
-- update reasoning_traces    set user_id = '<your-user-id>' where user_id is null;
-- update coach_memory        set user_id = '<your-user-id>' where user_id is null;
-- update skill_ratings       set user_id = '<your-user-id>' where user_id is null;
-- update repertoire_progress set user_id = '<your-user-id>' where user_id is null;
