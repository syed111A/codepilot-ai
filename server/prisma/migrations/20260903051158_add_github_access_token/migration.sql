-- DropIndex
DROP INDEX "Repository_githubId_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "githubAccessToken" TEXT;

-- CreateIndex
CREATE INDEX "Repository_ownerId_idx" ON "Repository"("ownerId");
