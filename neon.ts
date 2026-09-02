import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Managed Better Auth. This issues the Ed25519 JWT whose `sub` claim RLS reads
  // through auth.user_id(). Enabling it here rather than in the console keeps the
  // project's service configuration in version control alongside the migrations.
  auth: true,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
