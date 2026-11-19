import { AdminView } from "@/components/admin/AdminView";
import { getJobRuns, getRows } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin / Stock Tracker" };

export default async function Page() {
  const [runs, rows] = await Promise.all([getJobRuns(), getRows()]);
  const problems = rows
    .filter((r) => r.backfillStatus !== "done")
    .map((r) => ({ symbol: r.symbol, status: r.backfillStatus, error: r.backfillError }));
  return <AdminView runs={runs} total={rows.length} problems={problems} />;
}
