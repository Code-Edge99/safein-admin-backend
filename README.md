# Smombie Admin Backend

스몸비 관리자 백엔드 API 서버 (NestJS + Prisma + PostgreSQL)

## 기술 스택

| 항목 | 버전 |
|------|------|
| Node.js | 24.x |
| NestJS | 10.x |
| Prisma | 5.x |
| PostgreSQL | 16 |
| TypeScript | 5.x |

## API 모듈 (16개, 121개 엔드포인트)

| 모듈 | 경로 | 설명 |
|------|------|------|
| Auth | `/api/auth` | 관리자 로그인/로그아웃/비밀번호 변경 |
| Accounts | `/api/accounts` | 관리자 계정 CRUD |
| Organizations | `/api/organizations` | 조직 구조 트리 CRUD |
| Employees | `/api/employees` | 직원 관리 (CRUD, 일괄 등록, 제외 처리) |
| Devices | `/api/devices` | 디바이스 관리 |
| Zones | `/api/zones` | 구역 관리 (폴리곤 좌표) |
| Control Policies | `/api/control-policies` | 제어 정책 CRUD (직원/구역/시간/행동 연결) |
| Time Policies | `/api/time-policies` | 시간 정책 템플릿 CRUD |
| Behavior Conditions | `/api/behavior-conditions` | 행동 조건 CRUD |
| Harmful Apps | `/api/harmful-apps` | 유해 앱/프리셋 관리 |
| Work Types | `/api/work-types` | 근무 유형 CRUD |
| Control Logs | `/api/control-logs` | 제어 로그 조회 |
| Audit Logs | `/api/audit-logs` | 감사 로그 조회 |
| Login History | `/api/login-history` | 관리자 로그인 기록 |
| Dashboard | `/api/dashboard` | 통계, 차트, 리포트 API |
| Permissions | `/api/permissions` | 역할별 권한 관리 |

## 로컬 개발 환경 설정

### 1. 사전 요구 사항

- Node.js 20.x
- PostgreSQL 16 (또는 Docker)
- npm

### 2. 의존성 설치

```bash
npm install
```

### 3. 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/smombie?schema=public
PORT=3000
JWT_SECRET=your-admin-jwt-secret
JWT_EXPIRATION=1d
CORS_ORIGIN=*
```

### 4. DB 마이그레이션 & 시드 (공용 Prisma)

먼저 공용 Prisma 레포를 별도 폴더로 클론합니다.

```bash
cd ..
git clone <SMOMBIE_PRISMA_REPO_URL> smombie-prisma
cd smombie-admin-backend
```

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

`admin-backend`는 상위 경로의 `../smombie-prisma/prisma`를 단일 소스로 사용하며, 마이그레이션 실행 권한도 이 서비스가 소유합니다.

전환 기간 호환을 위해 스크립트는 `../smombie-prisma/prisma`를 우선 사용하고, 없으면 기존 `../../prisma`를 fallback으로 참조합니다.

시드 데이터: 관리자 4명, 조직 11개, 직원 55명, 디바이스 45개, 구역 22개, 정책 15개 외 다수

### 5. 개발 서버 실행

```bash
npm run dev
```

서버 실행 후:
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs

## Docker 실행

### 단독 빌드

```bash
docker build -t smombie-admin-backend .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:password@host.docker.internal:5432/smombie \
  -e JWT_SECRET=your-secret \
  smombie-admin-backend
```

### Docker Compose (전체 시스템)

프로젝트 상위 디렉토리에서:

```bash
docker compose up -d
```

포트 매핑:
- Admin API: `14000`
- App API: `14100`
- Frontend: `14080`

## 프로젝트 구조

```
src/
├── main.ts                     # 앱 진입점
├── app.module.ts               # 루트 모듈
├── common/
│   ├── dto/                    # 공통 DTO (페이지네이션 등)
│   ├── filters/                # 글로벌 예외 필터
│   └── interceptors/           # 응답 변환 인터셉터
├── modules/
│   ├── accounts/               # 관리자 계정
│   ├── audit-logs/             # 감사 로그
│   ├── auth/                   # 인증 (JWT)
│   ├── behavior-conditions/    # 행동 조건
│   ├── control-logs/           # 제어 로그
│   ├── control-policies/       # 제어 정책
│   ├── dashboard/              # 대시보드 통계
│   ├── devices/                # 디바이스
│   ├── employees/              # 직원 관리
│   ├── harmful-apps/           # 유해 앱
│   ├── login-history/          # 로그인 기록
│   ├── organizations/          # 조직 구조
│   ├── permissions/            # 권한 관리
│   ├── time-policies/          # 시간 정책
│   ├── work-types/             # 근무 유형
│   └── zones/                  # 구역 관리
└── prisma/
    ├── prisma.module.ts
    └── prisma.service.ts
../smombie-prisma/prisma/
├── schema.prisma               # 공용 DB 스키마
├── seed.ts                     # 공용 시드 스크립트
└── migrations/                 # 공용 마이그레이션 파일
```

## 데모 계정

| 역할 | 아이디 | 비밀번호 | 소속 |
|------|--------|----------|------|
| 슈퍼 관리자 | admin | admin123 | 전체 |
| 현장 관리자 | site1 | site123 | 판교 현장 |
| 현장 관리자 | site2 | site123 | 인천 물류센터 |
| 조회자 | viewer1 | viewer123 | 서울 본사 |

## 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 (watch 모드) |
| `npm run build` | 프로덕션 빌드 |
| `npm run start:prod` | 프로덕션 실행 |
| `npm run prisma:generate` | Prisma 클라이언트 생성 |
| `npm run prisma:migrate` | DB 마이그레이션 (개발) |
| `npm run prisma:migrate:prod` | DB 마이그레이션 (프로덕션) |
| `npm run prisma:seed` | 시드 데이터 삽입 |
| `npm run prisma:studio` | Prisma Studio (DB GUI) |
| `npm run db:reset` | DB 초기화 + 재마이그레이션 |
