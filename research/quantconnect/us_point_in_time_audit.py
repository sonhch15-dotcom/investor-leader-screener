from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import calendar
import math
INITIAL_CAPITAL = 10_000_000.0
COST_RATE = 0.001
MIN_BUY = 100_000.0
FIRST_SIGNAL = datetime(2021, 8, 27)
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
CLASSIFICATION_MODE = "LEGACY_COMPAT"
UNIVERSE_MODE = "PIT"
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
def make_account(key):
	return {
		"key": key, "cash": INITIAL_CAPITAL, "lots": [], "signal_history": [],
		"group_history": [], "curve": [], "buy_index": 0, "attempted": 0,
		"executed": 0, "skipped": 0, "sell_events": 0, "costs": 0.0,
		"first_buy_date": None, "selected": [], "signal_picks": [],
	}
class PointInTimeLeaderAudit(QCAlgorithm):
	def initialize(self):
		self.set_start_date(2020, 7, 1)
		self.set_end_date(2026, 7, 10)
		self.set_cash(100_000)
		self.set_time_zone(TimeZones.NEW_YORK)
		self.universe_settings.resolution = Resolution.DAILY
		self.universe_settings.asynchronous = False
		self.rows = defaultdict(lambda: deque(maxlen=270))
		self.latest_prices = {}
		self.qqq_full = []
		self.spy_members = set()
		self.qqq_members = set()
		self.fixed_members = set()
		self.ever_members = set()
		self.pending = None
		self.cohort_index = 0
		self.last_signal_month = None
		self.delisting_records = []
		self.accounts = {"A": make_account("A"), "C": make_account("C")}
		self.etfs = {}
		for ticker in MARKET_ETFS + SECTOR_ETFS + THEME_ETFS + LEVERAGED_ETFS:
			self.etfs[ticker] = self.add_equity(
				ticker,
				Resolution.DAILY,
				data_normalization_mode=DataNormalizationMode.ADJUSTED,
			).symbol
		self.spy = self.etfs["SPY"]
		self.qqq = self.etfs["QQQ"]
		if UNIVERSE_MODE == "FIXED":
			for ticker in LEGACY_SECTOR:
				try:
					self.fixed_members.add(self.add_equity(ticker.replace("-", "."), Resolution.DAILY, data_normalization_mode=DataNormalizationMode.ADJUSTED).symbol)
				except Exception as error:
					self.debug(f"FIXED_ADD_FAIL|{ticker}|{str(error)[:60]}")
		self.sector_etf = {
			MorningstarSectorCode.BASIC_MATERIALS: self.etfs["XLB"],
			MorningstarSectorCode.CONSUMER_CYCLICAL: self.etfs["XLY"],
			MorningstarSectorCode.FINANCIAL_SERVICES: self.etfs["XLF"],
			MorningstarSectorCode.REAL_ESTATE: self.etfs["XLRE"],
			MorningstarSectorCode.CONSUMER_DEFENSIVE: self.etfs["XLP"],
			MorningstarSectorCode.HEALTHCARE: self.etfs["XLV"],
			MorningstarSectorCode.UTILITIES: self.etfs["XLU"],
			MorningstarSectorCode.COMMUNICATION_SERVICES: self.etfs["XLC"],
			MorningstarSectorCode.ENERGY: self.etfs["XLE"],
			MorningstarSectorCode.INDUSTRIALS: self.etfs["XLI"],
			MorningstarSectorCode.TECHNOLOGY: self.etfs["XLK"],
		}
		self.defensive_sectors = {
			MorningstarSectorCode.REAL_ESTATE,
			MorningstarSectorCode.CONSUMER_DEFENSIVE,
			MorningstarSectorCode.UTILITIES,
		}
		self.add_universe(self.universe.etf(self.spy, self.universe_settings, self.select_spy))
		self.add_universe(self.universe.etf(self.qqq, self.universe_settings, self.select_qqq))
		self.schedule.on(
			self.date_rules.week_end(self.spy),
			self.time_rules.after_market_close(self.spy, 5),
			self.process_weekly_tasks,
		)
	def last_friday(self, year, month):
		day = calendar.monthrange(year, month)[1]
		date = datetime(year, month, day)
		while date.weekday() != 4:
			day -= 1
			date = datetime(year, month, day)
		return date
	def select_spy(self, constituents):
		rows = list(constituents)
		self.spy_members = {row.symbol for row in rows}
		self.ever_members.update(self.spy_members)
		return list(self.spy_members)
	def select_qqq(self, constituents):
		rows = list(constituents)
		self.qqq_members = {row.symbol for row in rows}
		self.ever_members.update(self.qqq_members)
		return list(self.qqq_members)
	def on_data(self, data):
		current_date = self.time.date()
		for symbol, bar in data.bars.items():
			row = {
				"date": current_date,
				"open": float(bar.open),
				"high": float(bar.high),
				"low": float(bar.low),
				"close": float(bar.close),
				"volume": float(bar.volume),
			}
			history = self.rows[symbol]
			if not history or history[-1]["date"] != current_date:
				history.append(row)
			self.latest_prices[symbol] = row["close"]
			if symbol == self.qqq and (not self.qqq_full or self.qqq_full[-1]["date"] != current_date):
				self.qqq_full.append(row)
		if self.pending and current_date > self.pending["signal_date"].date() and self.spy in data.bars:
			self.execute_cohort(current_date)
		self.mark_accounts(current_date)
	def on_securities_changed(self, changes):
		if self.time.date() < FIRST_SIGNAL.date():
			return
		for security in changes.added_securities:
			symbol = security.symbol
			if symbol in self.rows and len(self.rows[symbol]) >= 200:
				continue
			try:
				history = self.history(symbol, 270, Resolution.DAILY)
				if history.empty:
					continue
				existing = self.rows[symbol]
				for index, row in history.iterrows():
					stamp = index[-1] if isinstance(index, tuple) else index
					date = stamp.to_pydatetime().date() if hasattr(stamp, "to_pydatetime") else stamp.date()
					existing.append({
						"date": date,
						"open": float(row["open"]),
						"high": float(row["high"]),
						"low": float(row["low"]),
						"close": float(row["close"]),
						"volume": float(row["volume"]),
					})
			except Exception as error:
				self.debug(f"WARMUP_FAIL|{symbol.value}|{str(error)[:80]}")
	def create_signal(self):
		members = self.fixed_members if UNIVERSE_MODE == "FIXED" else self.spy_members | self.qqq_members
		if not members:
			self.debug(f"SIGNAL_FAIL|{self.time.date()}|empty_membership")
			return
		shared = self.build_shared_rows(members)
		selections = {}
		for key, weight, normalize in [("A", 1.0, False), ("C", 0.5, True)]:
			scored = self.score_variant(shared, weight, normalize)
			selections[key] = self.select_leader2(self.accounts[key], scored)
			self.accounts[key]["signal_picks"].extend({
				"symbol": row["symbol"], "ticker": row["ticker"],
				"signal_date": self.time.date(),
			} for row in selections[key])
		self.pending = {
			"index": self.cohort_index,
			"signal_date": self.time,
			"members": len(members),
			"selections": selections,
		}
		a_text = ",".join(row["ticker"] for row in selections["A"]) or "-"
		c_text = ",".join(row["ticker"] for row in selections["C"]) or "-"
		self.debug(f"SIG|{self.time:%Y-%m}|U={len(members)}|A={a_text}|C={c_text}")
		self.cohort_index += 1
	def build_shared_rows(self, members):
		metric_symbols = set(members) | set(self.etfs.values())
		metrics = {}
		for symbol in metric_symbols:
			metric = base_metrics(list(self.rows.get(symbol, [])))
			if metric:
				metrics[symbol] = metric
		spy_metric = metrics.get(self.spy)
		qqq_metric = metrics.get(self.qqq)
		momentum_values = [metric["momentum"] for metric in metrics.values()]
		spy_excess = {}
		qqq_excess = {}
		for symbol, metric in metrics.items():
			spy_excess[symbol] = weighted_return({
				key: metric["returns"].get(key) - spy_metric["returns"].get(key)
				if spy_metric and finite(metric["returns"].get(key)) and finite(spy_metric["returns"].get(key)) else None
				for key in ["r1m", "r3m", "r6m"]
			})
			qqq_excess[symbol] = weighted_return({
				key: metric["returns"].get(key) - qqq_metric["returns"].get(key)
				if qqq_metric and finite(metric["returns"].get(key)) and finite(qqq_metric["returns"].get(key)) else None
				for key in ["r1m", "r3m", "r6m"]
			})
		spy_values = list(spy_excess.values())
		qqq_values = list(qqq_excess.values())
		rows = []
		for symbol in members:
			metric = metrics.get(symbol)
			if not metric or not self.securities.contains_key(symbol):
				continue
			security = self.securities[symbol]
			fundamental = security.fundamentals
			if fundamental is None or not fundamental.has_fundamental_data:
				continue
			classification = fundamental.asset_classification
			ticker_key = symbol.value.replace(".", "-")
			legacy = LEGACY_SECTOR.get(ticker_key) if CLASSIFICATION_MODE == "LEGACY_COMPAT" else None
			sector = legacy if legacy else int(classification.morningstar_sector_code)
			group = legacy if legacy else int(classification.morningstar_industry_group_code)
			if sector <= 0 or group <= 0:
				continue
			relative = (
				percentile_score(spy_values, spy_excess.get(symbol), 15)
				+ percentile_score(qqq_values, qqq_excess.get(symbol), 15)
				+ percentile_score(momentum_values, metric["momentum"], 5)
			)
			momentum = clamp(
				percentile_score(momentum_values, metric["momentum"], 15)
				+ moving_average_score(metric)
				+ high_proximity_score(metric)
				+ overextension_penalty(metric),
				0,
				30,
			)
			rows.append({
				"symbol": symbol,
				"ticker": symbol.value,
				"sector": sector,
				"group": group,
				"tags": SEED_TAGS.get(ticker_key, []),
				"metric": metric,
				"relative": relative,
				"momentum_score": momentum,
				"strength": relative + momentum,
				"spy_excess": spy_excess.get(symbol),
				"qqq_excess": qqq_excess.get(symbol),
			})
		sector_averages = {}
		for sector in {row["sector"] for row in rows}:
			sector_averages[sector] = average(row["strength"] for row in rows if row["sector"] == sector)
		sector_average_values = list(sector_averages.values())
		sector_etf_values = [metrics.get(symbol, {}).get("momentum") for symbol in self.sector_etf.values()]
		strong_tags = defaultdict(int)
		for row in rows:
			if row["strength"] >= 45:
				for tag in row["tags"]:
					strong_tags[tag] += 1
		for row in rows:
			metric = row["metric"]
			theme_bonus = 0
			if row["tags"]:
				theme_bonus += 1
			if any(strong_tags[tag] >= 2 for tag in row["tags"]):
				theme_bonus += 1
			if any(strong_tags[tag] >= 4 for tag in row["tags"]):
				theme_bonus += 1
			sector_symbol = self.sector_etf.get(row["sector"])
			sector_etf_momentum = metrics.get(sector_symbol, {}).get("momentum") if sector_symbol else None
			row["sector_theme"] = clamp(
				percentile_score(sector_etf_values, sector_etf_momentum, 10)
				+ percentile_score(sector_average_values, sector_averages.get(row["sector"]), 7)
				+ min(3, theme_bonus),
				0,
				20,
			)
			row["dollar_score"] = dollar_volume_score(metric["avg_dollar20"])
			row["volume_score"] = (
				row["dollar_score"]
				+ volume_increase_score(metric["volume_ratio"])
				+ up_down_volume_score(metric["up_down_ratio"])
			)
		ai_groups = {row["group"] for row in rows if row["ticker"].replace(".", "-") in AI_HARDWARE}
		for row in rows:
			row["ai_hardware"] = row["ticker"].replace(".", "-") in AI_HARDWARE or row["group"] in AI_HARDWARE_GROUPS or row["group"] in ai_groups
		return rows
	def score_variant(self, shared, sector_weight, normalize):
		maximum = 35 + 30 + 15 + 20 * sector_weight
		rows = []
		for source in shared:
			row = dict(source)
			raw = row["relative"] + row["momentum_score"] + row["sector_theme"] * sector_weight + row["volume_score"]
			row["score"] = raw / maximum * 100 if normalize else raw
			row["eligible"] = row["score"] >= 70 and row["dollar_score"] > 0
			rows.append(row)
		rows.sort(key=lambda row: row["score"], reverse=True)
		return rows
	def select_leader2(self, account, rows):
		eligible = [row for row in rows if row["eligible"]]
		for rank, row in enumerate(eligible, 1):
			row["rank"] = rank
		top20 = eligible[:20]
		top50 = eligible[:50]
		top100 = eligible[:100]
		qqq_momentum = base_metrics(list(self.rows[self.qqq]))["momentum"]
		spy_momentum = base_metrics(list(self.rows[self.spy]))["momentum"]
		group_stats = []
		for group in {row["group"] for row in rows}:
			group_rows = [row for row in rows if row["group"] == group]
			if len(group_rows) < 3:
				continue
			group_eligible = [row for row in group_rows if row["eligible"]]
			momentums = [row["metric"]["momentum"] for row in group_rows]
			previous = []
			for period in account["group_history"][-3:]:
				match = next((item for item in period if item["group"] == group), None)
				if match:
					previous.append(match)
			prior_top50 = average(item["top50"] for item in previous) or 0
			current_top50 = sum(row["group"] == group for row in top50)
			acceleration = current_top50 - prior_top50
			stat = {
				"group": group,
				"count": len(group_rows),
				"top20": sum(row["group"] == group for row in top20),
				"top50": current_top50,
				"top100": sum(row["group"] == group for row in top100),
				"eligible_rate": len(group_eligible) / len(group_rows),
				"top50_concentration": current_top50 / len(group_rows),
				"top100_concentration": sum(row["group"] == group for row in top100) / len(group_rows),
				"avg_momentum": average(momentums),
				"above50": average(1 if row["metric"]["above50"] else 0 for row in group_rows),
				"above200": average(1 if row["metric"]["above200"] else 0 for row in group_rows),
				"near_high": average(1 if row["metric"]["near_high"] else 0 for row in group_rows),
				"score75": average(1 if row["score"] >= 75 else 0 for row in group_rows),
				"score80": average(1 if row["score"] >= 80 else 0 for row in group_rows),
			}
			stat["leadership"] = (
				clamp(stat["avg_momentum"] - qqq_momentum, -0.2, 0.4) * 100
				+ clamp(stat["avg_momentum"] - spy_momentum, -0.2, 0.4) * 60
				+ stat["above50"] * 22
				+ stat["above200"] * 16
				+ stat["near_high"] * 16
				+ stat["score75"] * 20
				+ stat["score80"] * 12
				+ stat["eligible_rate"] * 12
				+ stat["top50_concentration"] * 90
				+ stat["top100_concentration"] * 35
				+ stat["top20"] * 8
				+ clamp(acceleration, -4, 6) * 4
				+ len(previous) * 4
			)
			group_stats.append(stat)
		group_stats.sort(key=lambda row: row["leadership"], reverse=True)
		account["group_history"].append(group_stats)
		selected = []
		used = set()
		for stat in group_stats[:2]:
			match = next((row for row in eligible if row["group"] == stat["group"] and row["symbol"] not in used), None)
			if match:
				selected.append(match)
				used.add(match["symbol"])
		selected.sort(key=lambda row: row["rank"])
		return selected[:2]
	def execute_cohort(self, date):
		pending = self.pending
		cohort_index = pending["index"]
		for account in self.accounts.values():
			self.process_calendar_exits(account, cohort_index, date, pending["signal_date"].date())
			selections = sorted(pending["selections"][account["key"]], key=lambda row: row["ticker"])
			for selected in selections:
				self.execute_buy(account, selected, cohort_index, pending["signal_date"].date(), date)
		self.pending = None
	def process_calendar_exits(self, account, cohort_index, date, signal_date):
		for lot in list(account["lots"]):
			if lot["remaining"] <= 0:
				continue
			if not lot["fixed_done"] and lot["cohort"] + 6 == cohort_index:
				self.sell_lot(account, lot, 0.5, date, "half_fixed_6m")
				complete_rows = [row for row in self.rows[lot["symbol"]] if row["date"] <= signal_date]
				weekly = weekly_rows(complete_rows)
				fixed_week = weekly[-1] if weekly else None
				alive = (
					fixed_week
					and finite(fixed_week["ma10"])
					and finite(fixed_week["rsi14"])
					and fixed_week["close"] >= fixed_week["ma10"]
					and fixed_week["rsi14"] >= 50
				)
				lot["fixed_done"] = True
				if alive:
					lot["extended"] = True
					lot["fixed_date"] = date
				else:
					self.sell_lot(account, lot, 0.5, date, "trend_not_alive_at_6m")
			if lot["remaining"] > 0 and lot["cohort"] + 12 == cohort_index:
				self.sell_lot(account, lot, 1.0, date, "max_12m")
	def execute_buy(self, account, selected, cohort, signal_date, date):
		account["attempted"] += 1
		cash = account["cash"]
		if cash <= 1_000_000:
			base_amount = 500_000
		elif account["buy_index"] < 6 and cash >= 3_000_000:
			base_amount = 1_000_000
		else:
			base_amount = 750_000
		prior_symbol = sum(
			item["symbol"] == selected["symbol"] and (cohort - item["cohort"]) <= 12
			for item in account["signal_history"]
		)
		account["signal_history"].append({"cohort": cohort, "symbol": selected["symbol"]})
		account["buy_index"] += 1
		multiplier = 1.45 if prior_symbol >= 2 else 1.25 if prior_symbol >= 1 else 1.0
		if selected["ai_hardware"]:
			multiplier *= 1.25
		if selected["sector"] in self.defensive_sectors:
			multiplier *= 0.85
		wanted = base_amount * min(multiplier, 1.85)
		open_cost = sum(
			lot["remaining"] * lot["entry_price"]
			for lot in account["lots"] if lot["symbol"] == selected["symbol"]
		)
		cap_room = max(0, INITIAL_CAPITAL * 0.275 - open_cost)
		max_cash = account["cash"] / (1 + COST_RATE)
		amount = min(wanted, cap_room, max_cash)
		price = self.latest_prices.get(selected["symbol"])
		if amount < MIN_BUY or not finite(price) or price <= 0:
			account["skipped"] += 1
			return
		manual_symbol = self.add_equity(
			selected["ticker"],
			Resolution.DAILY,
			data_normalization_mode=DataNormalizationMode.ADJUSTED,
		).symbol
		if manual_symbol != selected["symbol"]:
			selected = dict(selected)
			selected["symbol"] = manual_symbol
			price = self.latest_prices.get(manual_symbol, price)
		cost = amount * COST_RATE
		shares = amount / price
		account["cash"] -= amount + cost
		account["costs"] += cost
		account["executed"] += 1
		account["first_buy_date"] = account["first_buy_date"] or date
		lot = {
			"symbol": selected["symbol"],
			"ticker": selected["ticker"],
			"sector": selected["sector"],
			"group": selected["group"],
			"cohort": cohort,
			"signal_date": signal_date,
			"entry_date": date,
			"entry_price": price,
			"original": shares,
			"remaining": shares,
			"fixed_done": False,
			"extended": False,
			"fixed_date": None,
		}
		account["lots"].append(lot)
		account["selected"].append(lot)
	def sell_lot(self, account, lot, fraction, date, reason, override_price=None):
		if lot["remaining"] <= 0:
			return
		if fraction >= 1:
			shares = lot["remaining"]
		else:
			shares = min(lot["remaining"], lot["original"] * fraction)
		price = override_price if finite(override_price) else self.latest_prices.get(lot["symbol"])
		if not finite(price) or price <= 0:
			return
		gross = shares * price
		cost = gross * COST_RATE
		account["cash"] += gross - cost
		account["costs"] += cost
		account["sell_events"] += 1
		lot["remaining"] = max(0, lot["remaining"] - shares)
		lot["last_exit_date"] = date
		lot["last_exit_reason"] = reason
	def process_weekly_tasks(self):
		date = self.time.date()
		if FIRST_SIGNAL.date() <= date <= LAST_SIGNAL.date():
			last_friday = self.last_friday(date.year, date.month).date()
			month_key = (date.year, date.month)
			if date <= last_friday and (last_friday - date).days <= 4 and self.last_signal_month != month_key:
				self.create_signal()
				self.last_signal_month = month_key
		for account in self.accounts.values():
			for lot in account["lots"]:
				if lot["remaining"] <= 0 or not lot["extended"] or date <= lot["fixed_date"]:
					continue
				weekly = weekly_rows(list(self.rows[lot["symbol"]]))
				if len(weekly) < 2:
					continue
				current = weekly[-1]
				previous = weekly[-2]
				broken = (
					finite(current["ma10"])
					and finite(previous["ma10"])
					and current["close"] < current["ma10"]
					and previous["close"] < previous["ma10"]
				)
				if broken:
					self.sell_lot(account, lot, 1.0, date, "two_week_10w_break")
		self.mark_accounts(date)
	def on_delistings(self, delistings):
		for symbol, event in delistings.items():
			if event.type != DelistingType.WARNING:
				continue
			selected = False
			for account in self.accounts.values():
				for lot in account["lots"]:
					if lot["symbol"] == symbol and lot["remaining"] > 0:
						selected = True
						self.sell_lot(account, lot, 1.0, self.time.date(), "delisting_warning", float(event.price))
			if selected:
				self.delisting_records.append(f"{symbol.value}@{self.time:%Y-%m-%d}")
	def account_equity(self, account):
		open_value = sum(
			lot["remaining"] * self.latest_prices.get(lot["symbol"], lot["entry_price"])
			for lot in account["lots"] if lot["remaining"] > 0
		)
		return account["cash"] + open_value
	def mark_accounts(self, date):
		for account in self.accounts.values():
			if account["first_buy_date"] is None:
				continue
			equity = self.account_equity(account)
			if account["curve"] and account["curve"][-1]["date"] == date:
				account["curve"][-1]["equity"] = equity
			else:
				account["curve"].append({"date": date, "equity": equity})
	def summarize(self, account):
		final_equity = self.account_equity(account)
		total_return = final_equity / INITIAL_CAPITAL - 1
		start = account["first_buy_date"]
		end = self.time.date()
		years = max((end - start).days / 365.25, 1 / 365.25)
		cagr = (1 + total_return) ** (1 / years) - 1 if total_return > -1 else -1
		peak = INITIAL_CAPITAL
		mdd = 0.0
		for row in account["curve"]:
			peak = max(peak, row["equity"])
			mdd = min(mdd, row["equity"] / peak - 1)
		qqq_rows = [row for row in self.qqq_full if row["date"] >= start]
		qqq_return = qqq_rows[-1]["close"] / qqq_rows[0]["close"] * (1 - COST_RATE) - 1 if qqq_rows else None
		return {
			"equity": final_equity,
			"return": total_return,
			"cagr": cagr,
			"mdd": mdd,
			"qqq": qqq_return,
			"open": sum(lot["remaining"] > 0 for lot in account["lots"]),
		}
	def yearly_returns(self, account):
		grouped = defaultdict(list)
		for row in account["curve"]:
			grouped[row["date"].year].append(row["equity"])
		result = []
		prior = INITIAL_CAPITAL
		for year in sorted(grouped):
			end_value = grouped[year][-1]
			result.append((year, end_value / prior - 1))
			prior = end_value
		return result
	def on_end_of_algorithm(self):
		current_members = self.spy_members | self.qqq_members
		last_data = self.qqq_full[-1]["date"] if self.qqq_full else None
		self.debug(
			f"PIT_META|mode={UNIVERSE_MODE}|class={CLASSIFICATION_MODE}|signals={self.cohort_index}|"
			f"ever={len(self.ever_members)}|current={len(current_members)}|last_data={last_data}|"
			f"delist_selected={len(set(self.delisting_records))}"
		)
		for key, account in self.accounts.items():
			summary = self.summarize(account)
			self.debug(
				f"SUMMARY|{key}|ret={summary['return']:.4f}|cagr={summary['cagr']:.4f}|"
				f"mdd={summary['mdd']:.4f}|qqq={summary['qqq']:.4f}|"
				f"buys={account['executed']}/{account['attempted']}|skip={account['skipped']}|"
				f"cash={account['cash']:.0f}|equity={summary['equity']:.0f}|open={summary['open']}|"
				f"cost={account['costs']:.0f}"
			)
			years = ",".join(f"{year}:{value:.3f}" for year, value in self.yearly_returns(account))
			self.debug(f"YEAR|{key}|{years}")
			removed = sorted({
				f"{pick['ticker']}@{pick['signal_date']:%Y-%m}"
				for pick in account["signal_picks"] if pick["symbol"] not in current_members
			})
			self.debug(f"OUT_CURRENT|{key}|count={len(removed)}|{','.join(removed[:35])}")
		self.debug(f"SELECTED_DELIST|{','.join(sorted(set(self.delisting_records))) or '-'}")
