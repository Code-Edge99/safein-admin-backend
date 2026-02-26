const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const prismaProjectDir = path.resolve(backendRoot, '..', 'smombie-prisma');

const sourcePrismaClientDir = path.resolve(prismaProjectDir, 'node_modules', '.prisma', 'client');
const sourceAtPrismaClientDir = path.resolve(prismaProjectDir, 'node_modules', '@prisma', 'client');

const targetPrismaClientDir = path.resolve(backendRoot, 'node_modules', '.prisma', 'client');
const targetAtPrismaClientDir = path.resolve(backendRoot, 'node_modules', '@prisma', 'client');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Source not found: ${source}`);
  }
  ensureDir(target);
  fs.cpSync(source, target, { recursive: true, force: true });
}

function ensurePrismaProjectReady() {
  if (!fs.existsSync(prismaProjectDir)) {
    throw new Error('smombie-prisma 폴더를 찾을 수 없습니다. 백엔드 서버에도 smombie-prisma를 함께 배포하세요.');
  }

  const hasSourceClient = fs.existsSync(sourcePrismaClientDir) && fs.existsSync(sourceAtPrismaClientDir);
  if (hasSourceClient) return;

  console.log('[setup-prisma-client] Generating Prisma client in smombie-prisma...');
  execSync('npm install --no-audit --no-fund', { cwd: prismaProjectDir, stdio: 'inherit' });
  execSync('npm run -s prisma:generate', { cwd: prismaProjectDir, stdio: 'inherit' });
}

try {
  ensurePrismaProjectReady();
  copyDir(sourcePrismaClientDir, targetPrismaClientDir);
  copyDir(sourceAtPrismaClientDir, targetAtPrismaClientDir);
  console.log('[setup-prisma-client] Prisma client synced to smombie-admin-backend/node_modules');
} catch (error) {
  console.error(`[setup-prisma-client] ${error.message}`);
  process.exit(1);
}
