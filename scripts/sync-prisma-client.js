const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const prismaProjectDir = path.resolve(__dirname, '..', '..', 'smombie-prisma');
const sourcePrismaClientDir = path.resolve(prismaProjectDir, 'node_modules', '.prisma', 'client');
const sourceAtPrismaClientDir = path.resolve(prismaProjectDir, 'node_modules', '@prisma', 'client');

const targetPrismaClientDir = path.resolve(__dirname, '..', 'node_modules', '.prisma', 'client');
const targetAtPrismaClientDir = path.resolve(__dirname, '..', 'node_modules', '@prisma', 'client');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensurePrismaGenerated() {
  if (fs.existsSync(sourcePrismaClientDir) && fs.existsSync(sourceAtPrismaClientDir)) {
    return; // already generated
  }

  console.log('[sync-prisma-client] Prisma client not found in smombie-prisma. Running prisma generate...');

  // Ensure smombie-prisma dependencies are installed
  if (!fs.existsSync(path.join(prismaProjectDir, 'node_modules'))) {
    console.log('[sync-prisma-client] Installing smombie-prisma dependencies...');
    execSync('npm install', { cwd: prismaProjectDir, stdio: 'inherit' });
  }

  // Generate prisma client
  const schemaPath = path.join(prismaProjectDir, 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    console.error(`[sync-prisma-client] Schema not found: ${schemaPath}`);
    console.error('[sync-prisma-client] Skipping prisma client sync (schema missing).');
    process.exit(0);
  }

  execSync(`npx prisma generate --schema "${schemaPath}"`, {
    cwd: prismaProjectDir,
    stdio: 'inherit',
  });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) {
    console.warn(`[sync-prisma-client] Source not found after generate: ${source}`);
    console.warn('[sync-prisma-client] Skipping sync. Run "npm run prisma:generate" in smombie-prisma manually.');
    process.exit(0);
  }

  ensureDir(target);
  fs.cpSync(source, target, { recursive: true, force: true });
}

try {
  ensurePrismaGenerated();
  copyDir(sourcePrismaClientDir, targetPrismaClientDir);
  copyDir(sourceAtPrismaClientDir, targetAtPrismaClientDir);
  console.log('[sync-prisma-client] Prisma client artifacts synced to smombie-admin-backend/node_modules');
} catch (err) {
  console.warn(`[sync-prisma-client] Warning: ${err.message}`);
  console.warn('[sync-prisma-client] Run "npm run prisma:generate" in smombie-prisma, then "npm run prisma:generate" here.');
  // Don't fail npm install — just warn
}
