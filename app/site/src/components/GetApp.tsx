import { Download, Smartphone, Apple, Share2, ArrowRight } from "lucide-react";

/**
 * "Get the app" section — two paths side by side.
 *
 * Android: a real APK download (debug build attached to every GitHub
 * release by the build-android workflow).
 *
 * iPhone: no APK equivalent exists without an Apple Developer account,
 * so we embrace PWA and walk the user through Safari's "Add to Home
 * Screen" flow. The result is a near-native standalone app with our
 * own icon and splash, no App Store, no review.
 */

export function GetApp() {
  return (
    <section id="install" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-28">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Install it
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          Use it from the phone.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate is still a self-hosted system, but listening should not feel like
          remote administration. Point the app at an instance and use it like a normal
          music player.
        </p>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* ── Android / APK ─────────────────────────────────────── */}
        <article className="border-t border-white/10 pt-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="text-cyan-300">
              <Smartphone size={19} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Android
              </div>
              <div className="text-lg font-semibold text-white">Install the Android build</div>
            </div>
          </div>

          <p className="text-[14.5px] leading-[1.65] text-white/60">
            Each release can include an Android build. Download it, install it, and
            connect it to your Crate server.
          </p>

          <ol className="mt-5 space-y-2.5 text-[14px] text-white/70">
            <Step n={1}>Download the APK below.</Step>
            <Step n={2}>Open it from your downloads; approve the install prompt.</Step>
            <Step n={3}>Launch Crate, enter your server URL, sign in.</Step>
          </ol>

          <a
            href="https://github.com/thecrateapp/crate/releases/latest/download/crate.apk"
            className="group mt-7 inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#05161c] shadow-[0_0_24px_-6px_rgba(6,182,212,0.6)] transition hover:bg-cyan-300"
          >
            <Download size={16} />
            Download crate.apk
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </a>
          <p className="mt-3 text-[11px] text-white/35">
            From the latest GitHub release.
          </p>
        </article>

        {/* ── iPhone / PWA ──────────────────────────────────────── */}
        <article className="border-t border-white/10 pt-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="text-cyan-300">
              <Apple size={19} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                iPhone
              </div>
              <div className="text-lg font-semibold text-white">Use the PWA</div>
            </div>
          </div>

          <p className="text-[14.5px] leading-[1.65] text-white/60">
            On iPhone, Crate works as a PWA. It is not the same as a native App Store
            app, but it gives you a home-screen icon and a standalone player.
          </p>

          <ol className="mt-5 space-y-3 text-[14px] text-white/70">
            <IOSStep n={1}>
              Open <strong className="text-white">Safari</strong> (this only works in
              Safari — Chrome on iOS can't install PWAs).
            </IOSStep>
            <IOSStep n={2}>
              Go to your Crate URL, e.g.{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12.5px] text-cyan-200">
                listen.your-server.com
              </code>
              .
            </IOSStep>
            <IOSStep n={3}>
              Tap the <ShareGlyph /> <strong className="text-white">Share</strong>{" "}
              button at the bottom of the screen.
            </IOSStep>
            <IOSStep n={4}>
              Scroll down in the share sheet and tap{" "}
              <strong className="text-white">Add to Home Screen</strong>.
            </IOSStep>
            <IOSStep n={5}>
              Tap <strong className="text-white">Add</strong>. Crate now lives next
              to your other apps.
            </IOSStep>
          </ol>

          <p className="mt-7 border-l border-cyan-400/25 pl-4 text-[13px] leading-[1.6] text-white/55">
            A native iOS app may happen later. For now, the PWA is the honest path:
            simple to install, easy to update, and good enough for regular listening.
          </p>
        </article>
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[11px] font-semibold text-cyan-200">
        {n}
      </span>
      <span className="pt-0.5 leading-[1.55]">{children}</span>
    </li>
  );
}

function IOSStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[11px] font-semibold text-cyan-200">
        {n}
      </span>
      <span className="pt-0.5 leading-[1.55]">{children}</span>
    </li>
  );
}

/**
 * Tiny inline glyph that evokes iOS's share button (square + up-arrow).
 * Not pixel-perfect to Apple's but close enough that the user recognises
 * what to look for without us shipping Apple's proprietary assets.
 */
function ShareGlyph() {
  return (
    <span className="mx-1 inline-flex h-6 w-6 -translate-y-0.5 items-center justify-center rounded-md border border-white/15 bg-white/5 align-middle">
      <Share2 size={12} className="text-cyan-200" />
    </span>
  );
}
