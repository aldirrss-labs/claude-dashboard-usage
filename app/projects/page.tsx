"use client";

import { useEffect, useState, useCallback } from "react";
import { ProjectTable } from "@/components/ProjectTable";
import { SyncButton } from "@/components/SyncButton";
import { PageHeader, Panel } from "@/components/Panel";

interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
  weekOverWeekPct: number | null;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListRow[] | null>(null);

  const refetch = useCallback(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((json) => setProjects(json.projects));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  if (!projects) {
    return <div className="label-mono p-8">Loading projects…</div>;
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <PageHeader
        kicker={`${projects.length} detected on this machine`}
        title="Projects"
        action={<SyncButton onSynced={refetch} />}
      />
      <Panel label="All projects" index={1} padded={false}>
        <ProjectTable projects={projects} />
      </Panel>
    </main>
  );
}
