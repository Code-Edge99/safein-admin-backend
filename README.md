# Smombie Admin Backend

스몸비 관리자 백엔드 API 서버 (NestJS + Prisma + PostgreSQL)

## 기술 스택

| 항목 | 버전 |
|------|------|
| Node.js | 20.x (LTS) |
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

## 설치 및 실행 (마이그레이션 포함)

아래 순서를 그대로 실행하면 로컬 개발 환경을 바로 띄울 수 있습니다.

### 1) 사전 요구 사항

- Node.js 20.x (LTS)
- npm
- PostgreSQL 16 (로컬 설치 또는 Docker)
- Git

### 2) 레포 배치

`smombie-admin-backend`와 `smombie-prisma`는 **같은 상위 폴더**에 있어야 합니다.

```bash
workspace/
  smombie-admin-backend/
  smombie-prisma/
```

이미 `smombie-admin-backend`가 있는 경우:

```bash
cd ..
git clone <SMOMBIE_PRISMA_REPO_URL> smombie-prisma
cd smombie-admin-backend
```

### 3) 환경 변수 설정

`smombie-admin-backend` 루트에 `.env` 파일 생성:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/smombie?schema=public
PORT=3000
JWT_SECRET=your-admin-jwt-secret
JWT_EXPIRATION=1d
CORS_ORIGIN=*
```

### 4) 의존성 설치

```bash
# smombie-admin-backend
npm install

# smombie-prisma (최초 1회 권장)
cd ../smombie-prisma
npm install
cd ../smombie-admin-backend
```

### 5) Prisma 생성/마이그레이션/시드

신규 DB(처음 세팅) 기준:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

- `prisma:generate`: Prisma Client 생성
- `prisma:migrate`: 개발용 마이그레이션 생성/적용 (`migrate dev`)
- `prisma:seed`: 기본 데이터 입력

운영/배포 환경(기존 마이그레이션 적용만)에서는 아래 사용:

```bash
npm run prisma:migrate:prod
```

### 6) 개발 서버 실행

```bash
npm run dev
```

서버 실행 후:
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs

### 7) 자주 쓰는 DB 명령어

```bash
npm run prisma:studio   # DB GUI
npm run db:reset        # 개발 DB 초기화 + 재마이그레이션 + 시드
```

## Prisma 경로 동작 방식

`scripts/prisma-runner.js`는 아래 순서로 스키마/시드 파일을 탐색합니다.

1. `PRISMA_SCHEMA_PATH`, `PRISMA_SEED_PATH` 환경 변수
2. `../smombie-prisma/prisma/*` (권장)
3. 기타 레거시 fallback 경로

즉, 기본 권장 구조는 `smombie-admin-backend`와 `smombie-prisma`를 동일 상위 폴더에 두는 방식입니다.

## Windows PowerShell 이슈 (npm.ps1 차단)

PowerShell에서 `npm run ...` 실행 시 실행 정책 오류가 나면 다음 중 하나를 사용하세요.

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

또는 정책 변경 없이:

```powershell
npm.cmd run dev
```

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
