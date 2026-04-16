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
          Listen is a phone app too.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Same interface you have on the web, packaged for your pocket. Point it at
          your Crate instance on first launch — you never hand your library off to
          someone else's cloud.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Android / APK ─────────────────────────────────────── */}
        <article className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
              <Smartphone size={19} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Android
              </div>
              <div className="text-lg font-semibold text-white">Install the APK</div>
            </div>
          </div>

          <p className="text-[14.5px] leading-[1.65] text-white/60">
            A signed debug APK built on every release tag. Download, tap, install.
            Might need to enable "Install from unknown sources" for your browser
            the first time — Android will walk you through it.
          </p>

          <ol className="mt-5 space-y-2.5 text-[14px] text-white/70">
            <Step n={1}>Download the APK below.</Step>
            <Step n={2}>Open it from your downloads; approve the install prompt.</Step>
            <Step n={3}>Launch Listen, enter your Crate server URL, sign in.</Step>
          </ol>

          <a
            href="https://github.com/diego-ninja/crate/releases/latest/download/crate-listen.apk"
            className="group mt-7 inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#05161c] shadow-[0_0_24px_-6px_rgba(6,182,212,0.6)] transition hover:bg-cyan-300"
          >
            <Download size={16} />
            Download crate-listen.apk
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </a>
          <p className="mt-3 text-[11px] text-white/35">
            From the latest GitHub release · ~15 MB · Android 7.0+
          </p>
        </article>

        {/* ── iPhone / PWA ──────────────────────────────────────── */}
        <article className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
              <Apple size={19} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                iPhone
              </div>
              <div className="text-lg font-semibold text-white">Add to Home Screen</div>
            </div>
          </div>

          <p className="text-[14.5px] leading-[1.65] text-white/60">
            Apple doesn't let you download and install an app without the App Store,
            so we do the next best thing: a real PWA. Icon on your home screen,
            full-screen without Safari's chrome, works offline after first visit.
          </p>

          <ol className="mt-5 space-y-3 text-[14px] text-white/70">
            <IOSStep n={1}>
              Open <strong className="text-white">Safari</strong> (this only works in
              Safari — Chrome on iOS can't install PWAs).
            </IOSStep>
            <IOSStep n={2}>
              Go to your Listen URL, e.g.{" "}
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
              Tap <strong className="text-white">Add</strong>. Listen now lives next
              to your other apps.
            </IOSStep>
          </ol>

          <p className="mt-7 rounded-xl border border-white/8 bg-white/[0.02] p-4 text-[13px] leading-[1.6] text-white/55">
            A proper native iOS app via TestFlight is on the table if there's
            enough interest to justify an Apple Developer account. In the meantime
            the PWA covers ~90% of what you'd want: background audio, lock screen
            controls, home-screen launcher, standalone mode.
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

