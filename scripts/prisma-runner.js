const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveSchemaPath() {
  const schemaEnv = process.env.PRISMA_SCHEMA_PATH;
  const candidates = [
    schemaEnv,
    path.resolve(__dirname, '..', 'prisma', 'schema.prisma'),
    path.resolve(__dirname, '..', '..', 'smombie-prisma', 'prisma', 'schema.prisma'),
    path.resolve(__dirname, '..', '..', 'smombie-prisma', 'schema.prisma'),
    path.resolve(__dirname, '..', 'smombie-prisma', 'prisma', 'schema.prisma'),
    path.resolve(__dirname, '..', 'smombie-prisma', 'schema.prisma'),
    path.resolve(__dirname, '..', '..', 'prisma', 'schema.prisma'),
  ];

  const schemaPath = resolveExistingPath(candidates);
  if (!schemaPath) {
    console.error(
      'Prisma schema를 찾을 수 없습니다. ../smombie-prisma/prisma/schema.prisma 경로를 확인하세요.',
    );
    process.exit(1);
  }

  return schemaPath;
}

function resolveSeedPath() {
  const seedEnv = process.env.PRISMA_SEED_PATH;
  const candidates = [
    seedEnv,
    path.resolve(__dirname, '..', 'prisma', 'seed.from-db.ts'),
    path.resolve(__dirname, '..', 'prisma', 'seed.ts'),
    path.resolve(__dirname, '..', '..', 'smombie-prisma', 'prisma', 'seed.ts'),
    path.resolve(__dirname, '..', '..', 'smombie-prisma', 'prisma', 'seed.from-db.ts'),
    path.resolve(__dirname, '..', '..', 'smombie-prisma', 'seed.ts'),
    path.resolve(__dirname, '..', '..', 'smombie-prisma', 'seed.from-db.ts'),
    path.resolve(__dirname, '..', 'smombie-prisma', 'prisma', 'seed.ts'),
    path.resolve(__dirname, '..', 'smombie-prisma', 'prisma', 'seed.from-db.ts'),
    path.resolve(__dirname, '..', 'smombie-prisma', 'seed.ts'),
    path.resolve(__dirname, '..', 'smombie-prisma', 'seed.from-db.ts'),
    path.resolve(__dirname, '..', '..', 'prisma', 'seed.ts'),
    path.resolve(__dirname, '..', '..', 'prisma', 'seed.from-db.ts'),
  ];

  const seedPath = resolveExistingPath(candidates);
  if (!seedPath) {
    console.error(
      'Prisma seed 파일을 찾을 수 없습니다. ../smombie-prisma/prisma/seed.from-db.ts 또는 seed.ts 경로를 확인하세요.',
    );
    process.exit(1);
  }

  return seedPath;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    shell: isWindows,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
}

const args = process.argv.slice(2);
const mode = args[0];

if (mode === 'seed') {
  const seedPath = resolveSeedPath();
  const npxBin = isWindows ? 'npx.cmd' : 'npx';
  run(npxBin, ['ts-node', seedPath]);
}

if (mode === 'prisma') {
  const prismaArgs = args.slice(1);
  if (prismaArgs.length === 0) {
    console.error('실행할 prisma 명령을 입력하세요. 예: prisma generate');
    process.exit(1);
  }

  const schemaPath = resolveSchemaPath();
  const npxBin = isWindows ? 'npx.cmd' : 'npx';
  run(npxBin, ['prisma', ...prismaArgs, '--schema', schemaPath]);
}

console.error('지원하지 않는 모드입니다. 사용법: node scripts/prisma-runner.js <prisma|seed> ...');
process.exit(1);
