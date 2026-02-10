-- DropForeignKey
ALTER TABLE "admin_login_history" DROP CONSTRAINT "admin_login_history_accountId_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_accountId_fkey";

-- AlterTable
ALTER TABLE "admin_login_history" ALTER COLUMN "accountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "accountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "harmful_app_presets" ADD COLUMN     "platform" VARCHAR(20) NOT NULL DEFAULT 'android';

-- AddForeignKey
ALTER TABLE "admin_login_history" ADD CONSTRAINT "admin_login_history_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
