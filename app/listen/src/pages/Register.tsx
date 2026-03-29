import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/register", "POST", { email, password, name });
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = err.message;
        try {
          const parsed = JSON.parse(msg);
          setError(parsed.detail || "Registration failed");
        } catch {
          setError(msg || "Registration failed");
        }
      } else {
        setError("Registration failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-primary-foreground">C</span>
          </div>
          <h1 className="text-2xl font-bold">Create Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Join the community</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Your name"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Min 6 characters"
              minLength={6}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary text-primary-foreground font-semibold py-2.5 text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Create Account
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
