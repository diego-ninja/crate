import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

interface TagPreview {
  current_title: string;
  new_title: string;
  new_track: string;
  duration_diff: number | null;
}

interface MatchResult {
  title: string;
  artist: string;
  date?: string;
  country?: string;
  track_count: number;
  match_score: number;
  tag_preview?: TagPreview[];
}

interface MatchCardProps {
  match: MatchResult;
  onApply: () => void;
}

export function MatchCard({ match, onApply }: MatchCardProps) {
  const sc = match.match_score;
  const scoreColor =
    sc >= 70 ? "text-green-500" : sc >= 40 ? "text-yellow-500" : "text-red-500";

  return (
    <div className="bg-card border border-border rounded-md p-4 mb-3 hover:border-primary transition-colors">
      <div className="flex items-center gap-4 mb-3">
        <div className={`text-2xl font-bold w-12 text-center flex-shrink-0 ${scoreColor}`}>
          {sc}
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{match.title}</h3>
          <div className="text-sm text-muted-foreground">
            {match.artist} &middot; {match.date || "?"} &middot;{" "}
            {match.track_count} tracks{" "}
            {match.country ? `\u00B7 ${match.country}` : ""}
          </div>
        </div>
        <Button size="sm" variant="outline" className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white" onClick={onApply}>
          Apply
        </Button>
      </div>
      {match.tag_preview && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>MusicBrainz</TableHead>
              <TableHead className="w-16">Delta sec</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {match.tag_preview.map((p, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">
                  {p.new_track || "?"}
                </TableCell>
                <TableCell>
                  {p.current_title !== p.new_title ? (
                    <span className="text-red-500 line-through text-sm">
                      {p.current_title}
                    </span>
                  ) : (
                    <span className="text-sm">{p.current_title}</span>
                  )}
                </TableCell>
                <TableCell>
                  {p.current_title !== p.new_title ? (
                    <span className="text-green-500 text-sm">
                      {p.new_title}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">same</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-sm">
                  {p.duration_diff !== null
                    ? p.duration_diff <= 2
                      ? "ok"
                      : `${p.duration_diff}s`
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
