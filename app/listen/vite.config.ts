import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://localhost:8585",
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: { "*": "" },
        headers: { cookie: "" },
        configure: (proxy) => {
          // Strip Secure and Domain from Set-Cookie so it works on localhost
          proxy.on("proxyRes", (proxyRes) => {
            const setCookie = proxyRes.headers["set-cookie"];
            if (setCookie) {
              proxyRes.headers["set-cookie"] = setCookie.map((c) =>
                c.replace(/;\s*Domain=[^;]*/gi, "")
                  .replace(/;\s*Secure/gi, "")
                  .replace(/;\s*SameSite=\w+/gi, "; SameSite=Lax"),
              );
            }
          });
        },
      },
    },
  },
});
