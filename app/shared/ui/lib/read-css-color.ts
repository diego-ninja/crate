export function readCssColorToken(
  element: HTMLElement,
  tokenName: `--${string}`,
): string | null {
  const previousColor = element.style.getPropertyValue("color");
  const previousPriority = element.style.getPropertyPriority("color");

  element.style.setProperty("color", `var(${tokenName})`);
  const resolvedColor = getComputedStyle(element).color.trim();

  if (previousColor) {
    element.style.setProperty("color", previousColor, previousPriority);
  } else {
    element.style.removeProperty("color");
  }

  return resolvedColor || null;
}
