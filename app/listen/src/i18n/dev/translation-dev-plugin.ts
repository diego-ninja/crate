import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { hashSourceMessage } from "../quality/source-hash";

const CATALOG_ENDPOINT_PREFIX = "/__crate_i18n/catalogs";
const DEFAULT_CATALOGS_DIR = join(process.cwd(), "src/i18n/catalogs");
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

interface TranslationDevPluginOptions {
  catalogsDir?: string;
  enabled?: boolean;
}

interface PatchCatalogBody {
  key: string;
  value: string;
  markReviewed?: boolean;
}

type JsonRecord = Record<string, unknown>;
type MessageRecord = Record<string, string>;
type MetadataRecord = Record<
  string,
  string | { sourceHash: string; reviewedAt?: string }
>;

export function patchCatalogMessage(
  catalogJson: string,
  key: string,
  value: string,
): string {
  const messages = parseMessageRecord(catalogJson);
  messages[key] = value;

  return stringifySortedJson(messages);
}

export function patchCatalogMetadata(
  metadataJson: string,
  key: string,
  sourceHash: string,
  reviewedAt: string,
): string {
  const metadata = parseMetadataRecord(metadataJson);
  metadata[key] = { sourceHash, reviewedAt };

  return stringifySortedJson(metadata);
}

export function translationDevPlugin(
  options: TranslationDevPluginOptions = {},
): Plugin {
  const enabled = options.enabled ?? process.env.VITE_TRANSLATION_MODE === "1";
  const catalogsDir = options.catalogsDir ?? DEFAULT_CATALOGS_DIR;

  return {
    name: "crate-listen-translation-dev",
    apply: "serve",
    configureServer(server) {
      if (!enabled) {
        return;
      }

      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(CATALOG_ENDPOINT_PREFIX)) {
          next();
          return;
        }

        void handleTranslationDevRequest({
          request,
          response,
          server,
          catalogsDir,
          now: () => new Date(),
        }).catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : "Unknown translation error";
          respondJson(response, 500, { error: message });
        });
      });
    },
  };
}

async function handleTranslationDevRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  server: ViteDevServer;
  catalogsDir: string;
  now: () => Date;
}): Promise<void> {
  const { request, response, server, catalogsDir, now } = input;
  const url = new URL(request.url ?? "/", "http://localhost");
  const endpoint = url.pathname.replace(/\/$/, "");
  const locale = decodeLocale(endpoint);

  try {
    if (request.method === "GET" && endpoint === CATALOG_ENDPOINT_PREFIX) {
      const locales = await listCatalogLocales(catalogsDir);
      respondJson(response, 200, { locales });
      return;
    }

    if (request.method === "GET" && locale) {
      const messages = await readCatalog(catalogsDir, locale);
      respondJson(response, 200, { locale, messages });
      return;
    }

    if (request.method === "PATCH" && locale) {
      const patch = parsePatchCatalogBody(await readRequestJson(request));
      const catalogPath = catalogFilePath(catalogsDir, locale);
      const existingCatalog = await readFile(catalogPath, "utf8");
      const nextCatalog = patchCatalogMessage(
        existingCatalog,
        patch.key,
        patch.value,
      );
      await writeFile(catalogPath, nextCatalog, "utf8");

      let reviewed = false;
      if (patch.markReviewed && locale !== "en") {
        reviewed = await patchReviewedMetadata({
          catalogsDir,
          locale,
          key: patch.key,
          reviewedAt: now().toISOString(),
        });
      }

      await server.moduleGraph.invalidateAll();
      respondJson(response, 200, {
        locale,
        key: patch.key,
        value: patch.value,
        reviewed,
      });
      return;
    }

    respondJson(response, 404, { error: "Translation endpoint not found" });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Invalid translation request";
    respondJson(response, 400, { error: message });
  }
}

async function patchReviewedMetadata(input: {
  catalogsDir: string;
  locale: string;
  key: string;
  reviewedAt: string;
}): Promise<boolean> {
  const { catalogsDir, locale, key, reviewedAt } = input;
  const sourceCatalog = await readCatalog(catalogsDir, "en");
  const source = sourceCatalog[key];

  if (source === undefined) {
    return false;
  }

  const metadataPath = join(catalogsDir, ".metadata", `${locale}.json`);
  const metadataJson = existsSync(metadataPath)
    ? await readFile(metadataPath, "utf8")
    : "{}";
  const nextMetadata = patchCatalogMetadata(
    metadataJson,
    key,
    hashSourceMessage(key, source),
    reviewedAt,
  );

  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, nextMetadata, "utf8");

  return true;
}

async function listCatalogLocales(catalogsDir: string): Promise<string[]> {
  const entries = await readdir(catalogsDir, { withFileTypes: true });

  return entries
    .reduce<string[]>((locales, entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) return locales;
      const locale = entry.name.slice(0, -".json".length);
      if (isSafeLocale(locale)) locales.push(locale);
      return locales;
    }, [])
    .sort((a, b) => a.localeCompare(b));
}

async function readCatalog(
  catalogsDir: string,
  locale: string,
): Promise<MessageRecord> {
  assertSafeLocale(locale);
  return parseMessageRecord(
    await readFile(catalogFilePath(catalogsDir, locale), "utf8"),
  );
}

function catalogFilePath(catalogsDir: string, locale: string): string {
  assertSafeLocale(locale);
  return join(catalogsDir, `${locale}.json`);
}

function decodeLocale(endpoint: string): string | null {
  const prefix = `${CATALOG_ENDPOINT_PREFIX}/`;
  if (!endpoint.startsWith(prefix)) {
    return null;
  }

  const locale = endpoint.slice(prefix.length);
  return locale ? decodeURIComponent(locale) : null;
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody.trim()) {
    throw new Error("Request body is required");
  }

  return JSON.parse(rawBody) as unknown;
}

function parsePatchCatalogBody(value: unknown): PatchCatalogBody {
  if (!isJsonRecord(value)) {
    throw new Error("Patch body must be an object");
  }

  if (typeof value.key !== "string" || value.key.trim() === "") {
    throw new Error("Patch body key must be a non-empty string");
  }

  if (typeof value.value !== "string") {
    throw new Error("Patch body value must be a string");
  }

  return {
    key: value.key,
    value: value.value,
    markReviewed: value.markReviewed === true,
  };
}

function parseMessageRecord(json: string): MessageRecord {
  const parsed = JSON.parse(json) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error("Catalog must be a JSON object");
  }

  const messages: MessageRecord = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`Catalog message "${key}" must be a string`);
    }
    messages[key] = value;
  }

  return messages;
}

function parseMetadataRecord(json: string): MetadataRecord {
  const parsed = JSON.parse(json) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error("Metadata must be a JSON object");
  }

  const metadata: MetadataRecord = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      metadata[key] = value;
      continue;
    }

    if (
      isJsonRecord(value) &&
      typeof value.sourceHash === "string" &&
      (value.reviewedAt === undefined || typeof value.reviewedAt === "string")
    ) {
      metadata[key] = {
        sourceHash: value.sourceHash,
        ...(value.reviewedAt ? { reviewedAt: value.reviewedAt } : {}),
      };
      continue;
    }

    throw new Error(`Metadata entry "${key}" must contain a source hash`);
  }

  return metadata;
}

function stringifySortedJson<T>(record: Record<string, T>): string {
  const sorted = Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );

  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeLocale(locale: string): boolean {
  return LOCALE_PATTERN.test(locale);
}

function assertSafeLocale(locale: string): void {
  if (!isSafeLocale(locale)) {
    throw new Error("Invalid locale");
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(body));
}
