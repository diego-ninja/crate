import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

let isDesktop = true;
let canHover = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

vi.mock("@/lib/input-capabilities", () => ({
  isTouchDominantPointer: () => false,
}));

vi.mock("@/lib/platform", () => ({
  capacitorPlatform: "web",
  getListenAppId: () => "listen-web",
  getListenRuntime: () => "web",
  isCapacitorRuntime: false,
  isTauriRuntime: false,
  isWebRuntime: true,
  listenRuntime: "web",
  shouldRegisterServiceWorker: true,
  supportsHaptics: false,
  usesConfigurableServer: false,
  usesMobileShell: false,
  usesNativeFilesystem: false,
}));

const navigateMock = vi.fn();
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const user = createMockAuthUser({
  email: "diego@example.test",
  name: "Diego",
  username: "diego",
});

function renderMenu() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 16,
    left: 320,
    right: 368,
    bottom: 64,
    width: 48,
    height: 48,
    toJSON: () => ({}),
  });

  return renderWithListenProviders(<TopBarUserMenu />, {
    auth: { user },
  });
}

function renderMenuInSpanish() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 16,
    left: 320,
    right: 368,
    bottom: 64,
    width: 48,
    height: 48,
    toJSON: () => ({}),
  });

  return renderWithListenProviders(<TopBarUserMenu />, {
    auth: { user },
    locale: "es",
  });
}

describe("TopBarUserMenu", () => {
  beforeEach(() => {
    isDesktop = true;
    canHover = true;
    navigateMock.mockClear();
    vi.restoreAllMocks();
  });

  it("uses the canonical glass context menu on desktop", async () => {
    renderMenu();

    expect(screen.getByRole("button", { name: "User menu" })).toHaveClass(
      "shadow-icon-control",
    );
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "rounded-[12px]",
      "z-app-context-menu",
    );
    expect(screen.getByText("Diego")).toBeInTheDocument();
    expect(screen.getByText("diego@example.test")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Settings/i }),
    ).toBeInTheDocument();
  });

  it("uses the canonical mobile sheet menu on touch layouts", async () => {
    isDesktop = false;
    canHover = false;
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "User menu" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".listen-glass-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Settings/i }),
    ).toBeInTheDocument();
  });

  it("localizes the user menu", () => {
    renderMenuInSpanish();

    fireEvent.click(screen.getByRole("button", { name: "Menú de usuario" }));

    expect(
      screen.getByRole("menuitem", { name: /Perfil/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Subir música/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Sugerir artista/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Cerrar sesión/i }),
    ).toBeInTheDocument();
  });

  it("localizes the artist suggestion modal", () => {
    renderMenuInSpanish();

    fireEvent.click(screen.getByRole("button", { name: "Menú de usuario" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Sugerir artista/i }));

    expect(screen.getByText("Adquisición")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sugerir artista" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Envía una petición a los admins de Crate para que puedan buscarlo y adquirirlo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Artista")).toBeInTheDocument();
    expect(screen.getByText("Enlace, si tienes uno")).toBeInTheDocument();
    expect(screen.getByText("Nota")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("High Vis, Denzel Curry, ..."),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Bandcamp, Tidal, Spotify, YouTube…"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("¿Por qué debería estar en Crate?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Enviar sugerencia" }),
    ).toBeVisible();
  });
});
