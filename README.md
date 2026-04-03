# Safein Admin Backend

세이프인 관리자 API 서버입니다. (NestJS + Prisma + PostgreSQL)

## 개요
- API Prefix: `/api`
- Swagger: `/api/docs`
- Prisma 스키마/마이그레이션/시드는 `safein-prisma`에서만 관리
- 이 저장소의 `npm run prisma:*`는 차단되어 있으며, Prisma 관련 작업은 `safein-prisma`에서 실행해야 합니다.

## 사전 준비
- Node.js 20 이상
- npm
- PostgreSQL 16 이상

## 폴더 배치
아래 폴더가 같은 레벨(형제 디렉터리)에 있어야 합니다.

```text
safein/
  safein-prisma/
  safein-admin-backend/
  safein-app-backend/
```

`safein-admin-backend/scripts/setup-prisma-client.js`는 `../safein-prisma` 경로에서 Prisma Client를 동기화합니다.

## 빠른 실행

### 1) 공용 Prisma 준비 (최초 1회)
```bash
cd ../safein-prisma
npm install
npm run prisma:migrate
```

필요 시 시드 데이터 반영:

```bash
npm run prisma:seed
```

### 2) 환경변수 파일 생성
`safein-admin-backend/.env` 파일을 만들고 아래 예시를 기준으로 값을 채웁니다.

```env
# stage: dev | prod (local 문자열은 dev로 처리됨)
APP_STAGE=dev
NODE_ENV=development

PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/safein?schema=public

# 운영(prod)에서는 32자 이상 필수
JWT_SECRET=replace-with-32-plus-char-secret
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=replace-with-refresh-secret
JWT_REFRESH_EXPIRATION=30d
JWT_REFRESH_INACTIVITY=7d
JWT_REFRESH_ABSOLUTE_EXPIRATION=30d

# APP_STAGE 기준으로 *_DEV / *_PROD가 자동 매핑됨
CORS_ORIGIN_DEV=http://localhost:5173
CORS_ORIGIN_PROD=https://admin.example.com

APP_BACKEND_BASE_URL_DEV=http://localhost:3100/api/app
APP_BACKEND_BASE_URL_PROD=https://app-api.example.com/api/app

# 좌표 암복호화 키(32 bytes 필요: hex/base64/utf8)
LOCATION_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
LOCATION_ENCRYPTION_KEY_VERSION=1

# 선택: app-backend 내부 연동 보호
APP_BACKEND_MDM_ADMIN_SECRET=replace-with-internal-secret

# 선택: 지도 geocode fallback 프록시용
NCP_MAPS_API_KEY_ID=your-ncp-client-id
NCP_MAPS_API_KEY=your-ncp-client-secret

# 선택: 시스템 로그 DB 영속화
SYSTEM_LOG_PERSIST_ENABLED=true
SYSTEM_LOG_PERSIST_LEVELS=error,warn,log
```

주의:
- `APP_STAGE`는 `dev` 또는 `prod`만 의미 있게 처리됩니다.
- `CORS_ORIGIN`에 `*`와 명시 도메인을 함께 넣으면 서버가 에러로 종료됩니다.

### 3) 서버 설치/실행
```bash
cd ../safein-admin-backend
npm install
npm run dev
```

## 실행 확인
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs

Swagger 설명 영역과 서버 로그에서 개발용 무제한 토큰 정보를 확인할 수 있습니다.

## 자주 쓰는 명령어
| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 (watch) |
| `npm run build` | 빌드 |
| `npm run start:prod` | 프로덕션 실행 |
| `npm run test` | 단위 테스트 |
| `npm run lint` | 린트 |

Prisma 관련 명령은 아래처럼 `safein-prisma`에서 실행합니다.

```bash
npm --prefix ../safein-prisma run prisma:migrate
npm --prefix ../safein-prisma run prisma:migrate:deploy
npm --prefix ../safein-prisma run prisma:studio
```

## 운영 배포 메모
- 같은 DB를 공유하면 `prisma migrate deploy`는 한 파이프라인에서 1회만 실행하세요.
- `safein-prisma` 설치 시 seed 자동실행을 막으려면 다음 중 하나를 사용하세요.
  - `NODE_ENV=production`
  - `PRISMA_SEED_ON_INSTALL=false npm install`

## 트러블슈팅

### 서버가 시작 직후 종료되는 경우
- `JWT_SECRET` 누락/길이 부족 여부를 확인하세요. (prod에서 32자 이상 필수)
- `CORS_ORIGIN` 값에 `*`와 도메인이 동시에 들어갔는지 확인하세요.
- `DATABASE_URL` 연결 가능 여부를 확인하세요.

### Prisma 관련 명령이 실패하는 경우
- 이 저장소에서 `npm run prisma:*`를 실행하지 않았는지 확인하세요.
- `../safein-prisma` 폴더 존재 여부와 권한을 확인하세요.

### 지도 주소 검색 fallback이 동작하지 않는 경우
- `NCP_MAPS_API_KEY_ID`, `NCP_MAPS_API_KEY` 값을 확인하세요.
- geocode 프록시 엔드포인트: `/api/maps/geocode`

