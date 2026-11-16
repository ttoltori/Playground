import type { Setup } from './parts';

export interface LevelInfo {
  name: string;
  title: string;
  desc: string;
  medals: [number, number, number];
  rival: { name: string; setup: Setup };
}

export const ATTEMPTS = 3;

// medals / rival are filled from the setup sweep (see report); seconds = total of 3 laps
export const LEVEL_INFO: LevelInfo[] = [
  {
    name: '문방구 앞 오벌', title: '동네 꼬마 대회', desc: '완만한 타원 코스에 차선 변경 한 번. 기본기부터.',
    medals: [33.5, 36.5, 42],
    rival: { name: '문방구집 아들 준호', setup: { motor: 0, gear: 2, tire: 0, roller: 0, weight: 0, battery: 0 } },
  },
  {
    name: '옥상 테크니컬', title: '옥상 비밀 결투', desc: '웨이브, 슬로프 점프, 그리고 헤어핀. 아슬아슬하게.',
    medals: [32.5, 35, 40],
    rival: { name: '옥상 라이벌 상철', setup: { motor: 0, gear: 2, tire: 1, roller: 1, weight: 3, battery: 2 } },
  },
  {
    name: '전국대회 결승', title: '전국 미니카 결승전', desc: '긴 직선 끝 급커브, 빅 점프, 오르막, 시케인. 한계를 찔러라.',
    medals: [52, 56, 66],
    rival: { name: '전국 챔피언 한박사', setup: { motor: 0, gear: 1, tire: 0, roller: 1, weight: 0, battery: 0 } },
  },
];
