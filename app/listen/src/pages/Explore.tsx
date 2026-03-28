import { Search } from "lucide-react";

export function Explore() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Explore</h1>
      <div className="relative mb-8">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          placeholder="Search artists, albums, tracks..."
          className="w-full h-10 pl-10 pr-4 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-cyan-400/50"
        />
      </div>
      <p className="text-white/30 text-sm">Coming soon</p>
    </div>
  );
}
