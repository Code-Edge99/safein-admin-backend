const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const prismaProjectDir = path.resolve(backendRoot, '..', 'safein-prisma');

const sourcePrismaClientDir = path.resolve(prismaProjectDir, 'node_modules', '.prisma', 'client');
const sourceAtPrismaClientDir = path.resolve(prismaProjectDir, 'node_modules', '@prisma', 'client');

const targetPrismaClientDir = path.resolve(backendRoot, 'node_modules', '.prisma', 'client');
const targetAtPrismaClientDir = path.resolve(backendRoot, 'node_modules', '@prisma', 'client');
const prismaSchemaPath = path.resolve(prismaProjectDir, 'prisma', 'schema.prisma');
const prismaMigrationsDir = path.resolve(prismaProjectDir, 'prisma', 'migrations');
const generatedClientIndexPath = path.resolve(sourcePrismaClientDir, 'index.d.ts');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Source not found: ${source}`);
  }
  ensureDir(target);
  if (process.platform === 'win32') {
    try {
      execSync(`robocopy "${source}" "${target}" /MIR /NJH /NJS /NP /NS /NC /NFL /NDL`, { stdio: 'ignore' });
    } catch (e) {
      // robocopy exit code < 8 means success (1=copied, 2=extra, 4=mismatch)
      if (e.status >= 8) throw new Error(`robocopy failed with code ${e.status}`);
    }
  } else {
    execSync(`cp -rf "${source}/." "${target}/"`, { stdio: 'ignore' });
  }
}

function getLatestModifiedTime(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stats = fs.statSync(targetPath);
  let latest = stats.mtimeMs;

  if (!stats.isDirectory()) {
    return latest;
  }

  for (const entry of fs.readdirSync(targetPath)) {
    const entryPath = path.join(targetPath, entry);
    const entryLatest = getLatestModifiedTime(entryPath);
    if (entryLatest > latest) {
      latest = entryLatest;
    }
  }

  return latest;
}

function isGeneratedClientStale() {
  if (!fs.existsSync(generatedClientIndexPath)) {
    return true;
  }

  const generatedAt = fs.statSync(generatedClientIndexPath).mtimeMs;
  const schemaUpdatedAt = getLatestModifiedTime(prismaSchemaPath);
  const migrationsUpdatedAt = getLatestModifiedTime(prismaMigrationsDir);

  return Math.max(schemaUpdatedAt, migrationsUpdatedAt) > generatedAt;
}

function ensurePrismaProjectReady() {
  if (!fs.existsSync(prismaProjectDir)) {
    throw new Error('safein-prisma 폴더를 찾을 수 없습니다. 백엔드 서버와 safein-prisma를 함께 배포하세요.');
  }

  const hasSourceClient = fs.existsSync(sourcePrismaClientDir) && fs.existsSync(sourceAtPrismaClientDir);
  if (hasSourceClient && !isGeneratedClientStale()) return;

  console.log('[setup-prisma-client] Generating Prisma client in safein-prisma...');
  if (!hasSourceClient) {
    execSync('npm install --no-audit --no-fund', { cwd: prismaProjectDir, stdio: 'inherit' });
  }
  execSync('npm run -s prisma:generate', { cwd: prismaProjectDir, stdio: 'inherit' });
}

try {
  ensurePrismaProjectReady();
  copyDir(sourcePrismaClientDir, targetPrismaClientDir);
  copyDir(sourceAtPrismaClientDir, targetAtPrismaClientDir);
  console.log('[setup-prisma-client] Prisma client synced to safein-admin-backend/node_modules');
} catch (error) {
  console.error(`[setup-prisma-client] ${error.message}`);
  process.exit(1);
}
