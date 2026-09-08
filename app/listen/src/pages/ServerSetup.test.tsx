import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { ServerSetup } from "@/pages/ServerSetup";

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe("ServerSetup", () => {
  it("renders the first-run server setup in the active locale", () => {
    render(
      <I18nProvider initialLocale="es">
        <ServerSetup />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Conectar a un servidor Crate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Introduce la URL de API de tu instancia de Crate. Puedes añadir más servidores después desde Ajustes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("URL del servidor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Continuar/i })).toHaveClass(
      "shadow-action-solid",
    );
    expect(
      screen.getByRole("img", { name: "Crate" }).parentElement,
    ).toHaveClass("shadow-accent-action-strong");
    expect(
      screen.getByRole("button", { name: /Continuar/i }).closest("form"),
    ).toHaveClass("shadow-card");
    expect(
      screen.getByRole("button", { name: "Desarrollo local" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Configura uno en unos 5 minutos" }),
    ).toBeVisible();
  });
});
