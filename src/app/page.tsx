import { Dashboard } from "@/components/dashboard/Dashboard";
import { getDashboard } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Dashboard data={await getDashboard()} />;
}
