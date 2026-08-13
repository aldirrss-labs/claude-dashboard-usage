import { NextResponse } from "next/server";
import { listProjects } from "@/lib/queries";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}
