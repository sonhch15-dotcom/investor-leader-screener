package com.sweethome.investor;

final class StrategyMath {
    static final String STRATEGY_US_CAP_27_5 = "us_leader2_repeat_theme_combo_cap27_5";
    static final String STRATEGY_US_SCORE_C_CAP_27_5 = "us_leader2_score_c_cap27_5";
    static final String STRATEGY_KR_LEADER2 = "kr_stock_leader2";
    static final String STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA_DEFENSIVE = "kr_etf_benchmark_or_alpha_defensive";
    static final String STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA = "kr_etf_benchmark_or_alpha";
    static final String STRATEGY_KR_ETF_CORE_SATELLITE_50_40_10 = "kr_etf_core_satellite_50_40_10";

    private StrategyMath() {
    }

    static boolean isUsCap275Strategy(String strategyKey) {
        return STRATEGY_US_CAP_27_5.equals(strategyKey) || STRATEGY_US_SCORE_C_CAP_27_5.equals(strategyKey);
    }

    static boolean isPackagedKrEtfStrategy(String strategyKey) {
        return STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA_DEFENSIVE.equals(strategyKey);
    }

    static OrderPlan orderPlan(
            double targetOrderValue,
            double executedOrderValue,
            double availableCash,
            double feeBuffer,
            double capLimitValue,
            double totalInvestedValue,
            double referencePrice
    ) {
        double remaining = Math.max(0, targetOrderValue - executedOrderValue);
        double cashRoom = Math.max(0, availableCash - feeBuffer);
        double capRoom = capLimitValue <= 0 ? Double.MAX_VALUE : Math.max(0, capLimitValue - totalInvestedValue);
        double additional = Math.max(0, Math.min(remaining, Math.min(cashRoom, capRoom)));
        double additionalQuantity = recommendedBuyQuantity(additional, referencePrice);
        double executable = additionalQuantity * Math.max(0, referencePrice);
        return new OrderPlan(
                targetOrderValue,
                executedOrderValue,
                remaining,
                additional,
                executable,
                additionalQuantity,
                totalInvestedValue,
                capLimitValue
        );
    }

    static double recommendedBuyQuantity(double target, double reference) {
        if (target <= 0 || reference <= 0 || target < reference) {
            return 0;
        }
        return Math.floor(target / reference);
    }

    static boolean isBuyActionComplete(double executedOrderValue, double additionalQuantity) {
        return executedOrderValue > 0 && additionalQuantity <= 0;
    }

    static double plannedUsCap275OrderValue(
            double equity,
            double availableAtStart,
            int buyEntryCountBeforeSignal,
            int symbolBuyEntryCountBeforeSignal,
            String symbol,
            String sector,
            double investedBeforeSignal
    ) {
        double baseEquity = equity > 0 ? equity : availableAtStart;
        if (baseEquity <= 0) {
            return 0;
        }
        double baseRatio = usBaseBuyRatio(baseEquity, availableAtStart, buyEntryCountBeforeSignal);
        double wanted = baseEquity * baseRatio * usRepeatThemeMultiplier(symbol, sector, symbolBuyEntryCountBeforeSignal);
        double capRoom = Math.max(0, baseEquity * 0.275 - investedBeforeSignal);
        double deployable = Math.max(0, availableAtStart - Math.min(50, Math.max(0, availableAtStart * 0.005)));
        return Math.max(0, Math.min(Math.min(wanted, capRoom), deployable));
    }

    static double usBaseBuyRatio(double equity, double available, int buyEntryCount) {
        if (equity <= 0) {
            return 0;
        }
        if (available <= equity * 0.10) {
            return 0.05;
        }
        if (buyEntryCount < 6 && available >= equity * 0.30) {
            return 0.10;
        }
        return 0.075;
    }

    static double usRepeatThemeMultiplier(String symbol, String sector, int previousSymbolBuys) {
        double multiplier = 1;
        if (previousSymbolBuys >= 2) {
            multiplier *= 1.45;
        } else if (previousSymbolBuys >= 1) {
            multiplier *= 1.25;
        }
        if (isAiHardware(symbol, sector)) {
            multiplier *= 1.25;
        }
        if (isDefensiveOrWeakSector(sector)) {
            multiplier *= 0.85;
        }
        return Math.min(multiplier, 1.85);
    }

    static boolean isAiHardware(String symbol, String sector) {
        String safeSymbol = symbol == null ? "" : symbol;
        String safeSector = sector == null ? "" : sector;
        return "NVDA".equals(safeSymbol) || "AMD".equals(safeSymbol) || "AVGO".equals(safeSymbol)
                || "ARM".equals(safeSymbol) || "MU".equals(safeSymbol) || "ASML".equals(safeSymbol)
                || "TSM".equals(safeSymbol) || "SMH".equals(safeSymbol) || "SOXX".equals(safeSymbol)
                || "WDC".equals(safeSymbol) || "STX".equals(safeSymbol) || "DELL".equals(safeSymbol)
                || "HPE".equals(safeSymbol) || "ANET".equals(safeSymbol) || "VRT".equals(safeSymbol)
                || "SMCI".equals(safeSymbol) || "MRVL".equals(safeSymbol) || "LRCX".equals(safeSymbol)
                || "KLAC".equals(safeSymbol) || "AMAT".equals(safeSymbol) || "TER".equals(safeSymbol)
                || "MPWR".equals(safeSymbol) || "ON".equals(safeSymbol) || "QCOM".equals(safeSymbol)
                || "INTC".equals(safeSymbol) || "SNDK".equals(safeSymbol)
                || "Semiconductors".equals(safeSector)
                || "Electronic Components".equals(safeSector)
                || "Computer Peripheral Equipment".equals(safeSector)
                || "Computer Communications Equipment".equals(safeSector);
    }

    static boolean isDefensiveOrWeakSector(String sector) {
        return "Real Estate".equals(sector) || "Consumer Staples".equals(sector) || "Utilities".equals(sector);
    }

    static double plannedKrLeader2OrderValue(
            double equity,
            double availableAtStart,
            int buyEntryCountBeforeSignal,
            int signalCount,
            double investedBeforeSignal
    ) {
        double baseEquity = equity > 0 ? equity : availableAtStart;
        if (baseEquity <= 0) {
            return 0;
        }
        int safeSignalCount = Math.max(1, signalCount);
        double monthlyRatio = buyEntryCountBeforeSignal < safeSignalCount * 3 ? 0.30 : 0.15;
        double wanted = baseEquity * monthlyRatio / safeSignalCount;
        double capRoom = Math.max(0, baseEquity * 0.225 - investedBeforeSignal);
        double deployable = Math.max(0, availableAtStart - Math.min(30000, Math.max(0, availableAtStart * 0.003)));
        return Math.max(0, Math.min(Math.min(wanted, capRoom), deployable));
    }

    static EtfRebalancePlan etfRebalancePlan(
            double accountTotal,
            double targetWeight,
            double currentValue,
            double referencePrice,
            double toleranceFloor,
            double toleranceRatio,
            String holdText,
            String buyText,
            String sellText
    ) {
        double targetAmount = Math.max(0, accountTotal) * Math.max(0, targetWeight);
        double diff = targetAmount - Math.max(0, currentValue);
        double tolerance = Math.max(toleranceFloor, Math.max(0, accountTotal) * toleranceRatio);
        double quantity = referencePrice <= 0 ? 0 : Math.floor(Math.abs(diff) / referencePrice);
        double executableAmount = quantity * Math.max(0, referencePrice);
        String actionText = Math.abs(diff) <= tolerance ? holdText : diff > 0 ? buyText : sellText;
        return new EtfRebalancePlan(referencePrice, targetAmount, currentValue, diff, quantity, executableAmount, actionText, 0);
    }

    static double impliedUsdKrw(double krwValue, double usdValue) {
        return usdValue <= 0 ? 0 : krwValue / usdValue;
    }

    static boolean weeklyBreakStillValid(double packagedClose, double weeklyTrendLine, double latestPrice) {
        if (weeklyTrendLine <= 0) {
            return false;
        }
        double effectiveClose = latestPrice > 0 ? latestPrice : packagedClose;
        return effectiveClose > 0 && effectiveClose < weeklyTrendLine;
    }

    static AssetChangeBreakdown usdAssetChange(
            double depositUsd,
            double depositFx,
            double currentFx,
            double cashUsd,
            double positionCostUsd,
            double positionValueUsd
    ) {
        double currentTotalUsd = cashUsd + positionValueUsd;
        double principalKrw = depositUsd * depositFx;
        double currentTotalKrw = currentTotalUsd * currentFx;
        double investmentPnlUsd = positionValueUsd - positionCostUsd;
        double investmentPnlKrw = investmentPnlUsd * currentFx;
        double fxEffectKrw = depositUsd * (currentFx - depositFx);
        return new AssetChangeBreakdown(
                principalKrw,
                currentTotalKrw,
                currentTotalKrw - principalKrw,
                investmentPnlUsd,
                investmentPnlKrw,
                fxEffectKrw
        );
    }
}

final class AssetChangeBreakdown {
    final double principalKrw;
    final double currentTotalKrw;
    final double principalChangeKrw;
    final double investmentPnlUsd;
    final double investmentPnlKrw;
    final double fxEffectKrw;

    AssetChangeBreakdown(
            double principalKrw,
            double currentTotalKrw,
            double principalChangeKrw,
            double investmentPnlUsd,
            double investmentPnlKrw,
            double fxEffectKrw
    ) {
        this.principalKrw = principalKrw;
        this.currentTotalKrw = currentTotalKrw;
        this.principalChangeKrw = principalChangeKrw;
        this.investmentPnlUsd = investmentPnlUsd;
        this.investmentPnlKrw = investmentPnlKrw;
        this.fxEffectKrw = fxEffectKrw;
    }
}

final class OrderPlan {
    final double targetOrderValue;
    final double executedOrderValue;
    final double remainingOrderValue;
    final double additionalOrderValue;
    final double executableOrderValue;
    final double additionalQuantity;
    final double totalInvestedValue;
    final double capLimitValue;

    OrderPlan(
            double targetOrderValue,
            double executedOrderValue,
            double remainingOrderValue,
            double additionalOrderValue,
            double executableOrderValue,
            double additionalQuantity,
            double totalInvestedValue,
            double capLimitValue
    ) {
        this.targetOrderValue = targetOrderValue;
        this.executedOrderValue = executedOrderValue;
        this.remainingOrderValue = remainingOrderValue;
        this.additionalOrderValue = additionalOrderValue;
        this.executableOrderValue = executableOrderValue;
        this.additionalQuantity = additionalQuantity;
        this.totalInvestedValue = totalInvestedValue;
        this.capLimitValue = capLimitValue;
    }
}

final class EtfRebalancePlan {
    final double referencePrice;
    final double targetAmount;
    final double currentValue;
    final double diff;
    final double quantity;
    final double executableAmount;
    final String actionText;
    final int color;

    EtfRebalancePlan(
            double referencePrice,
            double targetAmount,
            double currentValue,
            double diff,
            double quantity,
            double executableAmount,
            String actionText,
            int color
    ) {
        this.referencePrice = referencePrice;
        this.targetAmount = targetAmount;
        this.currentValue = currentValue;
        this.diff = diff;
        this.quantity = quantity;
        this.executableAmount = executableAmount;
        this.actionText = actionText;
        this.color = color;
    }

    EtfRebalancePlan withColor(int color) {
        return new EtfRebalancePlan(referencePrice, targetAmount, currentValue, diff, quantity, executableAmount, actionText, color);
    }
}
