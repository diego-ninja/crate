import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.detail || "Invalid credentials");
        return;
      }

      navigate("/");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5"
      >
        <h1 className="text-2xl font-bold text-white text-center">Listen</h1>

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <div>
          <label htmlFor="email" className="block text-sm text-white/60 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-white/60 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-10 rounded-lg bg-cyan-400 text-black font-medium text-sm hover:bg-cyan-300 transition-colors disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="text-center text-sm text-white/40">
          No account?{" "}
          <Link to="/register" className="text-cyan-400 hover:underline">Create one</Link>
        </p>
      </form>
    </div>
  );
}
