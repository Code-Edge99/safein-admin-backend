## NCP Maps REST Geocoding 설정

관리자 프론트의 지도 주소 검색은 기본적으로 JS SDK geocoder를 사용하며,
SDK geocoder 실패 시 admin-backend의 `/api/maps/geocode` 프록시로 자동 fallback 됩니다.

아래 환경변수 중 하나를 설정하세요:

- 권장
  - `NCP_MAPS_API_KEY_ID=<NCP Client ID>`
  - `NCP_MAPS_API_KEY=<NCP Client Secret>`
- 호환(기존 변수명)
  - `NAVER_MAP_CLIENT_ID=<NCP Client ID>`
  - `NAVER_MAP_CLIENT_SECRET=<NCP Client Secret>`

프록시는 NCP Maps Geocoding REST API(`https://maps.apigw.ntruss.com/map-geocode/v2/geocode`)를 호출하며,
요청 헤더에 `x-ncp-apigw-api-key-id`, `x-ncp-apigw-api-key`를 사용합니다.
# Safein Admin Backend

세이프인 관리자 API 서버 (NestJS + Prisma + PostgreSQL)

## 현재 구조 기준 핵심 규칙
- Prisma 스키마/마이그레이션/시드는 `smombie-prisma`에서만 관리
- 이 서버의 `npm install`은 Prisma Client 동기화만 수행
- `npm run prisma:*` 명령은 여기서 실행하지 않음(안내 후 종료)

## 로컬 셋업 순서

### 1) 폴더 배치
아래 3개 폴더가 같은 레벨에 있어야 합니다.
```text
smombie/
  smombie-prisma/
  smombie-admin-backend/
  smombie-app-backend/
```

### 2) 사전 준비
- Node.js 20+
- PostgreSQL 16+
- npm

### 3) 환경변수 설정
`smombie-admin-backend/.env`
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/safein?schema=public
PORT=3000
JWT_SECRET=your-admin-jwt-secret
JWT_EXPIRATION=1d
CORS_ORIGIN=*
APP_BACKEND_BASE_URL=http://localhost:3100/api/app
```

### 4) 공용 Prisma 준비(최초 1회)
```bash
cd ../smombie-prisma
npm install
npm run prisma:migrate
```

### 5) Admin Backend 설치/실행
```bash
cd ../smombie-admin-backend
npm install
npm run dev
```

## 접속 주소
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs

## 운영 배포 규칙
- 같은 DB를 공유하면 `prisma migrate deploy`는 한 서버/한 파이프라인에서 1회만 실행
- 운영에서 `smombie-prisma` 설치 시 seed를 막으려면:
  - `NODE_ENV=production` 사용 또는
  - `PRISMA_SEED_ON_INSTALL=false npm install`

## 자주 쓰는 명령어
| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 빌드 |
| `npm run start:prod` | 프로덕션 실행 |
| `npm run prisma:*` | 사용 금지(공용 Prisma 저장소에서 실행) |

## 모듈 개요
주요 경로: `/api/auth`, `/api/accounts`, `/api/employees`, `/api/devices`, `/api/control-policies`, `/api/dashboard`

