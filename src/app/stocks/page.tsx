import { StocksTable } from "@/components/stocks/StocksTable";
import { getMyActivePaper, getNewsCounts, getRows } from "@/lib/data";
import { todayIST } from "@/lib/market";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocks / Stock Tracker" };

export default async function Page() {
  const [rows, paper, news] = await Promise.all([getRows(), getMyActivePaper(), getNewsCounts()]);
  return <StocksTable rows={rows} today={todayIST()} paper={paper} news={news} />;
}
