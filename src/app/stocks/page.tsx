import { StocksTable } from "@/components/stocks/StocksTable";
import { getMyActivePaper, getRows } from "@/lib/data";
import { todayIST } from "@/lib/market";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocks / Stock Tracker" };

export default async function Page() {
  const [rows, paper] = await Promise.all([getRows(), getMyActivePaper()]);
  return <StocksTable rows={rows} today={todayIST()} paper={paper} />;
}
