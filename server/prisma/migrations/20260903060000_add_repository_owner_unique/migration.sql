-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_ownerId_key" ON "Repository"("githubId", "ownerId");
