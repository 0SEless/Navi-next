"use client";

import { usePathname, useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import type { ScreenName } from "@/types/screens";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const segments = pathname.split("/").filter(Boolean);
  const currentScreen: ScreenName = (segments[segments.length - 1] as ScreenName) || "dashboard";

  const handleNavigate = (screen: ScreenName) => {
    router.push(`/${screen}`);
  };

  return (
    <AppLayout currentScreen={currentScreen} onNavigate={handleNavigate}>
      {children}
    </AppLayout>
  );
}
