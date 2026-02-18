import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Login } from "./Login";

const { exchangeCodeMock, openUrlMock } = vi.hoisted(() => ({
  exchangeCodeMock: vi.fn(),
  openUrlMock: vi.fn(),
}));
const credentialsState = {
  info: { client_id: "client-123" as string | null, has_client_secret: true },
  loading: false,
  error: null as string | null,
};

vi.mock("../hooks/useBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useBridge")>();
  return {
    ...actual,
    useAuth: () => ({ exchangeCode: exchangeCodeMock, loading: false, error: null }),
    useClientCredentials: () => credentialsState,
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

describe("Login", () => {
  beforeEach(() => {
    exchangeCodeMock.mockReset();
    openUrlMock.mockReset();
    credentialsState.info = { client_id: "client-123", has_client_secret: true };
    credentialsState.loading = false;
    credentialsState.error = null;
  });

  it("opens OAuth url and signs in successfully", async () => {
    exchangeCodeMock.mockResolvedValue(true);
    const onLoginSuccess = vi.fn();

    render(<Login onLoginSuccess={onLoginSuccess} />);

    fireEvent.click(screen.getByRole("button", { name: /Get Verification Code/i }));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(String(openUrlMock.mock.calls[0][0])).toContain("client_id=client-123");

    fireEvent.change(screen.getByLabelText(/Verification Code/i), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText(/Org ID/i), { target: { value: "org-777" } });
    fireEvent.change(screen.getByLabelText(/Org Type/i), { target: { value: "cloud" } });

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(exchangeCodeMock).toHaveBeenCalledWith("abc", "org-777", "cloud");
      expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("disables OAuth button when credentials are missing", () => {
    credentialsState.info = { client_id: null, has_client_secret: false };

    render(<Login onLoginSuccess={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Get Verification Code/i })).toBeDisabled();
    expect(screen.getByText(/OAuth secrets are missing/i)).toBeInTheDocument();
  });
});
