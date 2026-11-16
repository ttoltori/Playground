export interface LevelDef {
  id: number;
  name: string;
  title: string;
  desc: string;
  pallets: number;
  cones: number;
  oil: number;
  agvs: number;
  agvSpeed: number;
  barrelLanes: number;
  doors: boolean;
  doorPeriod: number;
  trucks: number; // number of delivery zones that are truck beds (raised)
  fragile: number;
  cranes: number;
  night: boolean;
  medals: [number, number, number]; // gold, silver, bronze seconds
}

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: '신입',
    title: '입사 첫날',
    desc: '팔레트 3개. 라바콘 몇 개뿐. 지게차랑 친해지는 날.',
    pallets: 3, cones: 10, oil: 0, agvs: 0, agvSpeed: 2.5, barrelLanes: 0,
    doors: false, doorPeriod: 8, trucks: 0, fragile: 0, cranes: 0, night: false,
    medals: [75, 110, 160],
  },
  {
    id: 2,
    name: '정규직',
    title: '정규직 전환 심사',
    desc: '팔레트 4개. 기름 웅덩이, 자율주행 AGV 등장. 트럭 상차 1건.',
    pallets: 4, cones: 16, oil: 3, agvs: 3, agvSpeed: 3, barrelLanes: 0,
    doors: false, doorPeriod: 8, trucks: 1, fragile: 0, cranes: 0, night: false,
    medals: [110, 160, 230],
  },
  {
    id: 3,
    name: '반장',
    title: '반장님의 시험',
    desc: '팔레트 5개. 위스키(깨짐주의!), 굴러오는 드럼통, 셔터문, 크레인.',
    pallets: 5, cones: 20, oil: 5, agvs: 4, agvSpeed: 3.5, barrelLanes: 2,
    doors: true, doorPeriod: 7, trucks: 2, fragile: 2, cranes: 1, night: false,
    medals: [150, 210, 300],
  },
  {
    id: 4,
    name: '공장장',
    title: '야간 특근: 전설의 공장장',
    desc: '팔레트 6개. 한밤중 헤드라이트 하나로 모든 지옥을 통과하라.',
    pallets: 6, cones: 26, oil: 7, agvs: 6, agvSpeed: 4.2, barrelLanes: 3,
    doors: true, doorPeriod: 6, trucks: 3, fragile: 3, cranes: 2, night: true,
    medals: [190, 260, 360],
  },
];

export const PENALTY = {
  cone: 2,
  crash: 1,
  drop: 5,
  breakFragile: 15,
};

/** style points -> seconds conversion */
export const STYLE_PER_SECOND = 100;
