-- Durable rate limiting.
--
-- The server's sliding-window limiter is in-memory, which is meaningless on
-- serverless deployments (every cold start / concurrent instance gets a fresh
-- map). This fixed-window counter gives the expensive buckets (coach, account,
-- health) a durable, cross-instance budget. The server still keeps its
-- in-memory limiter as a first, free line of defense.

create table if not exists rate_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Atomically bumps the caller's counter for the current fixed window and
-- returns the new count. Also prunes the key's stale windows so the table
-- never accumulates unbounded rows.
create or replace function increment_rate_counter(p_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  delete from rate_counters
  where key = p_key
    and window_start < now() - make_interval(secs => p_window_seconds * 2);

  insert into rate_counters (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
  do update set count = rate_counters.count + 1
  returning count into v_count;

  return v_count;
end;
$$;

revoke all on function increment_rate_counter(text, integer) from public, anon, authenticated;

alter table rate_counters enable row level security;
revoke all on rate_counters from anon, authenticated;
