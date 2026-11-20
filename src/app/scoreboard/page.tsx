import { ScoreboardView } from "@/components/scoreboard/ScoreboardView";
import { getScoreboards } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scoreboard / Stock Tracker" };

export default async function Page() {
  const { boards, quotesAt } = await getScoreboards();
  return <ScoreboardView boards={boards} quotesAt={quotesAt} />;
}
