import { StocksTable } from "@/components/stocks/StocksTable";
import { getRows } from "@/lib/data";
import { todayIST } from "@/lib/market";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocks / Stock Tracker" };

export default async function Page() {
  return <StocksTable rows={await getRows()} today={todayIST()} />;
}
