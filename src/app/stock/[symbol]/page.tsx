import { notFound } from "next/navigation";
import { StockView } from "@/components/stock/StockView";
import { getStockDetail } from "@/lib/data";
import { markNewsSeen } from "@/lib/jobs/news";

export const dynamic = "force-dynamic";
// the AI "Refresh" server action on this page can take over a minute
export const maxDuration = 300;

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const detail = await getStockDetail(decodeURIComponent(symbol).toUpperCase());
  if (!detail) notFound();
  // opening the page resets this stock's "new headlines" count on the stocks list
  await markNewsSeen(detail.row.symbol).catch(() => {});
  return <StockView detail={detail} />;
}
