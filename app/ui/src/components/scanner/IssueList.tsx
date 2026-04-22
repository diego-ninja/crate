import { Badge } from "@crate-ui/shadcn/badge";

interface Issue {
  type: string;
  severity: string;
  confidence: number;
  description: string;
  suggestion: string;
  paths: string[];
  details: Record<string, unknown>;
}

interface IssueListProps {
  issues: Issue[];
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    critical: "bg-red-500 text-white",
    high: "bg-orange-500 text-white",
    medium: "bg-yellow-500 text-black",
    low: "bg-secondary text-muted-foreground",
  };
  return (
    <Badge className={map[severity] || map.low}>
      {severity}
    </Badge>
  );
}

export function IssueList({ issues }: IssueListProps) {
  if (!issues.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No issues found
      </div>
    );
  }

  const grouped: Record<string, Issue[]> = {};
  issues.forEach((i) => {
    (grouped[i.type] = grouped[i.type] || []).push(i);
  });

  return (
    <div>
      <p className="text-muted-foreground mb-4">{issues.length} issues found</p>
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="mb-8">
          <h3 className="font-semibold mb-3">
            {type.replace(/_/g, " ")} ({items.length})
          </h3>
          {items.map((issue, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-md p-4 mb-2"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm">{issue.description}</div>
                  <div className="text-sm text-green-500 mt-1">
                    {issue.suggestion}
                  </div>
                </div>
                <div className="flex gap-2 items-center flex-shrink-0">
                  {severityBadge(issue.severity)}
                  <span className="text-sm text-muted-foreground">
                    {issue.confidence}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
