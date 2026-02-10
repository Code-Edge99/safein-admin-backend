/*
  Warnings:

  - You are about to drop the column `refreshToken` on the `employee_accounts` table. All the data in the column will be lost.
  - You are about to drop the `device_push_tokens` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "device_push_tokens" DROP CONSTRAINT "device_push_tokens_deviceId_fkey";

-- AlterTable
ALTER TABLE "device_tokens" ADD COLUMN     "refreshToken" VARCHAR(500);

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "pushToken" VARCHAR(500);

-- AlterTable
ALTER TABLE "employee_accounts" DROP COLUMN "refreshToken";

-- DropTable
DROP TABLE "device_push_tokens";
