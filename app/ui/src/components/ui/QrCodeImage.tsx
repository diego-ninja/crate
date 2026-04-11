import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeImage({
  value,
  size = 180,
  className,
}: QrCodeImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: {
        dark: "#111827",
        light: "#f8fafc",
      },
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
  }, [size, value]);

  if (!src) {
    return <div className={className} style={{ width: size, height: size }} />;
  }

  return <img src={src} alt="QR code" width={size} height={size} className={className} />;
}
