"use client";

import { Dashboard } from "@/components/pages/Dashboard";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();
  return <Dashboard onNavigate={(screen) => router.push(`/${screen}`)} />;
}
