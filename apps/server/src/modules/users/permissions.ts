export type Permission =
  | "system:user:manage"
  | "system:role:manage"
  | "connection:read"
  | "connection:write"
  | "tdengine:metadata:read"
  | "tdengine:data:read"
  | "tdengine:data:create"
  | "tdengine:data:update"
  | "tdengine:data:delete"
  | "tdengine:sql:execute"
  | "audit:read";

export const rolePermissions: Record<string, Permission[]> = {
  admin: [
    "system:user:manage",
    "system:role:manage",
    "connection:read",
    "connection:write",
    "tdengine:metadata:read",
    "tdengine:data:read",
    "tdengine:data:create",
    "tdengine:data:update",
    "tdengine:data:delete",
    "tdengine:sql:execute",
    "audit:read"
  ],
  editor: [
    "connection:read",
    "tdengine:metadata:read",
    "tdengine:data:read",
    "tdengine:data:create",
    "tdengine:data:update",
    "tdengine:data:delete",
    "tdengine:sql:execute",
    "audit:read"
  ],
  viewer: ["connection:read", "tdengine:metadata:read", "tdengine:data:read", "audit:read"]
};

export function collectPermissions(roleCodes: string[]) {
  return Array.from(new Set(roleCodes.flatMap((code) => rolePermissions[code] ?? [])));
}
