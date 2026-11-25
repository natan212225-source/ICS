import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const databasePath = path.resolve(process.cwd(), 'prisma', 'ics.db');
const backupDirectory = path.resolve(process.cwd(), 'prisma', 'backups');
fs.mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `ics.db.before-user-cleanup-${stamp}`);

if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
fs.copyFileSync(databasePath, backupPath);

const keptNames = new Set([
  'Adisalem Niguse',
  'Bekam Guta Medikso',
  'Tesfaye Kassahun Wondimu',
  'Super Admin'
]);
const aliases:Record<string,string> = {
  'Adisealem Niguse': 'Adisalem Niguse'
};

const superAdmin = await db.user.findFirst({
  where: { OR: [{ username: 'admin' }, { role: { name: 'SUPER_ADMIN' } }] },
  include: { role: true },
  orderBy: { id: 'asc' }
});
if (!superAdmin) throw new Error('Super Admin account not found');

const users = await db.user.findMany({ select: { id: true, username: true, fullName: true } });
const removable = users.filter(user =>
  user.id !== superAdmin.id &&
  !keptNames.has((aliases[user.fullName.trim()] || user.fullName.trim())) &&
  (user.username !== 'admin')
);
const removableIds = removable.map(user => user.id);

await db.$transaction(async tx => {
  for (const [alias, keptName] of Object.entries(aliases)) {
    await tx.user.updateMany({
      where: { fullName: { contains: alias } },
      data: { fullName: keptName }
    });
  }
  if (removableIds.length) {
    await tx.backedCustomer.updateMany({ where: { userId: { in: removableIds } }, data: { userId: superAdmin.id } });
    await tx.lostItem.updateMany({ where: { userId: { in: removableIds } }, data: { userId: superAdmin.id } });
    await tx.caseRegister.updateMany({ where: { userId: { in: removableIds } }, data: { userId: superAdmin.id } });
    await tx.caseAudit.updateMany({ where: { userId: { in: removableIds } }, data: { userId: superAdmin.id } });
    await tx.refreshSession.deleteMany({ where: { userId: { in: removableIds } } });

    await tx.approvalRequest.updateMany({
      where: { requestedBy: { in: removableIds } },
      data: { requestedBy: superAdmin.id }
    });

    await tx.user.deleteMany({ where: { id: { in: removableIds } } });
  }
});

await db.$disconnect();
console.log(`Database backup: ${backupPath}`);
console.log(`Deleted ${removableIds.length} non-approved accounts.`);
console.log(removable.map(user => `${user.username} (${user.fullName})`).join('\n'));
