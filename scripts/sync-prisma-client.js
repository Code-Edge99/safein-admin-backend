const fs = require('fs');
const path = require('path');

const sourcePrismaClientDir = path.resolve(__dirname, '..', '..', 'smombie-prisma', 'node_modules', '.prisma', 'client');
const sourceAtPrismaClientDir = path.resolve(__dirname, '..', '..', 'smombie-prisma', 'node_modules', '@prisma', 'client');

const targetPrismaClientDir = path.resolve(__dirname, '..', 'node_modules', '.prisma', 'client');
const targetAtPrismaClientDir = path.resolve(__dirname, '..', 'node_modules', '@prisma', 'client');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) {
    console.error(`[sync-prisma-client] source not found: ${source}`);
    process.exit(1);
  }

  ensureDir(target);
  fs.cpSync(source, target, { recursive: true, force: true });
}

copyDir(sourcePrismaClientDir, targetPrismaClientDir);
copyDir(sourceAtPrismaClientDir, targetAtPrismaClientDir);

console.log('[sync-prisma-client] Prisma client artifacts synced to smombie-admin-backend/node_modules');
