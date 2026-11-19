import { StocksTable } from "@/components/stocks/StocksTable";
import { getRows } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocks / Stock Tracker" };

export default async function Page() {
  return <StocksTable rows={await getRows()} />;
}
