import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

const URL_PATTERN = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)}\]]$/;

function trimUrl(value: string): { url: string; trailing: string } {
  let url = value;
  let trailing = "";
  while (TRAILING_PUNCTUATION.test(url)) {
    trailing = `${url.slice(-1)}${trailing}`;
    url = url.slice(0, -1);
  }
  return { url, trailing };
}

export function truncateArtistBio(text: string, maxChars?: number): string {
  if (!maxChars || maxChars <= 0 || text.length <= maxChars) return text;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index < maxChars && match.index + match[0].length > maxChars) {
      return `${text.slice(0, match.index).trimEnd()}…`;
    }
  }
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

export function artistBioNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const raw = match[0];
    const { url, trailing } = trimUrl(raw);
    const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
    nodes.push(
      <a
        key={`${match.index}-${url}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      >
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export interface ArtistBioTextProps {
  text: string;
  maxChars?: number;
  expanded?: boolean;
  className?: string;
}

export function ArtistBioText({
  text,
  maxChars,
  expanded = false,
  className,
}: ArtistBioTextProps) {
  const displayText = expanded ? text : truncateArtistBio(text, maxChars);
  return (
    <span className={cn("whitespace-pre-line", className)}>
      {artistBioNodes(displayText)}
    </span>
  );
}
