import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { readCssColorToken } from "../lib/read-css-color";

interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
  darkColor?: string;
  lightColor?: string;
}

function readThemeQrColors(
  darkColor: string | undefined,
  lightColor: string | undefined,
): { dark: string; light: string } {
  if (darkColor && lightColor) return { dark: darkColor, light: lightColor };

  const probe = document.createElement("span");
  document.documentElement.appendChild(probe);
  try {
    return {
      dark: darkColor ?? readCssColorToken(probe, "--text-primary") ?? "white",
      light:
        lightColor ?? readCssColorToken(probe, "--jam-dark-surface") ?? "black",
    };
  } finally {
    probe.remove();
  }
}

export function QrCodeImage({
  value,
  size = 180,
  className,
  darkColor,
  lightColor,
}: QrCodeImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const colors = readThemeQrColors(darkColor, lightColor);
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: colors,
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [size, value, darkColor, lightColor]);

  if (!src) {
    return <div className={className} style={{ width: size, height: size }} />;
  }

  return (
    <img
      src={src}
      alt="QR code"
      width={size}
      height={size}
      className={className}
    />
  );
}
