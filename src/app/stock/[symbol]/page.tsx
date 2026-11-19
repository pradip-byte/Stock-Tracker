import { notFound } from "next/navigation";
import { StockView } from "@/components/stock/StockView";
import { getStockDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const detail = await getStockDetail(decodeURIComponent(symbol).toUpperCase());
  if (!detail) notFound();
  return <StockView detail={detail} />;
}
