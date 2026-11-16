-- 점수형(높을수록 좋은) 미니게임 지원: time_ms 컬럼에 점수(예: 비행거리 cm)를 저장하므로 범위 제한을 완화
alter table public.game_scores drop constraint if exists game_scores_time_ms_check;
alter table public.game_scores add constraint game_scores_time_ms_check check (time_ms between 0 and 100000000);
