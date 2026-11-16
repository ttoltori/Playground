-- 놀이터 공용 미니게임 리더보드 (포크레인, 타워크레인, 덤프트럭 ...)
create table if not exists public.game_scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  game        text not null check (game ~ '^[a-z0-9_-]{1,24}$'),
  nickname    text not null check (char_length(nickname) between 1 and 16),
  level       smallint not null check (level between 1 and 9),
  time_ms     integer not null check (time_ms between 3000 and 3600000),
  client_id   text not null check (char_length(client_id) <= 64)
);
create index if not exists game_scores_idx on public.game_scores (game, level, time_ms);
alter table public.game_scores enable row level security;
drop policy if exists "game scores are public" on public.game_scores;
create policy "game scores are public" on public.game_scores for select to anon, authenticated using (true);
drop policy if exists "anyone can submit game score" on public.game_scores;
create policy "anyone can submit game score" on public.game_scores for insert to anon, authenticated with check (true);
