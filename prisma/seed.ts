import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ============================================================
  // 1. 관리자 계정 생성
  // ============================================================
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const sitePasswordHash = await bcrypt.hash('site123', 10);
  const viewerPasswordHash = await bcrypt.hash('viewer123', 10);

  const superAdmin = await prisma.account.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminPasswordHash },
    create: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      name: '슈퍼관리자',
      email: 'admin@smombie.kr',
      phone: '010-1234-0000',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Super admin: admin / admin123');

  // ============================================================
  // 2. 조직 구조 생성 (회사 → 현장 → 부서/팀)
  // ============================================================
  const rootOrg = await prisma.organization.upsert({
    where: { id: 'org-1' },
    update: {},
    create: {
      id: 'org-1',
      name: '스마트건설 주식회사',
      type: 'company',
    },
  });

  // 현장 3곳
  const siteConfigs = [
    { id: 'org-2', name: '서울 본사', type: 'site' as const },
    { id: 'org-5', name: '판교 현장', type: 'site' as const },
    { id: 'org-8', name: '인천 물류센터', type: 'site' as const },
  ];
  const sites: any[] = [];
  for (const s of siteConfigs) {
    sites.push(
      await prisma.organization.upsert({
        where: { id: s.id },
        update: {},
        create: { id: s.id, name: s.name, type: s.type, parentId: rootOrg.id },
      }),
    );
  }

  // 부서 / 팀 / 현장조
  const deptConfigs = [
    { id: 'org-3', name: '경영지원부', type: 'department' as const, parentId: 'org-2' },
    { id: 'org-4', name: '안전관리부', type: 'department' as const, parentId: 'org-2' },
    { id: 'org-6', name: 'A동 건설팀', type: 'field' as const, parentId: 'org-5' },
    { id: 'org-7', name: 'B동 건설팀', type: 'field' as const, parentId: 'org-5' },
    { id: 'org-9', name: '배송1팀', type: 'team' as const, parentId: 'org-8' },
    { id: 'org-10', name: '배송2팀', type: 'team' as const, parentId: 'org-8' },
    { id: 'org-11', name: '창고관리팀', type: 'team' as const, parentId: 'org-8' },
  ];
  for (const d of deptConfigs) {
    await prisma.organization.upsert({
      where: { id: d.id },
      update: {},
      create: { id: d.id, name: d.name, type: d.type, parentId: d.parentId },
    });
  }
  console.log('✅ Organizations: 11개 (본사 + 현장 3 + 부서/팀 7)');

  // 현장 관리자 계정
  const siteAdmin = await prisma.account.upsert({
    where: { username: 'site1' },
    update: { passwordHash: sitePasswordHash, organizationId: 'org-5' },
    create: {
      username: 'site1',
      passwordHash: sitePasswordHash,
      name: '판교현장관리자',
      email: 'site1@smombie.kr',
      phone: '010-2345-0000',
      role: 'SITE_ADMIN',
      organizationId: 'org-5',
      status: 'ACTIVE',
    },
  });

  const siteAdmin2 = await prisma.account.upsert({
    where: { username: 'site2' },
    update: { passwordHash: sitePasswordHash, organizationId: 'org-8' },
    create: {
      username: 'site2',
      passwordHash: sitePasswordHash,
      name: '인천현장관리자',
      email: 'site2@smombie.kr',
      phone: '010-3456-0000',
      role: 'SITE_ADMIN',
      organizationId: 'org-8',
      status: 'ACTIVE',
    },
  });

  const viewer = await prisma.account.upsert({
    where: { username: 'viewer1' },
    update: { passwordHash: viewerPasswordHash },
    create: {
      username: 'viewer1',
      passwordHash: viewerPasswordHash,
      name: '조회자',
      email: 'viewer@smombie.kr',
      phone: '010-4567-0000',
      role: 'VIEWER',
      organizationId: 'org-2',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Site admin: site1 / site123 (판교 현장)');
  console.log('✅ Site admin: site2 / site123 (인천 물류센터)');
  console.log('✅ Viewer: viewer1 / viewer123');

  // ============================================================
  // 3. 근무 유형 생성 (15개 — 조직별 다양한 유형)
  // ============================================================
  const wtConfigs = [
    { id: 'wt-1', name: '건설 작업자', desc: '일반 건설 현장 작업', orgId: 'org-5' },
    { id: 'wt-2', name: '안전 관리자', desc: '안전 관리 및 순찰', orgId: 'org-5' },
    { id: 'wt-3', name: '크레인 오퍼레이터', desc: '크레인 장비 운전', orgId: 'org-5' },
    { id: 'wt-4', name: '배송 기사', desc: '물류 배송 차량 운전', orgId: 'org-8' },
    { id: 'wt-5', name: '창고 관리', desc: '물류 창고 관리 및 포크리프트', orgId: 'org-8' },
    { id: 'wt-6', name: '사무직', desc: '사무실 근무', orgId: 'org-2' },
    { id: 'wt-7', name: '경영지원', desc: '경영지원부 전용', orgId: 'org-3' },
    { id: 'wt-8', name: '안전관리부', desc: '안전관리부 전용', orgId: 'org-4' },
    { id: 'wt-9', name: 'A동 철근 작업자', desc: 'A동 철근 용접 및 조립', orgId: 'org-6' },
    { id: 'wt-10', name: 'A동 거푸집 작업자', desc: 'A동 거푸집 설치/해체', orgId: 'org-6' },
    { id: 'wt-11', name: 'B동 콘크리트 작업자', desc: 'B동 콘크리트 타설', orgId: 'org-7' },
    { id: 'wt-12', name: 'B동 마감 작업자', desc: 'B동 내외부 마감', orgId: 'org-7' },
    { id: 'wt-13', name: '배송1팀 운전', desc: '배송1팀 차량 운행', orgId: 'org-9' },
    { id: 'wt-14', name: '배송2팀 운전', desc: '배송2팀 차량 운행', orgId: 'org-10' },
    { id: 'wt-15', name: '창고 피킹', desc: '창고 피킹 및 포장', orgId: 'org-11' },
  ];
  const workTypes: any[] = [];
  for (const wt of wtConfigs) {
    workTypes.push(
      await prisma.workType.upsert({
        where: { id: wt.id },
        update: {},
        create: { id: wt.id, name: wt.name, description: wt.desc, organizationId: wt.orgId, isActive: true },
      }),
    );
  }
  console.log('✅ Work types:', workTypes.length, '개');

  // ============================================================
  // 4. 직원 생성 (55명: 핵심 5명 + 대량 50명)
  // ============================================================
  const coreEmpConfigs = [
    { id: 'emp-1', employeeId: 'EMP-001', name: '김철수', orgId: 'org-6', siteId: 'org-5', pos: '현장 작업자', role: '크레인 오퍼레이터', wtId: 'wt-3', status: 'ACTIVE' as const, phone: '010-1234-5678', email: 'kim.cs@smartconstruction.com', hire: '2024-01-15' },
    { id: 'emp-2', employeeId: 'EMP-002', name: '이영희', orgId: 'org-4', siteId: 'org-2', pos: '안전 관리자', role: '현장 안전 감독', wtId: 'wt-8', status: 'ACTIVE' as const, phone: '010-2345-6789', email: 'lee.yh@smartconstruction.com', hire: '2023-06-10' },
    { id: 'emp-3', employeeId: 'EMP-003', name: '박민수', orgId: 'org-9', siteId: 'org-8', pos: '배송 기사', role: '화물차 운전', wtId: 'wt-13', status: 'ACTIVE' as const, phone: '010-3456-7890', email: 'park.ms@smartconstruction.com', hire: '2023-03-22' },
    { id: 'emp-4', employeeId: 'EMP-004', name: '최지은', orgId: 'org-3', siteId: 'org-2', pos: '부장', role: '총무팀장', wtId: 'wt-7', status: 'ACTIVE' as const, phone: '010-4567-8901', email: 'choi.je@smartconstruction.com', hire: '2020-01-05' },
    { id: 'emp-5', employeeId: 'EMP-005', name: '정현우', orgId: 'org-7', siteId: 'org-5', pos: '현장 작업자', role: '철근 작업', wtId: 'wt-11', status: 'EXCEPTION' as const, phone: '010-5678-9012', email: 'jung.hw@smartconstruction.com', hire: '2023-08-14' },
  ];

  const employees: any[] = [];
  for (const emp of coreEmpConfigs) {
    employees.push(
      await prisma.employee.upsert({
        where: { id: emp.id },
        update: {},
        create: {
          id: emp.id,
          employeeId: emp.employeeId,
          name: emp.name,
          organizationId: emp.orgId,
          siteId: emp.siteId,
          position: emp.pos,
          role: emp.role,
          workTypeId: emp.wtId,
          status: emp.status,
          phone: emp.phone,
          email: emp.email,
          hireDate: new Date(emp.hire),
        },
      }),
    );
  }

  // 대량 직원 50명
  const orgAssign: { orgId: string; siteId: string; wtIds: string[] }[] = [
    { orgId: 'org-6', siteId: 'org-5', wtIds: ['wt-1', 'wt-9', 'wt-10'] },
    { orgId: 'org-7', siteId: 'org-5', wtIds: ['wt-1', 'wt-11', 'wt-12'] },
    { orgId: 'org-9', siteId: 'org-8', wtIds: ['wt-4', 'wt-13'] },
    { orgId: 'org-10', siteId: 'org-8', wtIds: ['wt-4', 'wt-14'] },
    { orgId: 'org-11', siteId: 'org-8', wtIds: ['wt-5', 'wt-15'] },
  ];
  const names50 = [
    '강동원','장혜진','송중기','전지현','유재석','강호동','이광수','송지효','전소민','하하',
    '김종국','지석진','양세찬','오미란','박서준','김수현','이민호','공유','조인성','현빈',
    '손예진','전도연','김태리','수지','아이유','배수지','임시완','남주혁','이종석','박보검',
    '서강준','안효섭','차은우','로운','김선호','송강','이도현','위하준','변우석','마동석',
    '이정재','황정민','류승룡','정해인','강하늘','유아인','이제훈','김우빈','조정석','박형식',
  ];
  const positions = ['현장 작업자', '배송 기사', '창고 관리자', '기술자', '반장'];
  const roleNames = ['크레인 오퍼레이터', '화물차 운전', '포크리프트 운전', '철근 작업', '용접공', '타일공', '배관공', '전기공'];
  const empStatuses: ('ACTIVE' | 'LEAVE' | 'EXCEPTION' | 'RESIGNED')[] = [
    'ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','LEAVE','EXCEPTION','RESIGNED',
  ];

  for (let i = 0; i < 50; i++) {
    const grp = orgAssign[i % orgAssign.length];
    const wtId = grp.wtIds[i % grp.wtIds.length];
    const mm = String((i % 12) + 1).padStart(2, '0');
    const dd = String((i % 28) + 1).padStart(2, '0');
    employees.push(
      await prisma.employee.upsert({
        where: { id: `emp-${i + 6}` },
        update: {},
        create: {
          id: `emp-${i + 6}`,
          employeeId: `EMP-${String(i + 6).padStart(3, '0')}`,
          name: names50[i],
          organizationId: grp.orgId,
          siteId: grp.siteId,
          position: positions[i % positions.length],
          role: roleNames[i % roleNames.length],
          workTypeId: wtId,
          status: empStatuses[i % empStatuses.length],
          phone: `010-${String(1100 + i).padStart(4, '0')}-${String(2200 + i * 3).padStart(4, '0')}`,
          email: `employee${i + 6}@smartconstruction.com`,
          hireDate: new Date(`2023-${mm}-${dd}`),
        },
      }),
    );
  }
  console.log('✅ Employees:', employees.length, '명');

  // 조직별 직원 수 업데이트
  const orgEmployeeCounts = new Map<string, number>();
  for (const emp of employees) {
    orgEmployeeCounts.set(emp.organizationId, (orgEmployeeCounts.get(emp.organizationId) || 0) + 1);
  }
  for (const [orgId, count] of orgEmployeeCounts) {
    await prisma.organization.update({ where: { id: orgId }, data: { employeeCount: count } });
  }
  // 근무유형별 직원 수 업데이트
  const wtEmployeeCounts = new Map<string, number>();
  for (const emp of employees) {
    if (emp.workTypeId) {
      wtEmployeeCounts.set(emp.workTypeId, (wtEmployeeCounts.get(emp.workTypeId) || 0) + 1);
    }
  }
  for (const [wtId, count] of wtEmployeeCounts) {
    await prisma.workType.update({ where: { id: wtId }, data: { employeeCount: count } });
  }
  console.log('✅ Employee counts updated (organizations & work types)');

  // ============================================================
  // 5. 디바이스 생성 (핵심 10개 + 대량 35개 = 45개)
  // ============================================================
  const coreDevConfigs: {
    id: string; devId: string; empId: string | null; orgId: string | null;
    os: 'Android' | 'iOS'; ver: string; model: string; mfr: string;
    status: 'NORMAL' | 'INACTIVE' | 'SUSPICIOUS' | 'NO_COMM';
    dStatus: 'IN_USE' | 'LOGGED_OUT' | 'LOST' | 'REPLACING' | 'UNASSIGNED' | 'PREVIOUS';
  }[] = [
    { id: 'dev-1', devId: 'AND-12345678', empId: 'emp-1', orgId: 'org-6', os: 'Android', ver: '14', model: 'Galaxy S24', mfr: 'Samsung', status: 'NORMAL', dStatus: 'IN_USE' },
    { id: 'dev-1b', devId: 'AND-11111111', empId: 'emp-1', orgId: 'org-6', os: 'Android', ver: '12', model: 'Galaxy S20', mfr: 'Samsung', status: 'INACTIVE', dStatus: 'PREVIOUS' },
    { id: 'dev-2', devId: 'IOS-87654321', empId: 'emp-2', orgId: 'org-4', os: 'iOS', ver: '17', model: 'iPhone 15', mfr: 'Apple', status: 'NORMAL', dStatus: 'IN_USE' },
    { id: 'dev-3', devId: 'AND-11223344', empId: 'emp-3', orgId: 'org-9', os: 'Android', ver: '13', model: 'Galaxy S23', mfr: 'Samsung', status: 'NORMAL', dStatus: 'IN_USE' },
    { id: 'dev-3b', devId: 'AND-33333333', empId: 'emp-3', orgId: 'org-9', os: 'Android', ver: '10', model: 'Galaxy S20', mfr: 'Samsung', status: 'INACTIVE', dStatus: 'PREVIOUS' },
    { id: 'dev-3c', devId: 'AND-44444444', empId: 'emp-3', orgId: 'org-9', os: 'Android', ver: '9', model: 'Galaxy A50', mfr: 'Samsung', status: 'SUSPICIOUS', dStatus: 'LOST' },
    { id: 'dev-4', devId: 'IOS-99887766', empId: 'emp-4', orgId: 'org-3', os: 'iOS', ver: '17', model: 'iPhone 15 Pro', mfr: 'Apple', status: 'NORMAL', dStatus: 'IN_USE' },
    { id: 'dev-5', devId: 'AND-55667788', empId: null, orgId: null, os: 'Android', ver: '11', model: 'Galaxy S21', mfr: 'Samsung', status: 'SUSPICIOUS', dStatus: 'UNASSIGNED' },
    { id: 'dev-6', devId: 'AND-66778899', empId: 'emp-2', orgId: 'org-4', os: 'Android', ver: '13', model: 'Galaxy Tab S9', mfr: 'Samsung', status: 'NORMAL', dStatus: 'IN_USE' },
    { id: 'dev-7', devId: 'IOS-55443322', empId: 'emp-5', orgId: 'org-7', os: 'iOS', ver: '16', model: 'iPhone 14', mfr: 'Apple', status: 'NORMAL', dStatus: 'IN_USE' },
  ];

  const devices: any[] = [];
  for (const d of coreDevConfigs) {
    devices.push(
      await prisma.device.upsert({
        where: { id: d.id },
        update: {},
        create: {
          id: d.id,
          deviceId: d.devId,
          employeeId: d.empId,
          organizationId: d.orgId,
          os: d.os,
          osVersion: d.ver,
          model: d.model,
          manufacturer: d.mfr,
          status: d.status,
          deviceStatus: d.dStatus,
          appVersion: '2.5.3',
          lastCommunication: d.status === 'NORMAL' ? new Date(Date.now() - Math.random() * 3600000) : new Date(Date.now() - 60 * 86400000),
          registeredAt: new Date(Date.now() - Math.random() * 180 * 86400000),
        },
      }),
    );
  }

  // 대량 디바이스 35개
  const devModels = ['Galaxy S24','Galaxy S23','Galaxy S22','Galaxy A54','iPhone 15','iPhone 14','iPhone 13','Pixel 8'];
  const devMfrs = ['Samsung','Samsung','Samsung','Samsung','Apple','Apple','Apple','Google'];
  const devOrgIds = ['org-6','org-7','org-9','org-10','org-11'];
  for (let i = 0; i < 35; i++) {
    const isAndroid = i % 3 !== 2;
    const empIdx = (i % 45) + 6; // emp-6 ~ emp-50
    const empId = `emp-${empIdx}`;
    const devStat: 'NORMAL' | 'INACTIVE' | 'NO_COMM' = i < 28 ? 'NORMAL' : (i < 32 ? 'INACTIVE' : 'NO_COMM');
    const opStat: 'IN_USE' | 'LOGGED_OUT' | 'REPLACING' | 'UNASSIGNED' = i < 28 ? 'IN_USE' : (i < 30 ? 'LOGGED_OUT' : (i < 32 ? 'REPLACING' : 'UNASSIGNED'));
    devices.push(
      await prisma.device.upsert({
        where: { id: `dev-g${i + 1}` },
        update: {},
        create: {
          id: `dev-g${i + 1}`,
          deviceId: `${isAndroid ? 'AND' : 'IOS'}-G${String(i + 100).padStart(6, '0')}`,
          employeeId: empId,
          organizationId: devOrgIds[i % devOrgIds.length],
          os: isAndroid ? 'Android' : 'iOS',
          osVersion: isAndroid ? '14' : '17',
          model: devModels[i % devModels.length],
          manufacturer: devMfrs[i % devMfrs.length],
          status: devStat,
          deviceStatus: opStat,
          appVersion: ['2.5.3','2.5.2','2.5.1','2.4.0'][i % 4],
          lastCommunication: new Date(Date.now() - i * 30 * 60000),
          registeredAt: new Date(Date.now() - (i + 10) * 86400000),
        },
      }),
    );
  }
  console.log('✅ Devices:', devices.length, '개');

  // ============================================================
  // 6. 구역 생성 (22개 — 목업 데이터 기반)
  // ============================================================
  const zoneConfigs: {
    id: string; name: string; type: 'danger' | 'normal' | 'work' | 'safe';
    shape: 'circle' | 'polygon'; coords: { lat: number; lng: number }[];
    radius?: number; desc: string; orgId: string;
  }[] = [
    // 판교 현장 (org-5)
    { id: 'zone-1', name: '판교 크레인 작업 구역', type: 'danger', shape: 'circle', coords: [{ lat: 37.4012, lng: 127.1081 }], radius: 50, desc: '크레인 작업 시 위험 구역. 스마트폰 사용 절대 금지', orgId: 'org-5' },
    { id: 'zone-2', name: '판교 고압선 구역', type: 'danger', shape: 'polygon', coords: [{ lat: 37.4015, lng: 127.1075 },{ lat: 37.4018, lng: 127.1075 },{ lat: 37.4018, lng: 127.108 },{ lat: 37.4015, lng: 127.108 }], desc: '고압선 근처 위험 구역', orgId: 'org-5' },
    { id: 'zone-3', name: '판교 철근 작업 구역', type: 'danger', shape: 'polygon', coords: [{ lat: 37.402, lng: 127.1075 },{ lat: 37.4023, lng: 127.1075 },{ lat: 37.4023, lng: 127.1078 },{ lat: 37.402, lng: 127.1078 }], desc: '철근 절단 및 용접 작업 구역', orgId: 'org-5' },
    { id: 'zone-4', name: '판교 콘크리트 타설 구역', type: 'danger', shape: 'circle', coords: [{ lat: 37.401, lng: 127.1085 }], radius: 40, desc: '콘크리트 타설 중 미끄럼 및 낙하 위험', orgId: 'org-5' },
    { id: 'zone-5', name: '판교 사무동 안전 구역', type: 'safe', shape: 'polygon', coords: [{ lat: 37.4005, lng: 127.1088 },{ lat: 37.4008, lng: 127.1088 },{ lat: 37.4008, lng: 127.1092 },{ lat: 37.4005, lng: 127.1092 }], desc: '사무동 및 휴게 공간 - 스마트폰 사용 허용', orgId: 'org-5' },
    { id: 'zone-6', name: '판교 휴게 구역', type: 'safe', shape: 'circle', coords: [{ lat: 37.401, lng: 127.109 }], radius: 20, desc: '휴게 시간 사용 가능 구역', orgId: 'org-5' },
    // 인천 물류센터 (org-8)
    { id: 'zone-7', name: '인천 포크리프트 구역', type: 'danger', shape: 'circle', coords: [{ lat: 37.4542, lng: 126.7046 }], radius: 30, desc: '포크리프트 작업 중 스마트폰 사용 금지', orgId: 'org-8' },
    { id: 'zone-8', name: '인천 하역장', type: 'danger', shape: 'polygon', coords: [{ lat: 37.4545, lng: 126.704 },{ lat: 37.455, lng: 126.704 },{ lat: 37.455, lng: 126.7045 },{ lat: 37.4545, lng: 126.7045 }], desc: '화물 하역 및 상하차 작업 구역', orgId: 'org-8' },
    { id: 'zone-9', name: '인천 냉동창고', type: 'danger', shape: 'polygon', coords: [{ lat: 37.4538, lng: 126.7048 },{ lat: 37.4542, lng: 126.7048 },{ lat: 37.4542, lng: 126.7052 },{ lat: 37.4538, lng: 126.7052 }], desc: '냉동창고 내 저온 환경 - 안전 주의', orgId: 'org-8' },
    { id: 'zone-10', name: '인천 휴게실', type: 'safe', shape: 'circle', coords: [{ lat: 37.4535, lng: 126.7055 }], radius: 15, desc: '직원 휴게실 - 휴식 시간 스마트폰 사용 가능', orgId: 'org-8' },
    { id: 'zone-11', name: '인천 검수 구역', type: 'work', shape: 'polygon', coords: [{ lat: 37.4548, lng: 126.705 },{ lat: 37.4552, lng: 126.705 },{ lat: 37.4552, lng: 126.7054 },{ lat: 37.4548, lng: 126.7054 }], desc: '상품 검수 및 포장 작업 구역', orgId: 'org-8' },
    { id: 'zone-12', name: '인천-서울 고속도로', type: 'normal', shape: 'polygon', coords: [{ lat: 37.45, lng: 126.7 },{ lat: 37.46, lng: 126.75 },{ lat: 37.47, lng: 127.0 }], desc: '차량 운행 중 스마트폰 사용 제한', orgId: 'org-8' },
    // A동 건설팀 (org-6)
    { id: 'zone-13', name: 'A동 용접 작업장', type: 'danger', shape: 'polygon', coords: [{ lat: 37.4012, lng: 127.1095 },{ lat: 37.4015, lng: 127.1095 },{ lat: 37.4015, lng: 127.1099 },{ lat: 37.4012, lng: 127.1099 }], desc: 'A동 철근 용접 - 고온 위험', orgId: 'org-6' },
    { id: 'zone-14', name: 'A동 거푸집 작업장', type: 'danger', shape: 'circle', coords: [{ lat: 37.4018, lng: 127.1097 }], radius: 25, desc: 'A동 거푸집 설치/해체 구역', orgId: 'org-6' },
    // B동 건설팀 (org-7)
    { id: 'zone-15', name: 'B동 타설 현장', type: 'danger', shape: 'polygon', coords: [{ lat: 37.402, lng: 127.11 },{ lat: 37.4024, lng: 127.11 },{ lat: 37.4024, lng: 127.1105 },{ lat: 37.402, lng: 127.1105 }], desc: 'B동 콘크리트 타설 작업 구역', orgId: 'org-7' },
    { id: 'zone-16', name: 'B동 마감 작업장', type: 'work', shape: 'circle', coords: [{ lat: 37.4022, lng: 127.1108 }], radius: 20, desc: 'B동 내외부 마감 작업 구역', orgId: 'org-7' },
    // 배송팀
    { id: 'zone-17', name: '배송1팀 차량 대기소', type: 'normal', shape: 'circle', coords: [{ lat: 37.4555, lng: 126.706 }], radius: 30, desc: '배송1팀 차량 출발 전 대기 장소', orgId: 'org-9' },
    { id: 'zone-18', name: '배송2팀 차량 대기소', type: 'normal', shape: 'circle', coords: [{ lat: 37.456, lng: 126.7065 }], radius: 30, desc: '배송2팀 차량 출발 전 대기 장소', orgId: 'org-10' },
    // 창고관리팀
    { id: 'zone-19', name: '창고 피킹 구역', type: 'work', shape: 'polygon', coords: [{ lat: 37.454, lng: 126.7058 },{ lat: 37.4544, lng: 126.7058 },{ lat: 37.4544, lng: 126.7062 },{ lat: 37.454, lng: 126.7062 }], desc: '창고 피킹 및 상품 분류 작업', orgId: 'org-11' },
    // 서울 본사 (org-2, org-3, org-4)
    { id: 'zone-20', name: '서울 본사 사무 구역', type: 'safe', shape: 'polygon', coords: [{ lat: 37.5665, lng: 126.978 },{ lat: 37.567, lng: 126.978 },{ lat: 37.567, lng: 126.979 },{ lat: 37.5665, lng: 126.979 }], desc: '서울 본사 사무실 및 회의실', orgId: 'org-2' },
    { id: 'zone-21', name: '경영지원부 사무실', type: 'safe', shape: 'circle', coords: [{ lat: 37.5667, lng: 126.9785 }], radius: 15, desc: '경영지원부 전용 사무 공간', orgId: 'org-3' },
    { id: 'zone-22', name: '안전관리부 사무실', type: 'safe', shape: 'circle', coords: [{ lat: 37.5668, lng: 126.9788 }], radius: 15, desc: '안전관리부 전용 사무 공간', orgId: 'org-4' },
  ];

  const zones: any[] = [];
  for (const z of zoneConfigs) {
    zones.push(
      await prisma.zone.upsert({
        where: { id: z.id },
        update: {},
        create: {
          id: z.id,
          name: z.name,
          type: z.type,
          shape: z.shape,
          coordinates: z.coords,
          radius: z.radius ?? null,
          description: z.desc,
          isActive: true,
          organizationId: z.orgId,
        },
      }),
    );
  }
  console.log('✅ Zones:', zones.length, '개');

  // ============================================================
  // 7. 시간 정책 생성 (19개 — 조직/근무유형별)
  // ============================================================
  function timeVal(hhmm: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(1970, 0, 1, h, m);
  }

  const tpConfigs = [
    { id: 'tp-1', name: '주간 작업 시간', desc: '평일 주간 근무시간 제한', s: '09:00', e: '18:00', days: ['월','화','수','목','금'], orgId: 'org-5', wtId: 'wt-1' },
    { id: 'tp-2', name: '야간 작업 시간', desc: '야간 근무시간 제한', s: '21:00', e: '06:00', days: ['월','화','수','목','금','토','일'], orgId: 'org-5', wtId: 'wt-1' },
    { id: 'tp-3', name: '주말 작업', desc: '주말 근무시간 제한', s: '08:00', e: '17:00', days: ['토','일'], orgId: 'org-5', wtId: 'wt-1', active: false },
    { id: 'tp-4', name: '차량 운행 시간', desc: '물류 차량 운행 중 사용 제한', s: '06:00', e: '22:00', days: ['월','화','수','목','금'], orgId: 'org-8', wtId: 'wt-4' },
    { id: 'tp-5', name: '건설 현장 고소작업 시간', desc: '높이 2m 이상 고소작업 시 통제', s: '09:00', e: '17:00', days: ['월','화','수','목','금'], orgId: 'org-5', wtId: 'wt-3' },
    { id: 'tp-6', name: '물류센터 야간 배송', desc: '새벽 배송 차량 운행 시간', s: '23:00', e: '07:00', days: ['월','화','수','목','금','토','일'], orgId: 'org-8', wtId: 'wt-4' },
    { id: 'tp-7', name: '창고 피킹 작업 시간', desc: '상품 피킹 및 포장 작업', s: '08:00', e: '20:00', days: ['월','화','수','목','금','토'], orgId: 'org-8', wtId: 'wt-5' },
    { id: 'tp-8', name: '안전 관리자 순찰 시간', desc: '판교 현장 안전 관리자 순찰', s: '08:00', e: '18:00', days: ['월','화','수','목','금'], orgId: 'org-5', wtId: 'wt-2' },
    { id: 'tp-9', name: '크레인 작업 시간', desc: '판교 현장 크레인 운영', s: '09:00', e: '17:00', days: ['월','화','수','목','금'], orgId: 'org-5', wtId: 'wt-3' },
    { id: 'tp-10', name: '서울 본사 사무 시간', desc: '서울 본사 근무 시간', s: '09:00', e: '18:00', days: ['월','화','수','목','금'], orgId: 'org-2', wtId: 'wt-6' },
    { id: 'tp-11', name: '경영지원부 근무 시간', desc: '경영지원부 사무 시간', s: '09:00', e: '18:00', days: ['월','화','수','목','금'], orgId: 'org-3', wtId: 'wt-7' },
    { id: 'tp-12', name: '안전관리부 근무 시간', desc: '안전관리부 사무 시간', s: '08:00', e: '18:00', days: ['월','화','수','목','금'], orgId: 'org-4', wtId: 'wt-8' },
    { id: 'tp-13', name: 'A동 철근 작업 시간', desc: 'A동 철근 조립 및 용접', s: '08:00', e: '17:00', days: ['월','화','수','목','금'], orgId: 'org-6', wtId: 'wt-9' },
    { id: 'tp-14', name: 'A동 거푸집 작업 시간', desc: 'A동 거푸집 설치/해체', s: '08:00', e: '17:00', days: ['월','화','수','목','금'], orgId: 'org-6', wtId: 'wt-10' },
    { id: 'tp-15', name: 'B동 콘크리트 작업 시간', desc: 'B동 콘크리트 타설', s: '07:00', e: '16:00', days: ['월','화','수','목','금'], orgId: 'org-7', wtId: 'wt-11' },
    { id: 'tp-16', name: 'B동 마감 작업 시간', desc: 'B동 내외부 마감 작업', s: '08:00', e: '17:00', days: ['월','화','수','목','금','토'], orgId: 'org-7', wtId: 'wt-12' },
    { id: 'tp-17', name: '배송1팀 운행 시간', desc: '배송1팀 차량 운행', s: '07:00', e: '21:00', days: ['월','화','수','목','금','토'], orgId: 'org-9', wtId: 'wt-13' },
    { id: 'tp-18', name: '배송2팀 운행 시간', desc: '배송2팀 차량 운행', s: '06:00', e: '20:00', days: ['월','화','수','목','금','토','일'], orgId: 'org-10', wtId: 'wt-14' },
    { id: 'tp-19', name: '창고관리팀 피킹 시간', desc: '창고 피킹 및 포장 작업', s: '08:00', e: '20:00', days: ['월','화','수','목','금','토'], orgId: 'org-11', wtId: 'wt-15' },
  ];

  const timePolicies: any[] = [];
  for (const tp of tpConfigs) {
    timePolicies.push(
      await prisma.timePolicy.upsert({
        where: { id: tp.id },
        update: {},
        create: {
          id: tp.id,
          name: tp.name,
          description: tp.desc,
          startTime: timeVal(tp.s),
          endTime: timeVal(tp.e),
          days: tp.days,
          organizationId: tp.orgId,
          workTypeId: tp.wtId,
          isActive: (tp as any).active !== false,
        },
      }),
    );
  }
  console.log('✅ Time policies:', timePolicies.length, '개');

  // ============================================================
  // 8. 행동 조건 생성 (17개 — 목업 기반)
  // ============================================================
  const bcConfigs: {
    id: string; name: string; type: 'walking' | 'vehicleSpeed' | 'distance' | 'walkingSpeed' | 'composite';
    steps?: number; speed?: number; dist?: number; orgId: string; wtId: string;
  }[] = [
    { id: 'bc-1', name: '보행 중 스마트폰 사용 감지', type: 'walking', steps: 5, orgId: 'org-5', wtId: 'wt-1' },
    { id: 'bc-2', name: '차량 운행 중 감지 (30km/h 이상)', type: 'vehicleSpeed', speed: 30, orgId: 'org-8', wtId: 'wt-4' },
    { id: 'bc-3', name: '위험 구역 이동 감지', type: 'distance', dist: 10, orgId: 'org-5', wtId: 'wt-1' },
    { id: 'bc-4', name: '복합 조건 (보행 + 속도)', type: 'composite', steps: 3, speed: 5, orgId: 'org-5', wtId: 'wt-1' },
    { id: 'bc-5', name: '건설 현장 보행 감지', type: 'walking', steps: 3, orgId: 'org-5', wtId: 'wt-1' },
    { id: 'bc-6', name: '포크리프트 운행 속도 감지', type: 'vehicleSpeed', speed: 15, orgId: 'org-8', wtId: 'wt-5' },
    { id: 'bc-7', name: '화물차 고속 운행 감지', type: 'vehicleSpeed', speed: 50, orgId: 'org-8', wtId: 'wt-4' },
    { id: 'bc-8', name: '위험 구역 신속 이동 감지', type: 'distance', dist: 5, orgId: 'org-5', wtId: 'wt-1' },
    { id: 'bc-9', name: '크레인 작업 중 보행 감지', type: 'walking', steps: 2, orgId: 'org-5', wtId: 'wt-3' },
    { id: 'bc-10', name: '안전 관리자 순찰 이동', type: 'walkingSpeed', speed: 3, orgId: 'org-5', wtId: 'wt-2' },
    { id: 'bc-11', name: 'A동 용접 작업 중 보행 감지', type: 'walking', steps: 3, orgId: 'org-6', wtId: 'wt-9' },
    { id: 'bc-12', name: 'A동 거푸집 작업 중 보행 감지', type: 'walking', steps: 5, orgId: 'org-6', wtId: 'wt-10' },
    { id: 'bc-13', name: 'B동 타설 작업 중 보행 감지', type: 'walking', steps: 3, orgId: 'org-7', wtId: 'wt-11' },
    { id: 'bc-14', name: 'B동 마감 작업 중 보행 감지', type: 'walking', steps: 8, orgId: 'org-7', wtId: 'wt-12' },
    { id: 'bc-15', name: '배송1팀 차량 속도 감지', type: 'vehicleSpeed', speed: 30, orgId: 'org-9', wtId: 'wt-13' },
    { id: 'bc-16', name: '배송2팀 차량 속도 감지', type: 'vehicleSpeed', speed: 30, orgId: 'org-10', wtId: 'wt-14' },
    { id: 'bc-17', name: '창고 피킹 이동 감지', type: 'walking', steps: 10, orgId: 'org-11', wtId: 'wt-15' },
  ];

  const behaviorConditions: any[] = [];
  for (const bc of bcConfigs) {
    behaviorConditions.push(
      await prisma.behaviorCondition.upsert({
        where: { id: bc.id },
        update: {},
        create: {
          id: bc.id,
          name: bc.name,
          type: bc.type,
          stepsThreshold: bc.steps ?? null,
          speedThreshold: bc.speed ?? null,
          distanceThreshold: bc.dist ?? null,
          description: bc.name,
          organizationId: bc.orgId,
          workTypeId: bc.wtId,
          isActive: true,
        },
      }),
    );
  }
  console.log('✅ Behavior conditions:', behaviorConditions.length, '개');

  // ============================================================
  // 9. 유해 앱 생성 (42개 — 7 카테고리)
  // ============================================================
  const appConfigs = [
    // 게임 (0-6)
    { name: 'PUBG Mobile', pkg: 'com.game.pubg', cat: '게임', global: true, platform: 'both' },
    { name: '리그 오브 레전드', pkg: 'com.game.league', cat: '게임', global: true, platform: 'both' },
    { name: '카트라이더 러쉬플러스', pkg: 'com.game.kartrider', cat: '게임', global: true, platform: 'both' },
    { name: '로스트아크', pkg: 'com.game.lostark', cat: '게임', global: true, platform: 'android' },
    { name: 'FIFA Mobile', pkg: 'com.game.fifa', cat: '게임', global: true, platform: 'both' },
    { name: '캔디크러쉬', pkg: 'com.game.candy', cat: '게임', global: true, platform: 'both' },
    { name: 'Clash of Clans', pkg: 'com.game.clash', cat: '게임', global: true, platform: 'both' },
    // SNS (7-14)
    { name: '페이스북', pkg: 'com.facebook.katana', cat: 'SNS', global: true, platform: 'both' },
    { name: '인스타그램', pkg: 'com.instagram.android', cat: 'SNS', global: true, platform: 'both' },
    { name: '카카오톡', pkg: 'com.kakao.talk', cat: 'SNS', global: false, platform: 'both' },
    { name: 'LINE', pkg: 'com.naver.line', cat: 'SNS', global: false, platform: 'both' },
    { name: 'Telegram', pkg: 'com.telegram.messenger', cat: 'SNS', global: false, platform: 'both' },
    { name: 'TikTok', pkg: 'com.tiktok.android', cat: 'SNS', global: true, platform: 'both' },
    { name: 'Snapchat', pkg: 'com.snapchat.android', cat: 'SNS', global: true, platform: 'both' },
    { name: 'Twitter(X)', pkg: 'com.twitter.android', cat: 'SNS', global: true, platform: 'both' },
    // 동영상/엔터테인먼트 (15-21)
    { name: '유튜브', pkg: 'com.google.android.youtube', cat: '동영상', global: true, platform: 'both' },
    { name: '넷플릭스', pkg: 'com.netflix.mediaclient', cat: '동영상', global: true, platform: 'both' },
    { name: 'Spotify', pkg: 'com.spotify.music', cat: '엔터테인먼트', global: true, platform: 'both' },
    { name: 'Disney+', pkg: 'com.disney.disneyplus', cat: '동영상', global: true, platform: 'both' },
    { name: 'wavve', pkg: 'com.wavve.player', cat: '동영상', global: false, platform: 'both' },
    { name: 'TVING', pkg: 'com.tving.android', cat: '동영상', global: false, platform: 'both' },
    { name: '멜론', pkg: 'com.melon.android', cat: '엔터테인먼트', global: false, platform: 'android' },
    // 쇼핑 (22-27)
    { name: '쿠팡', pkg: 'com.coupang.mobile', cat: '쇼핑', global: false, platform: 'both' },
    { name: '네이버 쇼핑', pkg: 'com.naver.shopping', cat: '쇼핑', global: false, platform: 'both' },
    { name: '11번가', pkg: 'kr.co.teneleven', cat: '쇼핑', global: false, platform: 'android' },
    { name: 'Amazon', pkg: 'com.amazon.mobile', cat: '쇼핑', global: false, platform: 'both' },
    { name: 'SSG.COM', pkg: 'com.ssg.mobile', cat: '쇼핑', global: false, platform: 'both' },
    { name: 'G마켓', pkg: 'com.gmarket.mobile', cat: '쇼핑', global: false, platform: 'android' },
    // 웹툰 (28)
    { name: '네이버 웹툰', pkg: 'com.nhn.android.webtoon', cat: '웹툰', global: false, platform: 'both' },
    // 도박/베팅 (29-32)
    { name: '스포츠 베팅', pkg: 'com.betting.sports', cat: '도박', global: true, platform: 'both' },
    { name: '온라인 카지노', pkg: 'com.casino.online', cat: '도박', global: true, platform: 'both' },
    { name: '포커 게임', pkg: 'com.poker.game', cat: '도박', global: true, platform: 'both' },
    { name: 'Betway', pkg: 'com.betway.mobile', cat: '도박', global: true, platform: 'both' },
    // 금융 (33-38)
    { name: 'KB스타뱅킹', pkg: 'com.kbstar.kbbank', cat: '금융', global: false, platform: 'both' },
    { name: '신한 SOL뱅크', pkg: 'com.shinhan.sbanking', cat: '금융', global: false, platform: 'both' },
    { name: '키움증권', pkg: 'com.stock.trading', cat: '금융', global: false, platform: 'android' },
    { name: '업비트', pkg: 'com.crypto.exchange', cat: '금융', global: false, platform: 'both' },
    { name: '토스', pkg: 'com.toss.mobile', cat: '금융', global: false, platform: 'both' },
    { name: '카카오페이', pkg: 'com.kakao.pay', cat: '금융', global: false, platform: 'both' },
    // 데이팅 (39-41)
    { name: '데이팅 앱', pkg: 'com.dating.app', cat: '데이팅', global: true, platform: 'android' },
    { name: 'Tinder', pkg: 'com.tinder.android', cat: '데이팅', global: true, platform: 'both' },
    { name: 'Bumble', pkg: 'com.bumble.android', cat: '데이팅', global: true, platform: 'both' },
    // iOS 전용 (42-49)
    { name: 'Apple Game Center', pkg: 'com.apple.gamecenter', cat: '게임', global: true, platform: 'ios' },
    { name: 'iMessage', pkg: 'com.apple.MobileSMS', cat: 'SNS', global: false, platform: 'ios' },
    { name: 'FaceTime', pkg: 'com.apple.facetime', cat: 'SNS', global: false, platform: 'ios' },
    { name: 'Apple TV+', pkg: 'com.apple.atv', cat: '동영상', global: false, platform: 'ios' },
    { name: 'Apple Music', pkg: 'com.apple.music', cat: '엔터테인먼트', global: false, platform: 'ios' },
    { name: 'App Store', pkg: 'com.apple.appstore', cat: '쇼핑', global: false, platform: 'ios' },
    { name: 'Safari', pkg: 'com.apple.mobilesafari', cat: '웹브라우저', global: false, platform: 'ios' },
    { name: 'Apple Pay', pkg: 'com.apple.passbook', cat: '금융', global: false, platform: 'ios' },
  ];

  const harmfulApps: any[] = [];
  for (const app of appConfigs) {
    harmfulApps.push(
      await prisma.harmfulApp.upsert({
        where: { packageName: app.pkg },
        update: {},
        create: { name: app.name, packageName: app.pkg, category: app.cat, isGlobal: app.global, platform: app.platform },
      }),
    );
  }
  console.log('✅ Harmful apps:', harmfulApps.length, '개');

  // ============================================================
  // 10. 유해 앱 프리셋 생성 (6개)
  // ============================================================
  const presetConfigs = [
    { id: 'preset-1', name: '기본 차단 목록 (Android)', desc: '건설 현장 기본 차단 앱', platform: 'android', orgId: 'org-5', wtId: 'wt-1', apps: [0,1,2,3,7,8,12,15,16,29,30] },
    { id: 'preset-2', name: '엄격한 차단 목록 (Android)', desc: '위험 구역 작업 시 전면 차단', platform: 'android', orgId: 'org-5', wtId: 'wt-3', apps: [0,1,2,3,4,5,6,7,8,9,12,13,14,15,16,17,18,22,23,28,29,30,31,32,39,40,41] },
    { id: 'preset-3', name: '배송 차량 운행 차단 (Android)', desc: '배송 차량 운행 중 사용', platform: 'android', orgId: 'org-8', wtId: 'wt-4', apps: [0,1,2,3,7,8,12,15,16,17,18,29,30,39,40] },
    { id: 'preset-4', name: '창고 작업 차단 (Android)', desc: '창고 포크리프트 작업 시', platform: 'android', orgId: 'org-8', wtId: 'wt-5', apps: [0,1,7,8,12,15,16,22,23] },
    { id: 'preset-5', name: '사무실 게임 차단 (Android)', desc: '사무 시간 중 게임만 차단', platform: 'android', orgId: 'org-2', wtId: 'wt-6', apps: [0,1,2,3,4,5,6,29,30,31,32] },
    { id: 'preset-6', name: '도박앱 전면 차단 (Android)', desc: '도박/베팅 앱 전면 차단', platform: 'android', orgId: 'org-3', wtId: null, apps: [29,30,31,32] },
    { id: 'preset-7', name: '기본 차단 목록 (iOS)', desc: '건설 현장 iOS 기본 차단', platform: 'ios', orgId: 'org-5', wtId: 'wt-1', apps: [33,34,35,36,37,38,39,40,41] },
    { id: 'preset-8', name: '사무실 iOS 차단', desc: '사무 시간 중 iOS 앱 차단', platform: 'ios', orgId: 'org-2', wtId: 'wt-6', apps: [33,34,35,36,37] },
  ];

  const harmfulAppPresets: any[] = [];
  for (const p of presetConfigs) {
    harmfulAppPresets.push(
      await prisma.harmfulAppPreset.upsert({
        where: { id: p.id },
        update: {},
        create: { id: p.id, name: p.name, description: p.desc, platform: p.platform, organizationId: p.orgId, workTypeId: p.wtId },
      }),
    );
    // 프리셋-앱 연결
    for (const idx of p.apps) {
      if (harmfulApps[idx]) {
        await prisma.harmfulAppPresetItem.upsert({
          where: { presetId_harmfulAppId: { presetId: p.id, harmfulAppId: harmfulApps[idx].id } },
          update: {},
          create: { presetId: p.id, harmfulAppId: harmfulApps[idx].id },
        });
      }
    }
  }
  console.log('✅ Harmful app presets:', harmfulAppPresets.length, '개 (앱 연결 완료)');

  // ============================================================
  // 11. 제어 정책 생성 (15개 — WorkType 1:1)
  // ============================================================
  const cpConfigs = [
    { id: 'cp-1',  name: '판교 현장 위험 구역 통제',     desc: '판교 현장 내 위험 구역 스마트폰 차단',          orgId: 'org-5',  wtId: 'wt-1',  pri: 1, zones: ['zone-1','zone-2'],               tps: ['tp-1','tp-2'],  bcs: ['bc-1','bc-3'],     presets: ['preset-1'] },
    { id: 'cp-2',  name: '배송 차량 운행 통제',          desc: '배송 차량 운행 중 스마트폰 사용 절대 차단',     orgId: 'org-8',  wtId: 'wt-4',  pri: 1, zones: ['zone-12','zone-8'],             tps: ['tp-4','tp-6'],  bcs: ['bc-2','bc-7'],     presets: ['preset-3'] },
    { id: 'cp-3',  name: '인천 창고 작업 통제',          desc: '포크리프트 작업 구역 내 사용 제한',             orgId: 'org-8',  wtId: 'wt-5',  pri: 2, zones: ['zone-7','zone-9','zone-11'],    tps: ['tp-7'],         bcs: ['bc-6'],            presets: ['preset-4'] },
    { id: 'cp-4',  name: 'A동 철근 작업 통제',           desc: 'A동 철근 작업 시 완전 차단',                   orgId: 'org-6',  wtId: 'wt-9',  pri: 1, zones: ['zone-3','zone-13'],             tps: ['tp-13'],        bcs: ['bc-11'],           presets: ['preset-1'] },
    { id: 'cp-5',  name: 'B동 콘크리트 작업 통제',       desc: 'B동 콘크리트 타설 중 안전 관리',               orgId: 'org-7',  wtId: 'wt-11', pri: 1, zones: ['zone-4','zone-15'],             tps: ['tp-15'],        bcs: ['bc-13'],           presets: ['preset-1'] },
    { id: 'cp-6',  name: '판교 크레인 작업 통제',        desc: '크레인 오퍼레이터 절대 통제',                   orgId: 'org-5',  wtId: 'wt-3',  pri: 1, zones: ['zone-1'],                     tps: ['tp-5','tp-9'],  bcs: ['bc-9'],            presets: ['preset-2'] },
    { id: 'cp-7',  name: '안전 관리자 순찰 통제',        desc: '안전 관리자 순찰 중 업무 집중 관리',           orgId: 'org-5',  wtId: 'wt-2',  pri: 2, zones: ['zone-1','zone-2','zone-3','zone-4'], tps: ['tp-8'], bcs: ['bc-10'],       presets: ['preset-1'] },
    { id: 'cp-8',  name: 'A동 거푸집 작업 통제',         desc: 'A동 거푸집 설치/해체 중 안전 통제',            orgId: 'org-6',  wtId: 'wt-10', pri: 1, zones: ['zone-14'],                    tps: ['tp-14'],        bcs: ['bc-12'],           presets: ['preset-1'] },
    { id: 'cp-9',  name: 'B동 마감 작업 통제',           desc: 'B동 내외부 마감 작업 중 안전 통제',            orgId: 'org-7',  wtId: 'wt-12', pri: 1, zones: ['zone-16'],                    tps: ['tp-16'],        bcs: ['bc-14'],           presets: ['preset-1'] },
    { id: 'cp-10', name: '배송1팀 운행 통제',            desc: '배송1팀 차량 운행 중 스마트폰 차단',           orgId: 'org-9',  wtId: 'wt-13', pri: 1, zones: ['zone-12','zone-17'],            tps: ['tp-17'],        bcs: ['bc-15'],           presets: ['preset-3'] },
    { id: 'cp-11', name: '배송2팀 운행 통제',            desc: '배송2팀 차량 운행 중 스마트폰 차단',           orgId: 'org-10', wtId: 'wt-14', pri: 1, zones: ['zone-12','zone-18'],            tps: ['tp-18'],        bcs: ['bc-16'],           presets: ['preset-3'] },
    { id: 'cp-12', name: '창고관리팀 피킹 통제',         desc: '창고 피킹 작업 중 통제',                       orgId: 'org-11', wtId: 'wt-15', pri: 2, zones: ['zone-19'],                    tps: ['tp-19'],        bcs: ['bc-17'],           presets: ['preset-4'] },
    { id: 'cp-13', name: '서울 본사 사무직 통제',        desc: '서울 본사 사무 시간 중 게임 차단',             orgId: 'org-2',  wtId: 'wt-6',  pri: 3, zones: ['zone-20'],                    tps: ['tp-10'],        bcs: [] as string[],      presets: ['preset-5'] },
    { id: 'cp-14', name: '경영지원부 통제',              desc: '경영지원부 근무 시간 게임/도박 차단',          orgId: 'org-3',  wtId: 'wt-7',  pri: 3, zones: ['zone-21'],                    tps: ['tp-11'],        bcs: [] as string[],      presets: ['preset-5','preset-6'] },
    { id: 'cp-15', name: '안전관리부 통제',              desc: '안전관리부 업무 집중 통제',                     orgId: 'org-4',  wtId: 'wt-8',  pri: 2, zones: ['zone-22'],                    tps: ['tp-12'],        bcs: [] as string[],      presets: ['preset-5'] },
  ];

  const controlPolicies: any[] = [];
  for (const cp of cpConfigs) {
    controlPolicies.push(
      await prisma.controlPolicy.upsert({
        where: { id: cp.id },
        update: {},
        create: {
          id: cp.id,
          name: cp.name,
          description: cp.desc,
          organizationId: cp.orgId,
          workTypeId: cp.wtId,
          priority: cp.pri,
          isActive: true,
        },
      }),
    );
    // 구역 연결
    for (const zId of cp.zones) {
      await prisma.controlPolicyZone.upsert({
        where: { policyId_zoneId: { policyId: cp.id, zoneId: zId } },
        update: {},
        create: { policyId: cp.id, zoneId: zId },
      });
    }
    // 시간정책 연결
    for (const tpId of cp.tps) {
      await prisma.controlPolicyTimePolicy.upsert({
        where: { policyId_timePolicyId: { policyId: cp.id, timePolicyId: tpId } },
        update: {},
        create: { policyId: cp.id, timePolicyId: tpId },
      });
    }
    // 행동조건 연결
    for (const bcId of cp.bcs) {
      await prisma.controlPolicyBehavior.upsert({
        where: { policyId_behaviorConditionId: { policyId: cp.id, behaviorConditionId: bcId } },
        update: {},
        create: { policyId: cp.id, behaviorConditionId: bcId },
      });
    }
    // 유해앱 프리셋 연결
    for (const pId of cp.presets) {
      await prisma.controlPolicyHarmfulApp.upsert({
        where: { policyId_presetId: { policyId: cp.id, presetId: pId } },
        update: {},
        create: { policyId: cp.id, presetId: pId },
      });
    }
  }
  console.log('✅ Control policies:', controlPolicies.length, '개 (관계 연결 완료)');

  // ============================================================
  // 12. 제어 로그 생성 (500개 — 직원-정책-구역 조직 일관성 보장)
  // ============================================================
  const logReasons = [
    '위험 구역 내 스마트폰 사용 감지', '보행 중 스마트폰 사용 감지',
    '차량 운행 중 스마트폰 사용 감지', '작업 시간 중 게임 앱 실행',
    '작업 구역 내 SNS 사용 감지', '고속 이동 중 스마트폰 사용',
    '위험 구역 진입 후 앱 사용', '포크리프트 운행 중 사용 감지',
  ];
  const logAppNames = ['유튜브','인스타그램','PUBG','카카오톡','넷플릭스','TikTok','Clash of Clans','페이스북'];
  const logPkgNames = ['com.google.android.youtube','com.instagram.android','com.game.pubg','com.kakao.talk','com.netflix.mediaclient','com.tiktok.android','com.game.clash','com.facebook.katana'];

  // workTypeId → 제어 정책 설정 매핑 (직원의 근무유형에 맞는 정책 찾기)
  const wtToCpConfig = new Map<string, any>();
  for (const cp of cpConfigs) {
    wtToCpConfig.set(cp.wtId, cp);
  }

  // 직원별 디바이스 매핑
  const empDeviceMap = new Map<string, any[]>();
  for (const dev of devices) {
    if (dev.employeeId) {
      if (!empDeviceMap.has(dev.employeeId)) empDeviceMap.set(dev.employeeId, []);
      empDeviceMap.get(dev.employeeId)!.push(dev);
    }
  }

  // zoneId → zone 객체 매핑
  const zoneById = new Map<string, any>();
  for (const z of zones) {
    zoneById.set(z.id, z);
  }

  // 유효한 직원 필터 (근무유형 + 매칭 정책 + 디바이스 보유)
  const eligibleEmps = employees.filter(
    (emp) => emp.workTypeId && wtToCpConfig.has(emp.workTypeId) && empDeviceMap.has(emp.id),
  );

  for (let i = 0; i < 500; i++) {
    const emp = eligibleEmps[i % eligibleEmps.length];
    const matchedCp = wtToCpConfig.get(emp.workTypeId)!;
    const empDevs = empDeviceMap.get(emp.id)!;
    const dev = empDevs[i % empDevs.length];
    const zoneId = matchedCp.zones[i % matchedCp.zones.length];
    const zone = zoneById.get(zoneId)!;
    const coord: any = Array.isArray(zone.coordinates) ? zone.coordinates[0] : { lat: 37.5, lng: 127.03 };

    await prisma.controlLog.create({
      data: {
        employeeId: emp.id,
        deviceId: dev.id,
        policyId: matchedCp.id,
        zoneId: zoneId,
        type: i % 3 === 0 ? 'harmful_app' : 'behavior',
        action: i % 5 === 0 ? 'allowed' : 'blocked',
        timestamp: new Date(Date.now() - i * 12 * 60000),
        latitude: (coord.lat ?? 37.5) + (Math.random() - 0.5) * 0.002,
        longitude: (coord.lng ?? 127.03) + (Math.random() - 0.5) * 0.002,
        reason: logReasons[i % logReasons.length],
        appName: i % 3 === 0 ? logAppNames[i % logAppNames.length] : null,
        packageName: i % 3 === 0 ? logPkgNames[i % logPkgNames.length] : null,
        behaviorSteps: i % 3 !== 0 ? 3 + Math.floor(Math.random() * 15) : null,
        behaviorSpeed: i % 3 !== 0 ? 2 + Math.floor(Math.random() * 40) : null,
        behaviorDistance: i % 5 === 0 ? 5 + Math.floor(Math.random() * 50) : null,
      },
    });
  }
  console.log('✅ Control logs: 500개 (직원-정책-구역 조직 일관성 보장)');

  // ============================================================
  // 13. 감사 로그 생성 (100개)
  // ============================================================
  const auditActions: ('CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE' | 'DEACTIVATE')[] = ['CREATE','UPDATE','DELETE','ACTIVATE','DEACTIVATE'];
  const resTypes = ['employee','organization','policy','device','zone','workType','timePolicy','behaviorCondition'];
  const admins = [superAdmin, siteAdmin, siteAdmin2, viewer];

  for (let i = 0; i < 100; i++) {
    const adm = admins[i % admins.length];
    await prisma.auditLog.create({
      data: {
        accountId: adm.id,
        action: auditActions[i % auditActions.length],
        resourceType: resTypes[i % resTypes.length],
        resourceId: `resource-${i + 1}`,
        resourceName: `${resTypes[i % resTypes.length]} #${i + 1}`,
        organizationId: sites[i % sites.length].id,
        changesBefore: i % 3 === 1 ? { status: 'ACTIVE', name: '이전 값' } : undefined,
        changesAfter: i % 3 !== 2 ? { status: 'INACTIVE', name: '변경 값' } : undefined,
        ipAddress: `192.168.${Math.floor(i / 25)}.${(i % 255) + 1}`,
        timestamp: new Date(Date.now() - i * 3600000),
      },
    });
  }
  console.log('✅ Audit logs: 100개');

  // ============================================================
  // 14. 로그인 이력 생성 (50개)
  // ============================================================
  for (let i = 0; i < 50; i++) {
    const acc = admins[i % admins.length];
    await prisma.adminLoginHistory.create({
      data: {
        accountId: acc.id,
        loginTime: new Date(Date.now() - i * 7200000),
        ipAddress: `192.168.${i % 3}.${100 + (i % 100)}`,
        userAgent: i % 2 === 0
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0'
          : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/17.0',
        status: i % 7 === 0 ? 'FAILED' : 'SUCCESS',
        failReason: i % 7 === 0 ? '잘못된 비밀번호' : null,
      },
    });
  }
  console.log('✅ Login history: 50개');

  // ============================================================
  // 15. 직원 예외 (통제 제외) 생성
  // ============================================================
  const exclEmployees = employees.filter(e => e.status === 'EXCEPTION');
  const exclReasons = ['의료 사유 (시력 저하)', '임신 중 특별 관리', '재활 치료 중', '단기 업무 조정'];
  for (let i = 0; i < exclEmployees.length && i < 5; i++) {
    await prisma.employeeExclusion.upsert({
      where: { id: `excl-${i + 1}` },
      update: {},
      create: {
        id: `excl-${i + 1}`,
        employeeId: exclEmployees[i].id,
        startDate: new Date('2024-01-01'),
        endDate: i === 0 ? new Date('2024-06-30') : null,
        reason: exclReasons[i % exclReasons.length],
        isActive: true,
      },
    });
  }
  console.log('✅ Employee exclusions:', Math.min(exclEmployees.length, 5), '건');

  // ============================================================
  // 16. 권한 설정 생성 (18개)
  // ============================================================
  const permConfigs = [
    { code: 'employee.view', name: '직원 조회', cat: '직원 관리' },
    { code: 'employee.create', name: '직원 생성', cat: '직원 관리' },
    { code: 'employee.edit', name: '직원 수정', cat: '직원 관리' },
    { code: 'employee.delete', name: '직원 삭제', cat: '직원 관리' },
    { code: 'device.view', name: '디바이스 조회', cat: '디바이스 관리' },
    { code: 'device.manage', name: '디바이스 관리', cat: '디바이스 관리' },
    { code: 'policy.view', name: '정책 조회', cat: '정책 관리' },
    { code: 'policy.create', name: '정책 생성', cat: '정책 관리' },
    { code: 'policy.edit', name: '정책 수정', cat: '정책 관리' },
    { code: 'policy.delete', name: '정책 삭제', cat: '정책 관리' },
    { code: 'zone.view', name: '구역 조회', cat: '구역 관리' },
    { code: 'zone.manage', name: '구역 관리', cat: '구역 관리' },
    { code: 'report.view', name: '리포트 조회', cat: '리포트' },
    { code: 'report.export', name: '리포트 내보내기', cat: '리포트' },
    { code: 'account.view', name: '계정 조회', cat: '시스템 관리' },
    { code: 'account.manage', name: '계정 관리', cat: '시스템 관리' },
    { code: 'audit.view', name: '감사 로그 조회', cat: '시스템 관리' },
    { code: 'system.settings', name: '시스템 설정', cat: '시스템 관리' },
  ];

  for (const p of permConfigs) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        name: p.name,
        category: p.cat,
        description: `${p.cat} - ${p.name} 권한`,
        isActive: true,
      },
    });
  }
  console.log('✅ Permissions:', permConfigs.length, '개');

  // ============================================================
  // 17. 집계 데이터 — 조직 일별 통계 (60일 × 모든 조직)
  // ============================================================
  // 부서/팀/현장조 등 모든 조직에 대해 통계 생성
  const allOrgs = [
    ...sites, // org-2, org-5, org-8 (사이트)
    ...deptConfigs.map(d => ({ id: d.id, name: d.name, type: d.type })),
  ];
  for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    d.setHours(0, 0, 0, 0);
    for (const org of allOrgs) {
      // 주말은 차단 적게
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const baseMult = isWeekend ? 0.3 : 1.0;
      // 하위 조직일수록 직원 수/차단 수 적게
      const isSite = ['site'].includes(org.type);
      const empBase = isSite ? 15 : 4;
      const empVariance = isSite ? 10 : 5;
      const blockBase = isSite ? 20 : 5;
      const blockVariance = isSite ? 50 : 15;
      await prisma.organizationDailyStat.upsert({
        where: { organizationId_date: { organizationId: org.id, date: d } },
        update: {},
        create: {
          organizationId: org.id,
          date: d,
          totalEmployees: empBase + Math.floor(Math.random() * empVariance),
          activeDevices: Math.max(1, empBase - 3 + Math.floor(Math.random() * empVariance)),
          totalBlocks: Math.floor((blockBase + Math.floor(Math.random() * blockVariance)) * baseMult),
          behaviorBlocks: Math.floor((Math.floor(blockBase * 0.5) + Math.floor(Math.random() * Math.floor(blockVariance * 0.6))) * baseMult),
          harmfulAppBlocks: Math.floor((Math.floor(blockBase * 0.5) + Math.floor(Math.random() * Math.floor(blockVariance * 0.4))) * baseMult),
          complianceRate: 75 + Math.random() * 20,
        },
      });
    }
  }
  console.log('✅ Organization daily stats:', 60 * allOrgs.length, '건 (60일 ×', allOrgs.length, '조직)');

  // ============================================================
  // 18. 집계 데이터 — 직원 일별 통계 (30일 × 전체 55명)
  // ============================================================
  const topEmpAppNames = ['유튜브','인스타그램','PUBG','카카오톡','페이스북','넷플릭스','TikTok','Twitter(X)','쿠팡','배틀그라운드','캔디크러쉬','네이버 웹툰',null];
  let empDailyStatCount = 0;
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    d.setHours(0, 0, 0, 0);
    for (let ei = 0; ei < employees.length; ei++) {
      const emp = employees[ei];
      // 직원별 특성에 따라 차단 패턴 다양화
      const isHighRisk = ei < 5; // 핵심 직원은 차단 빈번
      const isMediumRisk = ei >= 5 && ei < 20;
      const isLowRisk = ei >= 20 && ei < 40;
      // 나머지 40~55는 매우 낮은 차단 또는 0

      let baseBlocks: number;
      if (isHighRisk) {
        baseBlocks = 8 + Math.floor(Math.random() * 12); // 8~19
      } else if (isMediumRisk) {
        baseBlocks = 3 + Math.floor(Math.random() * 10); // 3~12
      } else if (isLowRisk) {
        baseBlocks = Math.floor(Math.random() * 6); // 0~5
      } else {
        baseBlocks = Math.floor(Math.random() * 3); // 0~2
      }

      // 주말은 차단 적음
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        baseBlocks = Math.floor(baseBlocks * 0.3);
      }

      // 최근 데이터일수록 약간 변동
      const recencyFactor = dayOffset < 7 ? 1.2 : dayOffset < 14 ? 1.0 : 0.8;
      const totalBlocks = Math.floor(baseBlocks * recencyFactor);
      const behaviorBlocks = Math.floor(totalBlocks * (0.4 + Math.random() * 0.3));
      const harmfulAppBlocks = totalBlocks - behaviorBlocks;

      await prisma.employeeDailyStat.upsert({
        where: { employeeId_date: { employeeId: emp.id, date: d } },
        update: {},
        create: {
          employeeId: emp.id,
          organizationId: emp.organizationId,
          workTypeId: emp.workTypeId,
          date: d,
          totalBlocks,
          behaviorBlocks,
          harmfulAppBlocks,
          zoneViolations: isHighRisk ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 2),
          timeViolations: Math.floor(Math.random() * 2),
          topBlockedApp: harmfulAppBlocks > 0 ? topEmpAppNames[ei % topEmpAppNames.length] : null,
        },
      });
      empDailyStatCount++;
    }
  }
  console.log('✅ Employee daily stats:', empDailyStatCount, '건 (30일 ×', employees.length, '명)');

  // ============================================================
  // 19. 집계 데이터 — 시간별 차단 통계 (최근 7일 × 24시간 × 모든 조직)
  // ============================================================
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayDate = new Date();
    dayDate.setDate(dayDate.getDate() - (dayOffset + 1));
    dayDate.setHours(0, 0, 0, 0);
    for (const org of allOrgs) {
      const isSite = ['site'].includes(org.type);
      for (let h = 0; h < 24; h++) {
        const isWorkHour = h >= 8 && h <= 18;
        const isPeak = h >= 9 && h <= 11; // 오전 피크
        const peakMult = isPeak ? 1.5 : 1.0;
        const sizeMultiplier = isSite ? 1.0 : 0.4;
        await prisma.hourlyBlockStat.upsert({
          where: { organizationId_date_hour: { organizationId: org.id, date: dayDate, hour: h } },
          update: {},
          create: {
            organizationId: org.id,
            date: dayDate,
            hour: h,
            totalBlocks: isWorkHour ? Math.floor((5 + Math.floor(Math.random() * 20)) * peakMult * sizeMultiplier) : Math.floor(Math.random() * 3),
            behaviorBlocks: isWorkHour ? Math.floor((3 + Math.floor(Math.random() * 10)) * peakMult * sizeMultiplier) : Math.floor(Math.random() * 2),
            harmfulAppBlocks: isWorkHour ? Math.floor((2 + Math.floor(Math.random() * 10)) * peakMult * sizeMultiplier) : Math.floor(Math.random() * 1),
          },
        });
      }
    }
  }
  console.log('✅ Hourly block stats:', 7 * 24 * allOrgs.length, '건 (7일 × 24시간 ×', allOrgs.length, '조직)');

  // ============================================================
  // 20. 집계 데이터 — 구역 위반 통계 (30일 × 위험 구역)
  // ============================================================
  const dangerZones = zones.filter(z => z.type === 'danger');
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    d.setHours(0, 0, 0, 0);
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    for (const z of dangerZones) {
      await prisma.zoneViolationStat.upsert({
        where: { zoneId_date: { zoneId: z.id, date: d } },
        update: {},
        create: {
          zoneId: z.id,
          date: d,
          violationCount: isWeekend ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 12),
          uniqueEmployees: isWeekend ? Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 5),
        },
      });
    }
  }
  console.log('✅ Zone violation stats:', dangerZones.length * 30, '건 (30일 ×', dangerZones.length, '위험구역)');

  // ============================================================
  // 완료 Summary
  // ============================================================
  console.log('');
  console.log('🎉 Seeding completed successfully!');
  console.log('');
  console.log('📋 Summary:');
  console.log('   💡 데모 계정:');
  console.log('   ┌─────────────┬───────────┬────────────┬──────────────────┐');
  console.log('   │ 역할        │ 아이디    │ 비밀번호   │ 소속             │');
  console.log('   ├─────────────┼───────────┼────────────┼──────────────────┤');
  console.log('   │ 슈퍼 관리자 │ admin     │ admin123   │ 전체             │');
  console.log('   │ 현장 관리자 │ site1     │ site123    │ 판교 현장        │');
  console.log('   │ 현장 관리자 │ site2     │ site123    │ 인천 물류센터    │');
  console.log('   │ 조회자      │ viewer1   │ viewer123  │ 서울 본사        │');
  console.log('   └─────────────┴───────────┴────────────┴──────────────────┘');
  console.log('');
  console.log('   📊 데이터 통계:');
  console.log(`   - Organizations:       11개`);
  console.log(`   - Work Types:          ${workTypes.length}개`);
  console.log(`   - Employees:           ${employees.length}명`);
  console.log(`   - Devices:             ${devices.length}개`);
  console.log(`   - Zones:               ${zones.length}개`);
  console.log(`   - Time Policies:       ${timePolicies.length}개`);
  console.log(`   - Behavior Conditions: ${behaviorConditions.length}개`);
  console.log(`   - Harmful Apps:        ${harmfulApps.length}개`);
  console.log(`   - Harmful App Presets: ${harmfulAppPresets.length}개`);
  console.log(`   - Control Policies:    ${controlPolicies.length}개`);
  console.log(`   - Control Logs:        500개`);
  console.log(`   - Audit Logs:          100개`);
  console.log(`   - Login History:       50개`);
  console.log(`   - Permissions:         ${permConfigs.length}개`);
  console.log(`   - Org Daily Stats:     180건`);
  console.log(`   - Emp Daily Stats:     ${empDailyStatCount}건`);
  console.log(`   - Hourly Block Stats:  504건`);
  console.log(`   - Zone Violation Stats: ${dangerZones.length * 30}건`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
