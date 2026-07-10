package com.sweethome.investor;

import org.junit.Test;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class StrategyMathSelfTest {
    @Test
    public void usCap275UsesStrategySizing() {
        double stxTarget = StrategyMath.plannedUsCap275OrderValue(
                80_000,
                80_000,
                0,
                0,
                "STX",
                "Computer Peripheral Equipment",
                0
        );
        assertEquals(10_000, stxTarget, 0.001);

        double techTarget = StrategyMath.plannedUsCap275OrderValue(
                80_000,
                80_000,
                0,
                0,
                "TECH",
                "Biotechnology",
                0
        );
        assertEquals(8_000, techTarget, 0.001);
    }

    @Test
    public void orderPlanKeepsMonthlyTargetSeparateFromCash() {
        OrderPlan plan = StrategyMath.orderPlan(
                10_000,
                12_691.33,
                67_000,
                50,
                22_000,
                12_691.33,
                906.52
        );
        assertEquals(0, plan.remainingOrderValue, 0.001);
        assertEquals(0, plan.additionalQuantity, 0.001);
    }

    @Test
    public void orderPlanDoesNotForceOneShareWhenPriceIsTooHigh() {
        assertEquals(0, StrategyMath.recommendedBuyQuantity(500, 1_000), 0.001);
    }

    @Test
    public void orderPlanSuggestsRemainingShares() {
        OrderPlan plan = StrategyMath.orderPlan(
                8_006.42,
                4_526.11,
                68_000,
                50,
                22_017.32,
                4_526.11,
                70.96
        );
        assertEquals(3_480.31, plan.remainingOrderValue, 0.01);
        assertEquals(49, plan.additionalQuantity, 0.001);
        assertEquals(3_477.04, plan.executableOrderValue, 0.01);
    }

    @Test
    public void buyActionCompletesAfterExecutedWhenNoAdditionalShareIsPossible() {
        assertTrue(StrategyMath.isBuyActionComplete(7_940.00, 0));
        assertFalse(StrategyMath.isBuyActionComplete(0, 0));
        assertFalse(StrategyMath.isBuyActionComplete(7_940.00, 1));
    }

    @Test
    public void assetChangeUsesDepositFxAndCurrentPrices() {
        double depositUsd = 80_692;
        double techCost = 112 * 70.92;
        double stxCost = 11 * 906.52;
        double cashUsd = depositUsd - techCost - stxCost;
        double positionValue = 112 * 71.15 + 11 * 890.09;
        double currentFx = 1_510.6;
        double depositFx = currentFx + 2.21;

        AssetChangeBreakdown breakdown = StrategyMath.usdAssetChange(
                depositUsd,
                depositFx,
                currentFx,
                cashUsd,
                techCost + stxCost,
                positionValue
        );

        assertEquals(62_777.24, cashUsd, 0.001);
        assertEquals(80_537.03, cashUsd + positionValue, 0.001);
        assertEquals(-154.97, breakdown.investmentPnlUsd, 0.001);
        assertEquals(-234_097.68, breakdown.investmentPnlKrw, 0.01);
        assertEquals(-178_329.32, breakdown.fxEffectKrw, 0.01);
        assertEquals(-412_427.00, breakdown.principalChangeKrw, 0.02);
        assertTrue(breakdown.principalChangeKrw < 0);
    }

    @Test
    public void krLeader2SplitsMonthlyBudgetAcrossSignals() {
        double target = StrategyMath.plannedKrLeader2OrderValue(
                10_000_000,
                10_000_000,
                0,
                2,
                0
        );
        assertEquals(1_500_000, target, 0.001);
    }

    @Test
    public void etfRebalanceUsesToleranceAndWholeShares() {
        EtfRebalancePlan buy = StrategyMath.etfRebalancePlan(
                10_000_000,
                0.50,
                3_000_000,
                70_000,
                50_000,
                0.015,
                "hold",
                "buy",
                "sell"
        );
        assertEquals("buy", buy.actionText);
        assertEquals(5_000_000, buy.targetAmount, 0.001);
        assertEquals(28, buy.quantity, 0.001);

        EtfRebalancePlan hold = StrategyMath.etfRebalancePlan(
                10_000_000,
                0.50,
                4_900_000,
                70_000,
                50_000,
                0.015,
                "hold",
                "buy",
                "sell"
        );
        assertEquals("hold", hold.actionText);
    }

    @Test
    public void etfRebalanceCanUseFivePercentSignalDrift() {
        EtfRebalancePlan hold = StrategyMath.etfRebalancePlan(
                10_000_000,
                0.50,
                4_600_000,
                70_000,
                50_000,
                0.05,
                "hold",
                "buy",
                "sell"
        );
        assertEquals("hold", hold.actionText);
        assertEquals(400_000, hold.diff, 0.001);

        EtfRebalancePlan buy = StrategyMath.etfRebalancePlan(
                10_000_000,
                0.50,
                4_400_000,
                70_000,
                50_000,
                0.05,
                "hold",
                "buy",
                "sell"
        );
        assertEquals("buy", buy.actionText);
        assertEquals(8, buy.quantity, 0.001);
    }

    @Test
    public void weeklyBreakUsesLatestQuoteToClearStaleBreak() {
        assertTrue(StrategyMath.weeklyBreakStillValid(868.26, 870.33, 0));
        assertFalse(StrategyMath.weeklyBreakStillValid(868.26, 870.33, 890.09));
        assertTrue(StrategyMath.weeklyBreakStillValid(868.26, 870.33, 869.99));
    }

    @Test
    public void liveQuoteMergeKeepsPreviousNormalQuoteWhenPartialSyncFails() throws Exception {
        PriceQuote cachedTech = new PriceQuote();
        cachedTech.symbol = "TECH";
        cachedTech.name = "Bio-Techne";
        cachedTech.market = "US_STOCK";
        cachedTech.currency = "USD";
        cachedTech.price = 70.72;
        cachedTech.priceDate = "2026-07-09";
        cachedTech.source = "yahoo-chart";
        cachedTech.status = "normal";

        PriceQuote cachedStx = new PriceQuote();
        cachedStx.symbol = "STX";
        cachedStx.name = "Seagate Technology";
        cachedStx.market = "US_STOCK";
        cachedStx.currency = "USD";
        cachedStx.price = 890.09;
        cachedStx.priceDate = "2026-07-10";
        cachedStx.source = "yahoo-chart";
        cachedStx.status = "normal";

        PriceQuote freshTech = new PriceQuote();
        freshTech.symbol = "TECH";
        freshTech.name = "Bio-Techne";
        freshTech.market = "US_STOCK";
        freshTech.currency = "USD";
        freshTech.price = 71.15;
        freshTech.priceDate = "2026-07-10";
        freshTech.source = "yahoo-chart";
        freshTech.status = "normal";

        QuoteMergeResult result = SignalRepository.mergeLiveQuoteLists(
                Arrays.asList(cachedTech, cachedStx),
                Collections.singletonList(freshTech),
                Arrays.asList(
                        new QuoteRequest("TECH", "Bio-Techne", "US_STOCK", "USD"),
                        new QuoteRequest("STX", "Seagate Technology", "US_STOCK", "USD")
                )
        );

        assertEquals(2, result.quotes.size());
        assertEquals(1, result.reusedCount);
        assertEquals("TECH", result.quotes.get(0).symbol);
        assertEquals(71.15, result.quotes.get(0).price, 0.001);
        assertEquals("STX", result.quotes.get(1).symbol);
        assertEquals(890.09, result.quotes.get(1).price, 0.001);
    }

    @Test
    public void marketCalendarCoversFutureUsHolidaysAndEarlyClose() {
        assertFalse(MarketCalendar.isUsTradingDay(LocalDate.of(2027, 12, 31)));
        assertEquals("New Year's Day observed", MarketCalendar.usHolidayName(LocalDate.of(2027, 12, 31)));
        assertFalse(MarketCalendar.isUsTradingDay(LocalDate.of(2028, 4, 14)));
        assertEquals("Good Friday", MarketCalendar.usHolidayName(LocalDate.of(2028, 4, 14)));
        assertTrue(MarketCalendar.isUsTradingDay(LocalDate.of(2028, 11, 24)));
        assertEquals("Day after Thanksgiving early close", MarketCalendar.usEarlyCloseName(LocalDate.of(2028, 11, 24)));
    }
}
