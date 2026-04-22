import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  User, Key, Music, ArrowRight, Check,
  Loader2, ExternalLink, Sparkles,
} from "lucide-react";

const STEPS = ["Account", "API Keys", "Library Scan", "Done"];

export function Setup() {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const [keys, setKeys] = useState({
    lastfm_apikey: "",
    ticketmaster_api_key: "",
    spotify_id: "",
    spotify_secret: "",
    fanart_api_key: "",
    setlistfm_api_key: "",
  });
  const [savingKeys, setSavingKeys] = useState(false);

  const [scanning, setScanning] = useState(false);

  async function createAdmin() {
    setCreating(true);
    try {
      await api("/api/setup/admin", "POST", { email, password, name });
      await api("/api/auth/login", "POST", { email, password });
      toast.success("Admin account created");
      setStep(1);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create admin");
    }
    setCreating(false);
  }

  async function saveKeys() {
    setSavingKeys(true);
    try {
      const res = await api<{ saved: number }>("/api/setup/keys", "POST", keys);
      toast.success(`Saved ${res.saved} API keys`);
      setStep(2);
    } catch {
      toast.error("Failed to save keys");
    }
    setSavingKeys(false);
  }

  async function startScan() {
    setScanning(true);
    try {
      await api("/api/setup/scan", "POST");
      toast.success("Library scan started");
      setStep(3);
    } catch {
      toast.error("Failed to start scan");
    }
    setScanning(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <img src="/assets/logo.svg" alt="Crate" className="w-16 mx-auto mb-6" />

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold transition-colors ${
                i < step ? "bg-primary text-primary-foreground" :
                i === step ? "bg-primary/20 text-primary border border-primary" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < step ? <Check size={14} /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-px ${i < step ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-md p-8 shadow-xl">
          {/* Step 0: Admin Account */}
          {step === 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <User size={18} className="text-primary" />
                <h2 className="text-lg font-bold">Create Admin Account</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                This will be your login to manage Crate.
              </p>
              <div className="space-y-3">
                <Input placeholder="Name (optional)" value={name}
                  onChange={e => setName(e.target.value)} />
                <Input placeholder="Email" type="email" value={email}
                  onChange={e => setEmail(e.target.value)} required />
                <Input placeholder="Password" type="password" value={password}
                  onChange={e => setPassword(e.target.value)} required />
              </div>
              <Button className="w-full mt-6" onClick={createAdmin}
                disabled={creating || !email || !password}>
                {creating ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                Create Account <ArrowRight size={14} className="ml-2" />
              </Button>
            </div>
          )}

          {/* Step 1: API Keys */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Key size={18} className="text-primary" />
                <h2 className="text-lg font-bold">API Keys</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Optional — enable enrichment features. You can add these later in Settings.
              </p>
              <div className="space-y-3">
                {[
                  { key: "lastfm_apikey", label: "Last.fm API Key", desc: "Artist bios, similar artists", url: "https://www.last.fm/api/account/create" },
                  { key: "ticketmaster_api_key", label: "Ticketmaster Key", desc: "Upcoming shows", url: "https://developer.ticketmaster.com/" },
                  { key: "spotify_id", label: "Spotify Client ID", desc: "Artist images", url: "https://developer.spotify.com/dashboard" },
                  { key: "spotify_secret", label: "Spotify Client Secret", desc: "", url: "" },
                  { key: "fanart_api_key", label: "Fanart.tv Key", desc: "Artist backgrounds", url: "https://fanart.tv/get-an-api-key/" },
                  { key: "setlistfm_api_key", label: "Setlist.fm Key", desc: "Concert setlists", url: "https://api.setlist.fm/docs/1.0/index.html" },
                ].map(({ key, label, desc, url }) => (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium">{label}</label>
                      {desc && <span className="text-[10px] text-muted-foreground">{desc}</span>}
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline ml-auto">
                          Get key <ExternalLink size={9} className="inline" />
                        </a>
                      )}
                    </div>
                    <Input
                      placeholder={`Enter ${label}...`}
                      value={(keys as any)[key]}
                      onChange={e => setKeys(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-6">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Skip for now
                </Button>
                <Button className="flex-1" onClick={saveKeys} disabled={savingKeys}>
                  {savingKeys ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                  Save Keys <ArrowRight size={14} className="ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Library Scan */}
          {step === 2 && (
            <div className="text-center">
              <Music size={40} className="text-primary mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">Scan Your Library</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Crate will scan your music collection, read tags, and build your library database.
                This runs in the background — you can start using Crate while it works.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => { window.location.href = "/"; }}>
                  Skip — I'll scan later
                </Button>
                <Button onClick={startScan} disabled={scanning}>
                  {scanning ? <Loader2 size={14} className="animate-spin mr-2" /> : <Sparkles size={14} className="mr-2" />}
                  Start Scan
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-md bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-500" />
              </div>
              <h2 className="text-lg font-bold mb-2">You're all set!</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Crate is scanning your library in the background.
                This may take a while depending on your collection size.
              </p>
              <Button onClick={() => { window.location.href = "/"; }} className="w-full">
                Go to Dashboard <ArrowRight size={14} className="ml-2" />
              </Button>
            </div>
          )}
        </div>

        <div className="text-center mt-4 text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </div>
      </div>
    </div>
  );
}
