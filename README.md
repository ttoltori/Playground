# PLAYGROUND · 어른이 놀이터

퇴근 후 10분, 남자들의 장난감 상자. 첫 번째 게임은 **🚜 지게차 러시(Forklift Rush)**.

Vite + TypeScript + Three.js 로 만든 웹 게임이고, Vercel에 정적 배포 + Supabase(리더보드 DB, 실시간 대전)를 씁니다.

## 지게차 러시

A동 출고창고의 팔레트를 들어서 B동 입고창고의 DROP 구역(또는 트럭 짐칸)에 내려놓는 타임어택.

| 모드 | 설명 |
|---|---|
| ⏱️ 1인 타임어택 | 최종기록 = 주행시간 + 페널티 − 스타일 보너스. 리더보드에 개인 최고기록 등록 |
| 👥 2인 로컬 대전 | 한 화면 분할 (키보드/게임패드). 같은 맵, 같은 팔레트 쟁탈. 들이받기 허용 |
| 🌐 2인 온라인 대전 | 4자리 방 코드 / 초대 링크. 같은 시드의 맵·장애물로 대결, 과반 먼저 입고하면 승리 |

**난이도**: LV1 신입 → LV2 정규직(기름 웅덩이, AGV, 트럭 상차) → LV3 반장(🥃 깨지는 위스키, 굴러오는 드럼통, 셔터문, 크레인) → LV4 공장장(야간, 헤드라이트만으로 전부).

**재미 요소**: 뒷바퀴 조향(꼬리 스윙), 짐 높이에 따른 전복 위험, 드리프트, 🔥JUMP 램프 에어타임, AGV 니어미스, 칼각 입고, 라바콘 볼링, 상대 들이받아 화물 떨구기, 무전기 반장님 잔소리, 후진 삐삐음까지 전부 WebAudio 합성.

**시점**: 3인칭 / 1인칭(운전석) / 탑뷰 — `C` 키 또는 🎥 버튼.

**조작**: WASD/방향키 주행, R·E 포크↑, F·Q 포크↓, Shift 터보, Space 드리프트, H 경적 · 모바일은 가상 조이스틱 + 버튼 · 게임패드 지원.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # Supabase 키 (없어도 오프라인 모드로 동작)
npm run dev
```

## 배포 (Vercel + Supabase)

1. **Supabase**: 새 프로젝트 → SQL Editor 에서 `supabase/migrations/*.sql` 실행.
   Realtime 은 기본 활성화 상태면 추가 설정 없음.
2. **Vercel**: 이 리포지토리 Import → Framework `Vite` (자동 감지) →
   Environment Variables 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가 → Deploy.
3. 키가 없으면 리더보드는 기기 로컬 저장, 온라인 대전은 비활성화됩니다.

## 구조

```
src/
  main.ts                 # 놀이터 허브, 메뉴, 온라인 로비, 결과 화면
  platform/               # 게임 공용: Supabase 클라이언트, 프로필, 리더보드
  games/forklift/
    game.ts               # 루프, 물리, 픽업/입고, 카메라, 분할화면, 넷코드
    world.ts              # 시드 기반 맵 생성 + 장애물(시간의 순수함수 → 온라인 동기화)
    forklift.ts           # 지게차 모델(마스트 텔레스코픽, 뒷바퀴 조향)
    levels.ts lines.ts    # 난이도 정의, 반장님 대사
    input.ts audio.ts hud.ts particles.ts online.ts collide.ts
supabase/migrations/      # DB 스키마
```

## 성인 놀이터로 확장 로드맵

- **계정**: Supabase Auth(카카오/구글) → `profiles` 테이블, 닉네임 중복 방지, 리더보드 위조 방지(Edge Function 에서 리플레이 검증)
- **게임 추가**: `src/games/<name>` 에 같은 패턴으로 추가, 허브 카드만 등록 (타워크레인 인형뽑기, 포크레인 볼링, 덤프트럭 후진주차 …)
- **소셜**: 주간 시즌 랭킹, 고스트 리플레이(내 최고기록과 경주), 친구 대전 전적, 크루(회사/동호회) 랭킹
- **수익화 여지**: 지게차 스킨/경적 사운드 꾸미기, 시즌 패스, 회사 회식용 대회 모드
- **멀티**: 현재 1:1 P2P 브로드캐스트 → 4인 난투는 호스트 권한 모델이나 Supabase Realtime + Edge 권한 서버로 확장
