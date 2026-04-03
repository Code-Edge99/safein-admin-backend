const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const prismaProjectDir = path.resolve(backendRoot, '..', 'safein-prisma');

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

function ensurePrismaProjectReady() {
  if (!fs.existsSync(prismaProjectDir)) {
    throw new Error('safein-prisma ?¥ÎçîÎ•?Ï∞æÏùÑ ???ÜÏäµ?àÎã§. Î∞±Ïóî???úÎ≤Ñ?êÎèÑ safein-prismaÎ•??®Íªò Î∞∞Ìè¨?òÏÑ∏??');
  }

  const hasSourceClient = fs.existsSync(sourcePrismaClientDir) && fs.existsSync(sourceAtPrismaClientDir);
  if (hasSourceClient) return;

  console.log('[setup-prisma-client] Generating Prisma client in safein-prisma...');
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
