import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
  darkColor?: string;
  lightColor?: string;
}

export function QrCodeImage({
  value,
  size = 180,
  className,
  darkColor = "#f8fafc",
  lightColor = "#0f1116",
}: QrCodeImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: darkColor, light: lightColor },
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

  return <img src={src} alt="QR code" width={size} height={size} className={className} />;
}
