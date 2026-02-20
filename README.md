# Smombie Admin Backend

스몸비 관리자 API 서버 (NestJS + Prisma + PostgreSQL)

## 빠른 시작 (로컬 실행)

### 1) 사전 준비
- Node.js 20+ (권장: 24.x)
- PostgreSQL 16
- npm

### 2) 의존성 설치
```bash
npm install
```

### 3) 환경변수 설정
프로젝트 루트에 `.env` 생성:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/smombie?schema=public
PORT=3000
JWT_SECRET=your-admin-jwt-secret
JWT_EXPIRATION=1d
CORS_ORIGIN=*
```

### 4) 공용 Prisma 준비
`smombie-admin-backend`와 같은 레벨에 `smombie-prisma`가 있어야 합니다.
```bash
cd ..
git clone <SMOMBIE_PRISMA_REPO_URL> smombie-prisma
cd smombie-admin-backend
```

### 5) DB 반영 + 실행
```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

## 접속 주소
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs

## Docker 실행

### 단독 실행
```bash
docker build -t smombie-admin-backend .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:password@host.docker.internal:5432/smombie \
  -e JWT_SECRET=your-secret \
  smombie-admin-backend
```

### Compose 실행
```bash
docker compose up -d
```

## 데모 계정
| 역할 | 아이디 | 비밀번호 |
|------|--------|----------|
| 슈퍼 관리자 | admin | admin123 |
| 현장 관리자 | site1 | site123 |
| 현장 관리자 | site2 | site123 |
| 조회자 | viewer1 | viewer123 |

## 자주 쓰는 명령어
| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 빌드 |
| `npm run start:prod` | 프로덕션 실행 |
| `npm run prisma:generate` | Prisma Client 생성 |
| `npm run prisma:migrate` | 개발 마이그레이션 적용 |
| `npm run prisma:migrate:prod` | 운영 마이그레이션 적용 |
| `npm run prisma:seed` | 시드 데이터 반영 |
| `npm run prisma:studio` | Prisma Studio 실행 |
| `npm run db:reset` | DB 초기화/재생성 |

## 모듈 개요
주요 경로: `/api/auth`, `/api/accounts`, `/api/employees`, `/api/devices`, `/api/control-policies`, `/api/dashboard`

