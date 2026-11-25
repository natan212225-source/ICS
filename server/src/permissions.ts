export const allowedPermissions = [
 'create_backed','create_lost','read','update','approve_edit','approve_cancel','export','manage_users',
 'case.create','case.read','case.update','case.report','case.upload'
] as const;

export type Permission = typeof allowedPermissions[number];

export function parsePermissions(value: unknown): Permission[] {
 let values: unknown[] = [];
 if (Array.isArray(value)) {
  values = value;
 } else if (typeof value === 'string') {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
   const parsed = JSON.parse(trimmed);
   values = Array.isArray(parsed) ? parsed : [];
  } catch {
   values = trimmed.split(',');
  }
 }
 return [...new Set(values
  .map(item => typeof item === 'string' ? item.trim() : '')
  .filter((item): item is Permission => allowedPermissions.includes(item as Permission)))];
}

export function serializePermissions(value: unknown): string {
 return JSON.stringify(parsePermissions(value));
}
