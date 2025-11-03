import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
  hidden?: boolean;
}

export function DashboardCard({ icon, title, subtitle, hidden=false, children }: DashboardCardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-6", hidden && "hidden")}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-[1.25em] w-[1.25em]">
          {icon}
        </span>
        {title}
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {subtitle}
      </p>
      <hr className="my-6 border-border" />
      {children}
    </div>
  );
}

