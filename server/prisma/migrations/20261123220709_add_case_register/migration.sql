CREATE TABLE "CaseType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "requestPattern" TEXT NOT NULL DEFAULT '^[A-Z0-9][A-Z0-9-]{2,49}$',
    "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "CaseType_name_key" ON "CaseType"("name");

CREATE TABLE "CaseRegister" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT '',
    "caseTypeId" INTEGER NOT NULL,
    "subReason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "remarks" TEXT NOT NULL DEFAULT '',
    "documentName" TEXT NOT NULL DEFAULT '',
    "documentPath" TEXT NOT NULL DEFAULT '',
    "documentMime" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAtGC" TEXT NOT NULL,
    "createdAtEC" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "updatedAtGC" TEXT NOT NULL DEFAULT '',
    "updatedAtEC" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    CONSTRAINT "CaseRegister_caseTypeId_fkey" FOREIGN KEY ("caseTypeId") REFERENCES "CaseType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseRegister_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseRegister_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CaseRegister_caseTypeId_requestNumber_key" ON "CaseRegister"("caseTypeId", "requestNumber");
CREATE INDEX "CaseRegister_branchId_caseTypeId_status_idx" ON "CaseRegister"("branchId", "caseTypeId", "status");
CREATE INDEX "CaseRegister_requestNumber_idx" ON "CaseRegister"("requestNumber");
CREATE INDEX "CaseRegister_region_zone_idx" ON "CaseRegister"("region", "zone");

CREATE TABLE "CaseAudit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "caseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL DEFAULT '{}',
    "afterJson" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT NOT NULL DEFAULT '',
    "atGC" TEXT NOT NULL,
    "atEC" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseAudit_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseRegister" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CaseAudit_caseId_createdAt_idx" ON "CaseAudit"("caseId", "createdAt");
