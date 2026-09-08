import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { PasswordChangeForm } from "./AccountSectionForms";

describe("PasswordChangeForm", () => {
  it("submits the visible password form and clears it on cancel", () => {
    const onChangePassword = vi.fn();
    const setShowPassword = vi.fn();
    const setCurrentPassword = vi.fn();
    const setNewPassword = vi.fn();
    const setConfirmPassword = vi.fn();

    render(
      <PasswordChangeForm
        showPassword
        setShowPassword={setShowPassword}
        currentPassword="current"
        newPassword="new-password"
        confirmPassword="new-password"
        setCurrentPassword={setCurrentPassword}
        setNewPassword={setNewPassword}
        setConfirmPassword={setConfirmPassword}
        saving={false}
        onChangePassword={onChangePassword}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.account.changePasswordAction",
      }),
    );
    expect(onChangePassword).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(setShowPassword).toHaveBeenCalledWith(false);
    expect(setCurrentPassword).toHaveBeenCalledWith("");
    expect(setNewPassword).toHaveBeenCalledWith("");
    expect(setConfirmPassword).toHaveBeenCalledWith("");
  });
});
