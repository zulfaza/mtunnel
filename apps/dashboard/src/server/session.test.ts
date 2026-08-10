import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Errors } from "@tunnel/core";

const mocks = vi.hoisted(() => ({
  deleteCookie: vi.fn<(name: string, options: unknown) => void>(),
  getCookie: vi.fn<(name: string) => string | undefined>(),
  runCore: vi.fn<(effect: unknown) => Promise<unknown>>(),
  setCookie: vi.fn<(name: string, value: string, options: unknown) => void>(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  deleteCookie: mocks.deleteCookie,
  getCookie: mocks.getCookie,
  setCookie: mocks.setCookie,
}));

vi.mock("./runtime.js", () => ({ runCore: mocks.runCore }));

import { requireUser, SignedOutError, writeSession } from "./session.js";

describe("dashboard session", () => {
  beforeEach(() => {
    mocks.deleteCookie.mockReset();
    mocks.getCookie.mockReset();
    mocks.runCore.mockReset();
    mocks.setCookie.mockReset();
  });

  it("clears a session when authentication and refresh are unauthorized", async () => {
    let cookie: string | undefined;
    mocks.setCookie.mockImplementation((name, value) => {
      if (name === "mt_session") cookie = value;
    });
    mocks.getCookie.mockImplementation((name) => (name === "mt_session" ? cookie : undefined));
    await writeSession({ accessToken: "expired", refreshToken: "revoked", email: "zul@test" });
    mocks.runCore
      .mockRejectedValueOnce(new Errors.UnauthorizedError({}))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(requireUser()).rejects.toBeInstanceOf(SignedOutError);
    expect(mocks.deleteCookie).toHaveBeenCalledWith(
      "mt_session",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("preserves a session for unexpected authentication failures", async () => {
    let cookie: string | undefined;
    mocks.setCookie.mockImplementation((name, value) => {
      if (name === "mt_session") cookie = value;
    });
    mocks.getCookie.mockImplementation((name) => (name === "mt_session" ? cookie : undefined));
    await writeSession({ accessToken: "current", refreshToken: "current", email: "zul@test" });
    const failure = new Error("network_failed");
    mocks.runCore.mockRejectedValueOnce(failure);

    await expect(requireUser()).rejects.toBe(failure);
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });
});
