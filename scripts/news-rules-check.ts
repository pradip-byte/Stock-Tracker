/**
 * Checks the headline rules against known examples.
 *   npx tsx scripts/news-rules-check.ts
 */
import { lowValueTitle, acronymOf, blockedSource, cleanTitle, companyQuery, flowsFromHeadline, namesCompany, resultDateFromHeadline, shortName, tagMarketHeadline, tagStockHeadline } from "../src/lib/news/rules";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
};

// tags
eq("results", tagStockHeadline("Infosys Q2 net profit rises 6% to Rs 7,828 crore"), ["results"]);
eq("results + guidance", tagStockHeadline("Infosys Q2 results: FY27 revenue guidance cut to 1-2%"), ["results", "guidance"]);
eq("order win", tagStockHeadline("L&T bags Rs 2,500 crore order from NTPC"), ["order win"]);
eq("rating change", tagStockHeadline("CLSA downgrades Infosys, cuts target price to Rs 1,250"), ["rating change"]);
eq("regulatory", tagStockHeadline("Sun Pharma gets USFDA warning letter for Halol plant"), ["regulatory"]);
eq("management change", tagStockHeadline("IndusInd Bank CEO resigns with immediate effect"), ["management change"]);
eq("block deal", tagStockHeadline("Promoter offloads 2% stake in Kalyan Jewellers via block deal"), ["block deal"]);
eq("other", tagStockHeadline("Tata Motors unveils new electric SUV at Auto Expo"), ["other"]);
eq("macro crude + geopolitics", tagMarketHeadline("Brent crude jumps 3% after attacks on Hormuz shipping"), ["crude", "geopolitics"]);
eq("macro RBI", tagMarketHeadline("RBI keeps repo rate unchanged at 5.5%"), ["RBI"]);
eq("macro FII", tagMarketHeadline("FIIs sell shares worth Rs 3,200 crore; DIIs buy Rs 4,100 crore"), ["FII"]);
eq("macro: warns is not war", tagMarketHeadline("Disney plans $3 billion cost cuts, warns of more layoffs"), []);
eq("macro none", tagMarketHeadline("Hindustan Zinc vs Tata Steel: which metal stock to buy"), []);

// names
eq("short name: MCX", shortName("Multi Commodity Exchange of India Limited"), "Multi Commodity Exchange");
eq("short name: Infosys", shortName("Infosys Limited"), "Infosys");
eq("acronym TCS", acronymOf("TCS", "Tata Consultancy Services Limited"), "TCS");
eq("acronym MCX", acronymOf("MCX", "Multi Commodity Exchange of India Limited"), "MCX");
eq("no acronym for IDEA", acronymOf("IDEA", "Vodafone Idea Limited"), null);
eq("query", companyQuery("TCS", "Tata Consultancy Services Limited"), '"Tata Consultancy Services" OR "TCS" when:7d');
eq("names: acronym", namesCompany("TCS to hire 40,000 freshers in FY27", "TCS", "Tata Consultancy Services Limited"), true);
eq("names: unrelated Tata", namesCompany("Tata Motors unveils new SUV", "TCS", "Tata Consultancy Services Limited"), false);
eq("names: first two words", namesCompany("Reliance Industries shares hit record", "RELIANCE", "Reliance Industries Limited"), true);
eq("names: ICICI Prudential is not ICICI Bank", namesCompany("ICICI Prudential Life to focus on VNB", "ICICIBANK", "ICICI Bank Limited"), false);

// sources
eq("blocked aggregator", blockedSource("Simply Wall St", "https://simplywall.st"), true);
eq("allowed publisher", blockedSource("Business Standard", "https://www.business-standard.com"), false);
eq("clean title", cleanTitle("Infosys Q2 profit rises 6% - Business Standard", "Business Standard"), "Infosys Q2 profit rises 6%");

eq("low value: session blurb", lowValueTitle("Ola Electric Mobility falls 2.23% in Wednesday's session"), true);
eq("low value: gold prices", lowValueTitle("Gold, silver prices crash up to 6.6% on MCX amid strong US dollar"), true);
eq("low value: real news kept", lowValueTitle("Ola Electric's cash cushion dwindles as market share slips"), false);

// result dates
const pub = "2026-11-05T06:00:00Z";
eq("date: to announce on", resultDateFromHeadline("Ola Electric to announce Q2 results on November 12", pub), "2026-11-12");
eq("date: board meeting, day first", resultDateFromHeadline("Tata Steel board meeting on 7 Nov to consider Q2 results", pub), "2026-11-07");
eq("date: next year", resultDateFromHeadline("Infosys to declare Q3 results on January 14", "2026-12-28T06:00:00Z"), "2027-01-14");
eq("date: already reported", resultDateFromHeadline("Infosys Q2 results: profit rises 6%, announced on October 23", pub), null);
eq("date: in the past", resultDateFromHeadline("HDFC Bank to announce Q2 results on October 18", pub), null);
eq("date: no date", resultDateFromHeadline("Reliance to announce Q2 results next week", pub), null);
eq("date: not about results", resultDateFromHeadline("Maruti to launch new car on November 20", pub), null);

// flows
eq("flows: both", flowsFromHeadline("FIIs sell shares worth Rs 3,200 crore; DIIs buy Rs 4,100 crore"), { fii: -3200, dii: 4100 });
eq("flows: FII only", flowsFromHeadline("FPIs pump ₹5,432.5 crore into Indian equities on Thursday"), { fii: 5432.5, dii: null });
eq("flows: monthly skipped", flowsFromHeadline("FPIs invest Rs 94,963 crore in November so far"), null);
eq("flows: no figure", flowsFromHeadline("FIIs turn net sellers as markets slip"), null);
eq("flows: no verb", flowsFromHeadline("FII data: Rs 2,000 crore on Friday"), null);

console.log(failed ? `${failed} FAILED` : "all rules pass");
process.exit(failed ? 1 : 0);
