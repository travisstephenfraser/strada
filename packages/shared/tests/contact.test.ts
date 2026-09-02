import { describe, expect, it } from "vitest";
import {
  LIMITS,
  PRIORITIES,
  contactInputSchema,
  contactPatchSchema,
  fieldErrors,
  stripServerOwnedFields,
} from "../src/contact.js";

describe("contactInputSchema — the validation contract", () => {
  it("accepts a complete contact", () => {
    const result = contactInputSchema.safeParse({
      name: "Priya Raman",
      company: "Anthropic",
      role: "Research",
      met_where: "Sutardja Center mixer",
      notes: "Wants to talk about eval design.",
      priority: "high",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a name alone and defaults priority to medium", () => {
    const result = contactInputSchema.safeParse({ name: "Sam Osei" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe("medium");
  });

  describe("rejects invalid names", () => {
    it("rejects an empty name", () => {
      const result = contactInputSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(fieldErrors(result.error).name).toMatch(/name is required/i);
      }
    });

    it("rejects a whitespace-only name, matching the DB's btrim CHECK", () => {
      const result = contactInputSchema.safeParse({ name: "   \t  " });
      expect(result.success).toBe(false);
    });

    it("rejects a missing name", () => {
      const result = contactInputSchema.safeParse({ company: "Stripe" });
      expect(result.success).toBe(false);
    });

    it(`rejects a name longer than ${LIMITS.name} characters`, () => {
      const result = contactInputSchema.safeParse({
        name: "a".repeat(LIMITS.name + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("rejects invalid priorities", () => {
    it.each(["urgent", "HIGH", "", "critical", null, 1])(
      "rejects priority %o",
      (priority) => {
        const result = contactInputSchema.safeParse({
          name: "Dana Whitfield",
          priority,
        });
        expect(result.success).toBe(false);
      },
    );

    it.each(PRIORITIES)("accepts priority %s", (priority) => {
      const result = contactInputSchema.safeParse({
        name: "Dana Whitfield",
        priority,
      });
      expect(result.success).toBe(true);
    });
  });

  it("rejects over-length notes, matching the DB CHECK", () => {
    const result = contactInputSchema.safeParse({
      name: "Marcus Oyelaran",
      notes: "a".repeat(LIMITS.notes + 1),
    });
    expect(result.success).toBe(false);
  });

  it("trims values and drops empty optional strings rather than storing them", () => {
    const result = contactInputSchema.safeParse({
      name: "  Priya Raman  ",
      company: "   ",
      role: "  Research  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Priya Raman");
      expect(result.data.company).toBeUndefined();
      expect(result.data.role).toBe("Research");
    }
  });

  it("drops unknown keys instead of passing them upstream", () => {
    const result = contactInputSchema.safeParse({
      name: "Sam Osei",
      is_admin: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("is_admin");
  });
});

describe("contactPatchSchema", () => {
  it("accepts a single-field edit", () => {
    expect(contactPatchSchema.safeParse({ priority: "low" }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(contactPatchSchema.safeParse({}).success).toBe(false);
  });

  it("still rejects a blank name on edit", () => {
    expect(contactPatchSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});

describe("stripServerOwnedFields", () => {
  it("removes every field the client may not set", () => {
    const stripped = stripServerOwnedFields({
      name: "Priya Raman",
      id: "00000000-0000-4000-8000-000000000000",
      user_id: "someone-else",
      created_at: "1970-01-01T00:00:00Z",
      updated_at: "1970-01-01T00:00:00Z",
    });
    expect(stripped).toEqual({ name: "Priya Raman" });
  });
});
