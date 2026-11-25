import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const apply = process.argv.includes('--apply');
const testRoles = [
  ...Array.from({ length: 10 }, (_, index) => `Stress Role ${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `Test Role ${index + 1}`),
  'Repro Test Role',
  'Deep Valid Role',
  'No Permission Test Role'
];

const roles = await db.role.findMany({
  where: { name: { in: testRoles } },
  include: { users: { select: { id: true, username: true, fullName: true } } }
});

for (const role of roles) {
  console.log(`${role.name}: ${role.users.length} assigned user(s)`);
  for (const user of role.users) console.log(`  - ${user.username} (${user.fullName})`);
}

const missing = testRoles.filter(name => !roles.some(role => role.name === name));
for (const name of missing) console.log(`${name}: role not found`);

const assigned = roles.filter(role => role.users.length > 0);
if (apply && assigned.length) {
  console.error('Refusing to delete: test roles still have assigned users.');
  await db.$disconnect();
  process.exit(1);
}

if (!apply) {
  console.log('DRY RUN: no roles deleted. Re-run with --apply after assigning/removing users.');
  await db.$disconnect();
  process.exit(0);
}

await db.$transaction(async tx => {
  for (const role of roles) {
    await tx.role.delete({ where: { id: role.id } });
  }
});

console.log(`Applied: deleted ${roles.length} test role(s).`);
await db.$disconnect();
