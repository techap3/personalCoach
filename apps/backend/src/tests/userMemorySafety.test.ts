import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: any; error: any };

type Chain = {
  select: (...args: any[]) => Chain;
  eq: (...args: any[]) => Chain;
  limit: (...args: any[]) => Promise<QueryResult>;
  in: (...args: any[]) => Chain;
  or: (...args: any[]) => Chain;
  order: (...args: any[]) => Chain;
  upsert: (...args: any[]) => Promise<QueryResult>;
  maybeSingle: (...args: any[]) => Promise<QueryResult>;
};

const fromMock = vi.fn();
const getSupabaseClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("../db/supabase", () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

function makeGoalsFailureChain(): Chain {
  return {
    select: () => ({
      eq: () => ({
        limit: async () => ({
          data: null,
          error: new Error("goals read failed"),
        }),
      }),
    } as any),
    eq: (() => ({})) as any,
    limit: (async () => ({ data: null, error: null })) as any,
    in: (() => ({})) as any,
    or: (() => ({})) as any,
    order: (() => ({})) as any,
    upsert: (async () => ({ data: null, error: null })) as any,
    maybeSingle: (async () => ({ data: null, error: null })) as any,
  } as any;
}

describe("user memory safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits early and does not upsert when critical Supabase read fails", async () => {
    const upsertSpy = vi.fn(async () => ({ data: null, error: null }));

    fromMock.mockImplementation((table: string) => {
      if (table === "goals") {
        return makeGoalsFailureChain();
      }

      if (table === "user_preferences") {
        return {
          upsert: upsertSpy,
        };
      }

      return {
        select: () => ({
          in: () => ({
            or: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { updateUserPreferences } = await import("../services/memory/userMemory");
    await updateUserPreferences("token", "user-1", { force: true });

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
