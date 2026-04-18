import { createApiReference } from "@scalar/api-reference";
import "@scalar/api-reference/style.css";
import "./style.css";

function detectEnvironment() {
  const host = window.location.hostname;
  const explicitHosts = {
    "reference.dev.cratemusic.app": {
      label: "Development",
      apiBaseUrl: "https://api.dev.lespedants.org",
    },
    "reference.cratemusic.app": {
      label: "Production",
      apiBaseUrl: "https://api.lespedants.org",
    },
    localhost: {
      label: "Local",
      apiBaseUrl: "http://localhost:8585",
    },
    "127.0.0.1": {
      label: "Local",
      apiBaseUrl: "http://127.0.0.1:8585",
    },
  };

  if (explicitHosts[host]) return explicitHosts[host];
  if (host.includes(".dev.")) {
    return {
      label: "Development",
      apiBaseUrl: "https://api.dev.lespedants.org",
    };
  }
  return {
    label: "Production",
    apiBaseUrl: "https://api.lespedants.org",
  };
}

const environment = detectEnvironment();

const crateBrandCss = `
  :root {
    --crate-accent: #22d3ee;
  }

  .light-mode,
  .dark-mode {
    --scalar-color-accent: var(--crate-accent);
    --scalar-background-accent: color-mix(in srgb, var(--crate-accent) 14%, transparent);
    --scalar-sidebar-color-active: var(--crate-accent);
    --scalar-sidebar-indent-border-active: color-mix(in srgb, var(--crate-accent) 45%, var(--scalar-border-color));
  }

  .references-classic-header-content[data-v-8a3822ca] {
    align-items: center;
  }

  .references-classic-header-content[data-v-8a3822ca]::before {
    content: "";
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border-radius: 8px;
    background: rgba(34, 211, 238, 0.08) url("/icons/logo.svg") center / 18px 18px no-repeat;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--crate-accent) 28%, transparent);
  }

  .references-classic-header[data-v-8a3822ca] {
    gap: 16px;
  }

  .api-reference-toolbar > div > .flex.flex-1.items-center {
    gap: 0;
  }

  .scalar-app .t-doc__sidebar {
    position: relative;
  }

  .scalar-app .t-doc__sidebar::before {
    content: "";
    position: absolute;
    top: 8px;
    right: 18px;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: rgba(34, 211, 238, 0.08) url("/icons/logo.svg") center / 15px 15px no-repeat;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--crate-accent) 28%, transparent);
    pointer-events: none;
    z-index: 2;
  }
`;

createApiReference("#app", {
  title: "Crate API Reference",
  metaData: {
    title: "Crate API Reference",
    description: "Standalone interactive API reference for Crate and its Subsonic compatibility layer.",
  },
  favicon: "/icons/logo.svg",
  layout: "modern",
  showSidebar: true,
  showDeveloperTools: "always",
  documentDownloadType: "both",
  searchHotKey: "k",
  customCss: crateBrandCss,
  pathRouting: {
    basePath: "/",
  },
  sources: [
    {
      title: "App & Listening",
      slug: "app-and-listening",
      url: `${environment.apiBaseUrl}/openapi-app.json`,
      default: true,
    },
    {
      title: "Collection Operations",
      slug: "collection-operations",
      url: `${environment.apiBaseUrl}/openapi-collection-ops.json`,
    },
    {
      title: "Admin & System",
      slug: "admin-and-system",
      url: `${environment.apiBaseUrl}/openapi-admin-system.json`,
    },
    {
      title: "Subsonic Compatibility",
      slug: "subsonic-compatibility",
      url: `${environment.apiBaseUrl}/openapi-subsonic.json`,
    },
  ],
});
