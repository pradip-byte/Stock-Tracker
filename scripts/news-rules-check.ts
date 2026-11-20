/**
 * Checks the headline rules against known examples.
 *   npx tsx scripts/news-rules-check.ts
 */
import { brokerCall, toneLabel, toneOfHeadline, blockedSource, cleanTitle, companyQuery, flowsFromHeadline, fullName, lowValueTitle, namesCompany, resultDateFromHeadline, shortName, tagMarketHeadline, tagStockHeadline } from "../src/lib/news/rules";

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

// names: full name or a common short name, never the ticker alone
eq("full name keeps 'of India'", fullName("Bank of India Limited"), "Bank of India");
eq("short name: Infosys", shortName("Infosys Limited"), "Infosys");
eq("short name: Coal India is not 'Coal'", shortName("Coal India Limited"), "Coal India");
eq("short name: Grasim", shortName("Grasim Industries Limited"), "Grasim");
eq("short name: Page Industries is not 'Page'", shortName("Page Industries Limited"), "Page Industries");
eq("query: TCS", companyQuery("TCS", "Tata Consultancy Services Limited"), '"Tata Consultancy Services" OR "TCS" when:7d');
eq("query: default uses the names, not the ticker", companyQuery("PHOENIXLTD", "The Phoenix Mills Limited"), '"Phoenix Mills" when:7d');
const is = (title: string, symbol: string, name: string) => namesCompany(title, symbol, name);
eq("TCS short name", is("TCS to hire 40,000 freshers in FY27", "TCS", "Tata Consultancy Services Limited"), true);
eq("unrelated Tata", is("Tata Motors unveils new SUV", "TCS", "Tata Consultancy Services Limited"), false);
eq("Reliance Industries", is("Reliance Industries shares hit record", "RELIANCE", "Reliance Industries Limited"), true);
eq("RIL", is("RIL to invest Rs 75,000 crore in new energy", "RELIANCE", "Reliance Industries Limited"), true);
eq("Reliance Power is not Reliance Industries", is("Reliance Power wins solar tender", "RELIANCE", "Reliance Industries Limited"), false);
eq("ICICI Prudential is not ICICI Bank", is("ICICI Prudential Life to focus on VNB", "ICICIBANK", "ICICI Bank Limited"), false);
eq("oil prices are not Oil India", is("Oil prices rise on Houthi attacks", "OIL", "Oil India Limited"), false);
eq("Oil India", is("Oil India Q2 profit falls 12%", "OIL", "Oil India Limited"), true);
eq("a bank is not Bank of India", is("HDFC Bank raises deposit rates", "BANKINDIA", "Bank of India"), false);
eq("State Bank of India is not Bank of India", is("State Bank of India cuts lending rate", "BANKINDIA", "Bank of India"), false);
eq("Bank of India", is("Bank of India Q2 net profit up 19%", "BANKINDIA", "Bank of India"), true);
eq("SBI", is("SBI raises Rs 10,000 crore via bonds", "SBIN", "State Bank of India"), true);
eq("SBI Life is not SBI", is("SBI Life Q2 VNB grows 14%", "SBIN", "State Bank of India"), false);
eq("L&T", is("L&T bags large order in Middle East", "LT", "Larsen & Toubro Limited"), true);
eq("L&T Finance is not L&T", is("L&T Finance Q2 profit rises", "LT", "Larsen & Toubro Limited"), false);
eq("Supreme Court is not Supreme Industries", is("Supreme Court raps CCI over delay", "SUPREMEIND", "Supreme Industries Limited"), false);
eq("ticker alone is not enough", is("IDEA: five ways to save tax", "IDEA", "Vodafone Idea Limited"), false);
eq("US taxpayers' TCS still matches the short name (blocked by source instead)", is("TCS report on federal spending", "TCS", "Tata Consultancy Services Limited"), true);

eq("Tata Power", is("Tata Power commissions 300 MW solar plant", "TATAPOWER", "The Tata Power Company Limited"), true);
eq("Ola Electric", is("Ola Electric's cash cushion dwindles", "OLAELEC", "Ola Electric Mobility Limited"), true);
eq("MCX: glitch", is("MCX trading session delayed by one hour due to technical glitch", "MCX", "Multi Commodity Exchange of India Limited"), true);
eq("BSE: stocks to watch", is("Stocks to watch: Urban Company, BSE, Tata group, HZL", "BSE", "BSE Limited"), true);

// exchanges: must be about the company, not a price or a listing on it
eq("MCX: gold price on MCX", is("Gold falls 4.49% on MCX as dollar strengthens", "MCX", "Multi Commodity Exchange of India Limited"), false);
eq("MCX: MCX gold", is("MCX gold nears record, silver plunges", "MCX", "Multi Commodity Exchange of India Limited"), false);
eq("MCX: crude oil futures", is("Crude oil futures slip on MCX amid weak demand", "MCX", "Multi Commodity Exchange of India Limited"), false);
eq("MCX: company results", is("MCX Q2 results: net profit doubles on record volumes", "MCX", "Multi Commodity Exchange of India Limited"), true);
eq("MCX: company shares despite commodity words", is("MCX shares hit record high as gold volumes surge", "MCX", "Multi Commodity Exchange of India Limited"), true);
eq("MCX: launch", is("MCX to launch electricity futures next month", "MCX", "Multi Commodity Exchange of India Limited"), true);
eq("MCX: bare mention with no company word", is("Traders flock to MCX amid volatility", "MCX", "Multi Commodity Exchange of India Limited"), false);
eq("BSE: Sensex headline", is("BSE Sensex jumps 500 points; Nifty above 25,500", "BSE", "BSE Limited"), false);
eq("BSE: listing venue", is("Lenskart shares list at 12% premium on BSE", "BSE", "BSE Limited"), false);
eq("BSE: company results", is("BSE Q2 profit triples as derivatives volumes soar", "BSE", "BSE Limited"), true);
eq("BSE: company shares", is("BSE shares fall 5% after SEBI proposal on weekly expiries", "BSE", "BSE Limited"), true);

// sources
eq("blocked aggregator", blockedSource("Simply Wall St", "https://simplywall.st"), true);
eq("allowed publisher", blockedSource("Business Standard", "https://www.business-standard.com"), false);
eq("clean title", cleanTitle("Infosys Q2 profit rises 6% - Business Standard", "Business Standard"), "Infosys Q2 profit rises 6%");

eq("low value: session blurb", lowValueTitle("Ola Electric Mobility falls 2.23% in Wednesday's session"), true);
eq("low value: gold prices", lowValueTitle("Gold, silver prices crash up to 6.6% on MCX amid strong US dollar"), true);
eq("low value: real news kept", lowValueTitle("Ola Electric's cash cushion dwindles as market share slips"), false);

// tag fixes
eq("rating: Buy X; target of Rs", tagStockHeadline("Buy HDFC Bank; target of Rs 1,850: ICICI Securities"), ["rating change"]);
eq("rating: Accumulate X", tagStockHeadline("Accumulate Cipla; target of Rs 1,720: Prabhudas Lilladher"), ["rating change"]);
eq("order win: received an order", tagStockHeadline("BEL receives Rs 1,200 crore order from Navy"), ["order win"]);
eq("order win: order book alone is not a win", tagStockHeadline("L&T order book at record Rs 6 lakh crore"), ["other"]);
eq("order win: order inflow alone is not a win", tagStockHeadline("BHEL order inflow guidance unchanged"), ["guidance"]);
eq("non-news: option chain", lowValueTitle("Infosys Option Chain - NSE India"), true);
eq("non-news: share price page", lowValueTitle("Tata Steel Share Price Today, TATASTEEL Stock Price Live NSE/BSE"), true);
eq("non-news: share price, quote page", lowValueTitle("HDFC Bank Share Price - HDFC Bank Stock Price"), true);
eq("news: share price hits high is kept", lowValueTitle("MCX share price hits new high, up 100% in one year"), false);
eq("news: share price target raised is kept", lowValueTitle("MCX share price target raised by UBS backing strong volume growth"), false);

// broker calls
eq("call: Buy, target, broker after colon", brokerCall("Buy HDFC Bank; target of Rs 1,850: ICICI Securities"), { broker: "ICICI Securities", call: "Buy", target: 1850 });
eq("call: downgrade with target", brokerCall("CLSA downgrades Infosys, cuts target price to Rs 1,250"), { broker: "CLSA", call: "Downgrade", target: 1250 });
eq("call: target raised, no figure", brokerCall("MCX share price target raised by UBS backing strong volume growth"), { broker: "UBS", call: "Target raised", target: null });
eq("call: question headline gives no call", brokerCall("Buy, Sell Or Hold: MCX, LG Electronics India, HDFC Bank And ITC"), null);
eq("call: not a rating headline", brokerCall("Infosys opens new campus in Hyderabad"), null);

eq("call: round-up of many stocks gives no call", brokerCall("RIL, SAIL, IndusInd Bank among top upgrades, TMPV, Waaree among top downgrades"), null);
eq("ITC is not input tax credit", namesCompany("Big GST relief: CBIC proposes amendments on ITC claims", "ITC", "ITC Limited"), false);
eq("ITC the company", namesCompany("ITC Q2 net profit rises 4% on cigarette volumes", "ITC", "ITC Limited"), true);
eq("Trent the engine is not Trent the retailer", namesCompany("Rolls-Royce secures Trent 1000 XE order from Royal Brunei", "TRENT", "Trent Limited"), false);
eq("Trent the retailer", namesCompany("Trent shares fall 4% after Q2 Westside growth slows", "TRENT", "Trent Limited"), true);
eq("Tata Motors PV is not Tata Motors", namesCompany("Tata Motors PV among 10 Nifty stocks facing downgrades", "TMCV", "Tata Motors Limited"), false);

// tone
eq("tone +: upgrade", toneOfHeadline("Jefferies upgrades Tata Steel to buy"), 1);
eq("tone +: profit rises", toneOfHeadline("Infosys Q2 net profit rises 6% to Rs 7,828 crore"), 1);
eq("tone +: order", toneOfHeadline("BEL receives Rs 1,200 crore order from Navy"), 1);
eq("tone -: downgrade", toneOfHeadline("CLSA downgrades Infosys, cuts target price to Rs 1,250"), -1);
eq("tone -: probe", toneOfHeadline("SEBI probe into IndusInd Bank widens"), -1);
eq("tone -: resigns", toneOfHeadline("IndusInd Bank CEO resigns with immediate effect"), -1);
eq("tone 0: both", toneOfHeadline("Profit rises but brokerage downgrades stock"), 0);
eq("tone 0: neither", toneOfHeadline("Infosys opens new campus in Hyderabad"), 0);
eq("label: quiet", toneLabel(1, 1, 20).label, "Quiet");
eq("label: positive", toneLabel(6, 1, 20).label, "Positive");
eq("label: negative", toneLabel(1, 5, 20).label, "Negative");
eq("label: mixed", toneLabel(4, 3, 20).label, "Mixed");

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
