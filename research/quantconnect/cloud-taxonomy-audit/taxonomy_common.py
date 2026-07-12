from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import calendar
import math
INITIAL_CAPITAL = 10_000_000.0
COST_RATE = 0.001
MIN_BUY = 100_000.0
EXECUTION_DELAY_DAYS = 1
MEMBERSHIP_LAG_DAYS = 5
FIRST_SIGNAL = datetime(2010, 8, 27)
LAST_SIGNAL = datetime(2026, 6, 26)
MARKET_ETFS = ["SPY", "QQQ", "DIA", "IWM"]
SECTOR_ETFS = ["XLK", "XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLRE", "XLU"]
THEME_ETFS = ["SMH", "SOXX", "AIQ", "BOTZ", "ITA", "PPA", "GRID", "PAVE", "XBI", "IBB", "GLD", "IBIT", "BITO"]
LEVERAGED_ETFS = ["TQQQ", "QLD", "SOXL", "USD", "TECL", "UPRO"]
SEED_TAGS = {
	"AAPL": ["technology"], "MSFT": ["technology", "ai"],
	"NVDA": ["semiconductor", "ai"], "AVGO": ["semiconductor"],
	"AMD": ["semiconductor", "ai"], "AMZN": ["consumer", "cloud", "ai"],
	"META": ["communication", "ai"], "GOOGL": ["communication", "ai"],
	"TSLA": ["ev"], "LLY": ["healthcare"], "JPM": ["financials"],
	"XOM": ["energy"], "GE": ["industrials", "defense"],
	"PLTR": ["ai", "defense"], "ARM": ["semiconductor", "ai"],
}
AI_HARDWARE = {
	"NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "WDC", "STX",
	"DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX", "KLAC",
	"AMAT", "TER", "MPWR", "ON", "QCOM", "INTC", "SNDK",
}
LEGACY_GROUPS = [[206,"A,ABBV,ABT,ALGN,BAX,BDX,BIIB,BMY,BSX,CAH,CI,CNC,COO,COR,CRL,CVS,DGX,DHR,DVA,ELV,EW,HCA,HSIC,HUM,INCY,IQV,JNJ,LH,LLY,MCK,MDT,MRK,MRNA,MTD,PFE,PODD,RMD,RVTY,SOLV,STE,SYK,TECH,TMO,UHS,UNH,VEEV,VTRS,WAT,WST,ZBH,ZTS"],[100002,"AAPL"],[100003,"ABNB,ADP,PAYX,PYPL"],[103,"ACGL,AFL,AIG,AIZ,AJG,ALL,AMP,AON,APO,ARES,AXP,BAC,BEN,BLK,BNY,BRK-B,BRO,BX,C,CB,CBOE,CFG,CINF,CME,COF,COIN,CPAY,EG,ERIE,FDS,FIS,FISV,FITB,GL,GPN,GS,HBAN,HIG,HOOD,IBKR,ICE,IVZ,JKHY,JPM,KEY,KKR,L,MA,MCO,MET,MRSH,MS,MSCI,MTB,NDAQ,NTRS,PFG,PGR,PNC,PRU,RF,RJF,SCHW,SPGI,STT,SYF,TFC,TROW,TRV,USB,V,WFC,WRB,WTW,XYZ"],[311,"ACN,AKAM,ANET,APH,CDW,CIEN,COHR,CRM,CTSH,DELL,FFIV,FICO,FLEX,FSLR,GDDY,GEN,GLW,HPE,HPQ,IBM,IT,JBL,KEYS,MSI,NOW,NTAP,ON,ORCL,PTC,Q,SMCI,SWKS,TDY,TEL,TRMB,TYL,VRSN,ZBRA"],[100006,"ADBE,ADSK,APP,CDNS,CRWD,DASH,DDOG,GOOG,GOOGL,META,MSFT,MSTR,PLTR,ROP,SHOP,SNPS,TRI,WDAY"],[100007,"ADI,ALAB,AMAT,AMD,ARM,AVGO,INTC,MCHP,MPWR,MRVL,MU,NVDA,NXPI,QCOM,TER,TXN"],[205,"ADM,BF-B,BG,CASY,CHD,CL,CLX,DG,DLTR,EL,GIS,HRL,HSY,KMB,KO,KR,KVUE,MKC,MO,PG,PM,SJM,STZ,SYY,TAP,TGT,TSN"],[207,"AEE,AES,ATO,AWK,CMS,CNP,D,DTE,DUK,ED,EIX,ES,ETR,EVRG,FE,LNT,NEE,NI,NRG,PCG,PEG,PNW,PPL,SO,SRE,VST,WEC"],[100010,"AEP,CEG"],[101,"ALB,AMCR,APD,AVY,BALL,CF,CRH,CTVA,DD,DOW,ECL,FCX,IFF,IP,LYB,MLM,MOS,NEM,NUE,PKG,PPG,SHW,STLD,SW,VMC"],[310,"ALLE,AME,AOS,BA,BLDR,BR,CARR,CAT,CHRW,CMI,DAL,DE,DOV,EFX,EME,EMR,ETN,EXPD,FDX,FDXF,FIX,FTV,GD,GE,GEV,GNRC,GWW,HII,HONA,HUBB,HWM,IEX,IR,ITW,J,JBHT,JCI,LDOS,LHX,LII,LMT,LUV,MAS,MMM,NDSN,NOC,NSC,OTIS,PH,PNR,PWR,ROK,ROL,RSG,RTX,SNA,SWK,TDG,TT,TXT,UAL,UBER,UNP,UPS,URI,VLTO,VRSK,VRT,WAB,WM,XYL"],[100013,"ALNY,AMGN,GILD,IDXX,REGN,VRTX"],[104,"AMT,ARE,AVB,BXP,CBRE,CCI,CPT,CSGP,DLR,DOC,EQIX,EQR,ESS,EXR,FRT,HST,INVH,IRM,KIM,MAA,O,PLD,PSA,REG,SBAC,SPG,UDR,VICI,VTR,WELL,WY"],[100015,"AMZN,MELI"],[309,"APA,COP,CVX,DVN,EOG,EQT,EXE,HAL,KMI,MPC,OKE,OXY,PSX,SLB,TPL,TRGP,VLO,WMB,XOM"],[102,"APTV,AZO,BBY,CCL,CMG,CVNA,DECK,DHI,DPZ,DRI,EBAY,EXPE,F,GM,GPC,GRMN,HAS,HD,HLT,LEN,LOW,LULU,LVS,MCD,MGM,NCLH,NKE,NVR,PHM,RCL,RL,TJX,TPR,TSCO,ULTA,WSM,WYNN,YUM"],[100018,"ASML,LRCX"],[100019,"AXON"],[100020,"BKNG"],[100021,"BKR"],[100022,"CCEP,KDP,MNST,PEP"],[308,"CHTR,DIS,ECHO,FOX,FOXA,LYV,NWS,NWSA,OMC,PSKY,T,TKO,TTD,VZ"],[100024,"CMCSA"],[100025,"COST,WMT"],[100026,"CPRT"],[100027,"CRWV,NBIS"],[100028,"CSCO"],[100029,"CSX"],[100030,"CTAS"],[100031,"DXCM"],[100032,"EA,TTWO"],[100033,"EXC"],[100034,"FANG"],[100035,"FAST"],[100036,"FER"],[100037,"FTNT,PANW"],[100038,"GEHC"],[100039,"HON,RKLB"],[100040,"INTU"],[100041,"ISRG"],[100042,"KHC,MDLZ"],[100043,"KLAC,SNDK,STX,WDC"],[100044,"LIN"],[100045,"LITE"],[100046,"MAR"],[100047,"NFLX"],[100048,"ODFL"],[100049,"ORLY"],[100050,"PCAR"],[100051,"PDD"],[100052,"ROST"],[100053,"SBUX"],[100054,"TMUS"],[100055,"TSLA"],[100056,"WBD"],[100057,"XEL"]]
AI_HARDWARE_GROUPS = {100007, 100028, 100037, 100043}
SHRINK_STRENGTH = 8.0
ADAPTIVE_INDUSTRY_MIN = 8
TAXONOMY_SPECS = {
	"LEGACY_FULL": {"sector": "legacy", "group": "legacy", "selector": "raw", "minimum": 3},
	"LEGACY_GROUP": {"sector": "morningstar", "group": "legacy", "selector": "raw", "minimum": 3},
	"MSTAR_GROUP_RAW": {"sector": "morningstar", "group": "industry_group", "selector": "raw", "minimum": 3},
	"MSTAR_INDUSTRY_RAW": {"sector": "morningstar", "group": "industry", "selector": "raw", "minimum": 3},
	"MSTAR_GROUP_SHRUNK": {"sector": "morningstar", "group": "industry_group", "selector": "shrunk", "minimum": 3},
	"MSTAR_ADAPTIVE": {"sector": "morningstar", "group": "adaptive", "selector": "shrunk", "minimum": 5},
	"NO_GROUP": {"sector": "morningstar", "group": "industry_group", "selector": "none", "minimum": 0},
}
SCORE_SPECS = {"A": (1.0, False), "C": (0.5, True)}
ACCOUNT_SPECS = [
	(f"{score}__{taxonomy}", score, taxonomy)
	for score in SCORE_SPECS
	for taxonomy in TAXONOMY_SPECS
]
LEGACY_SECTOR = {}
for group_code, tickers in LEGACY_GROUPS:
	for ticker in tickers.split(","):
		LEGACY_SECTOR[ticker] = group_code
def finite(value):
	try:
		return value is not None and math.isfinite(float(value))
	except Exception:
		return False
def average(values):
	clean = [float(value) for value in values if finite(value)]
	return sum(clean) / len(clean) if clean else None
def median(values):
	clean = sorted(float(value) for value in values if finite(value))
	if not clean:
		return None
	middle = len(clean) // 2
	return clean[middle] if len(clean) % 2 else (clean[middle - 1] + clean[middle]) / 2
def clamp(value, lower, upper):
	if not finite(value):
		return lower
	return min(upper, max(lower, float(value)))
def pct_return(values, days):
	if len(values) <= days or not values[-1 - days]:
		return None
	return values[-1] / values[-1 - days] - 1
def weighted_return(returns):
	parts = [(returns.get("r1m"), 0.4), (returns.get("r3m"), 0.35), (returns.get("r6m"), 0.25)]
	valid = [(value, weight) for value, weight in parts if finite(value)]
	if not valid:
		return None
	total_weight = sum(weight for _, weight in valid)
	return sum(value * weight for value, weight in valid) / total_weight
def percentile_score(values, value, maximum):
	clean = sorted(float(item) for item in values if finite(item))
	if not clean or not finite(value):
		return 0.0
	return round(sum(item <= value for item in clean) / len(clean) * maximum, 2)
def moving_average(values, length):
	return average(values[-length:]) if len(values) >= length else None
def dollar_volume_score(value):
	if not finite(value):
		return 0
	if value >= 200_000_000:
		return 5
	if value >= 100_000_000:
		return 4
	if value >= 50_000_000:
		return 3
	if value >= 20_000_000:
		return 1
	return 0
def volume_increase_score(value):
	if not finite(value):
		return 0
	if value >= 1.5:
		return 5
	if value >= 1.25:
		return 4
	if value >= 1.1:
		return 3
	if value >= 0.9:
		return 2
	return 0
def up_down_volume_score(value):
	if not finite(value):
		return 0
	if value >= 1.3:
		return 5
	if value >= 1.15:
		return 4
	if value >= 1.0:
		return 3
	if value >= 0.85:
		return 1
	return 0
def high_proximity_score(metric):
	if not metric.get("high52") or not metric.get("close"):
		return 0
	distance = metric["close"] / metric["high52"] - 1
	if distance >= -0.05:
		return 5
	if distance >= -0.10:
		return 4
	if distance >= -0.15:
		return 3
	if distance >= -0.25:
		return 2
	return 0
def moving_average_score(metric):
	score = 0
	if finite(metric["sma20"]) and metric["close"] > metric["sma20"]:
		score += 2
	if finite(metric["sma50"]) and metric["close"] > metric["sma50"]:
		score += 2
	if finite(metric["sma200"]) and metric["close"] > metric["sma200"]:
		score += 2
	if finite(metric["sma20"]) and finite(metric["sma50"]) and metric["sma20"] > metric["sma50"]:
		score += 1
	return score
def overextension_penalty(metric):
	penalty = 0
	if finite(metric["sma20"]) and metric["close"] / metric["sma20"] - 1 >= 0.15:
		penalty -= 1
	if finite(metric["sma20"]) and metric["close"] / metric["sma20"] - 1 >= 0.25:
		penalty -= 1
	r10 = pct_return(metric["closes"], 10)
	if finite(r10) and r10 >= 0.25:
		penalty -= 1
	return max(-3, penalty)
def base_metrics(rows):
	data = [row for row in rows if finite(row["close"]) and finite(row["volume"])]
	if not data:
		return None
	closes = [row["close"] for row in data]
	highs = [row["high"] for row in data]
	lows = [row["low"] for row in data]
	volumes = [row["volume"] for row in data]
	returns = {
		"r1m": pct_return(closes, 21),
		"r3m": pct_return(closes, 63),
		"r6m": pct_return(closes, 126),
	}
	up_volumes = []
	down_volumes = []
	for index in range(max(1, len(data) - 20), len(data)):
		if closes[index] > closes[index - 1]:
			up_volumes.append(volumes[index])
		elif closes[index] < closes[index - 1]:
			down_volumes.append(volumes[index])
	avg_vol10 = average(volumes[-10:])
	avg_vol20 = average(volumes[-20:])
	avg_vol50 = average(volumes[-50:])
	avg_down = average(down_volumes)
	metric = {
		"close": closes[-1],
		"closes": closes,
		"returns": returns,
		"momentum": weighted_return(returns),
		"sma20": moving_average(closes, 20),
		"sma50": moving_average(closes, 50),
		"sma200": moving_average(closes, 200),
		"high20": max(highs[-20:]),
		"low20": min(lows[-20:]),
		"high52": max(highs[-252:]),
		"avg_dollar20": average([row["close"] * row["volume"] for row in data[-20:]]),
		"volume_ratio": avg_vol10 / avg_vol50 if avg_vol50 else None,
		"up_down_ratio": (average(up_volumes) or 0) / avg_down if avg_down else None,
	}
	metric["above50"] = finite(metric["sma50"]) and metric["close"] > metric["sma50"]
	metric["above200"] = finite(metric["sma200"]) and metric["close"] > metric["sma200"]
	metric["near_high"] = metric["close"] / metric["high52"] - 1 >= -0.10
	return metric
def weekly_rows(daily_rows):
	grouped = {}
	for row in daily_rows:
		date = row["date"]
		iso = date.isocalendar()
		grouped[(iso.year, iso.week)] = row
	rows = [grouped[key] for key in sorted(grouped)]
	closes = [row["close"] for row in rows]
	result = []
	for index, row in enumerate(rows):
		ma10 = average(closes[index - 9:index + 1]) if index >= 9 else None
		rsi14 = None
		if index >= 14:
			gains = 0.0
			losses = 0.0
			for cursor in range(index - 13, index + 1):
				change = closes[cursor] - closes[cursor - 1]
				if change > 0:
					gains += change
				else:
					losses += abs(change)
			rsi14 = 100.0 if losses == 0 else 100 - 100 / (1 + gains / losses)
		result.append({"date": row["date"], "close": row["close"], "ma10": ma10, "rsi14": rsi14})
	return result
def make_account(key, score, taxonomy):
	return {
		"key": key, "score": score, "taxonomy": taxonomy,
		"cash": INITIAL_CAPITAL, "lots": [], "signal_history": [],
		"group_history": [], "curve": [], "buy_index": 0, "attempted": 0,
		"executed": 0, "skipped": 0, "sell_events": 0, "costs": 0.0,
		"first_buy_date": None, "selected": [], "signal_group_sizes": [],
		"signal_picks": [],
	}
