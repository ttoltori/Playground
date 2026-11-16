-- 지게차 러시 리더보드
create table if not exists public.forklift_scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  nickname    text not null check (char_length(nickname) between 1 and 16),
  level       smallint not null check (level between 1 and 4),
  time_ms     integer not null check (time_ms between 5000 and 3600000),
  raw_ms      integer not null check (raw_ms between 5000 and 3600000),
  penalty_ms  integer not null default 0 check (penalty_ms >= 0),
  bonus_ms    integer not null default 0 check (bonus_ms >= 0),
  style       integer not null default 0 check (style >= 0),
  client_id   text not null check (char_length(client_id) <= 64)
);

create index if not exists forklift_scores_level_time_idx on public.forklift_scores (level, time_ms);

alter table public.forklift_scores enable row level security;

drop policy if exists "scores are public" on public.forklift_scores;
create policy "scores are public" on public.forklift_scores
  for select to anon, authenticated using (true);

drop policy if exists "anyone can submit" on public.forklift_scores;
create policy "anyone can submit" on public.forklift_scores
  for insert to anon, authenticated
  with check (time_ms >= raw_ms * 0.5 and time_ms <= raw_ms + penalty_ms);

-- 1:1 온라인 대전은 Supabase Realtime(broadcast/presence)만 사용하므로 별도 테이블이 필요 없습니다.
