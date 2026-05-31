interface ScoreCardProps {
  label: string;
  value: number;
  hint: string;
}

function tone(value: number): { bar: string; text: string } {
  if (value >= 66) return { bar: "bg-genie-good", text: "text-genie-good" };
  if (value >= 40) return { bar: "bg-genie-warn", text: "text-genie-warn" };
  return { bar: "bg-genie-bad", text: "text-genie-bad" };
}

export function ScoreCard({ label, value, hint }: ScoreCardProps) {
  const t = tone(value);
  return (
    <div className="rounded-xl bg-genie-card p-4 ring-1 ring-white/5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-300">{label}</span>
        <span className={`text-2xl font-bold tabular-nums ${t.text}`}>{value}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${value}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-400">{hint}</p>
    </div>
  );
}
