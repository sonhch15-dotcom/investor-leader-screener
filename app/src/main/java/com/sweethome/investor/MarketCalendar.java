package com.sweethome.investor;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.Month;
import java.time.temporal.TemporalAdjusters;
import java.util.HashMap;
import java.util.Map;

final class MarketCalendar {
    private static final Map<String, String> KOREA_HOLIDAYS = new HashMap<>();
    private static final Map<String, String> US_HOLIDAYS = new HashMap<>();

    static {
        addKr("2026-01-01", "신정");
        addKr("2026-02-16", "설 연휴");
        addKr("2026-02-17", "설날");
        addKr("2026-02-18", "설 연휴");
        addKr("2026-03-02", "삼일절 대체휴일");
        addKr("2026-05-01", "근로자의 날");
        addKr("2026-05-05", "어린이날");
        addKr("2026-05-25", "부처님오신날 대체휴일");
        addKr("2026-08-17", "광복절 대체휴일");
        addKr("2026-09-24", "추석 연휴");
        addKr("2026-09-25", "추석");
        addKr("2026-09-28", "추석 대체휴일");
        addKr("2026-10-05", "개천절 대체휴일");
        addKr("2026-10-09", "한글날");
        addKr("2026-12-25", "성탄절");
        addKr("2026-12-31", "연말 휴장일");

        addKr("2027-01-01", "신정");
        addKr("2027-02-08", "설 연휴");
        addKr("2027-02-09", "설 연휴");
        addKr("2027-02-10", "설 대체휴일");
        addKr("2027-03-01", "삼일절");
        addKr("2027-05-05", "어린이날");
        addKr("2027-05-13", "부처님오신날");
        addKr("2027-06-07", "현충일 대체휴일");
        addKr("2027-08-16", "광복절 대체휴일");
        addKr("2027-09-14", "추석 연휴");
        addKr("2027-09-15", "추석");
        addKr("2027-09-16", "추석 연휴");
        addKr("2027-10-04", "개천절 대체휴일");
        addKr("2027-10-11", "한글날 대체휴일");
        addKr("2027-12-27", "성탄절 대체휴일");
        addKr("2027-12-31", "연말 휴장일");

        addUs("2026-01-01", "New Year's Day");
        addUs("2026-01-19", "Martin Luther King Jr. Day");
        addUs("2026-02-16", "Washington's Birthday");
        addUs("2026-04-03", "Good Friday");
        addUs("2026-05-25", "Memorial Day");
        addUs("2026-06-19", "Juneteenth");
        addUs("2026-07-03", "Independence Day observed");
        addUs("2026-09-07", "Labor Day");
        addUs("2026-11-26", "Thanksgiving Day");
        addUs("2026-12-25", "Christmas Day");

        addUs("2027-01-01", "New Year's Day");
        addUs("2027-01-18", "Martin Luther King Jr. Day");
        addUs("2027-02-15", "Washington's Birthday");
        addUs("2027-03-26", "Good Friday");
        addUs("2027-05-31", "Memorial Day");
        addUs("2027-06-18", "Juneteenth observed");
        addUs("2027-07-05", "Independence Day observed");
        addUs("2027-09-06", "Labor Day");
        addUs("2027-11-25", "Thanksgiving Day");
        addUs("2027-12-24", "Christmas Day observed");
    }

    private MarketCalendar() {
    }

    static boolean isKoreaTradingDay(LocalDate date) {
        return isWeekday(date) && koreaHolidayName(date) == null;
    }

    static boolean isUsTradingDay(LocalDate easternDate) {
        return isWeekday(easternDate) && usHolidayName(easternDate) == null;
    }

    static String koreaHolidayName(LocalDate date) {
        String manual = KOREA_HOLIDAYS.get(key(date));
        if (manual != null) {
            return manual;
        }
        if (date.getMonth() == Month.DECEMBER && date.equals(lastWeekdayOfYear(date.getYear()))) {
            return "연말 휴장일";
        }
        return null;
    }

    static String usHolidayName(LocalDate easternDate) {
        String manual = US_HOLIDAYS.get(key(easternDate));
        if (manual != null) {
            return manual;
        }
        return dynamicUsHolidayName(easternDate);
    }

    static String usEarlyCloseName(LocalDate easternDate) {
        if (!isUsTradingDay(easternDate)) {
            return null;
        }
        if (easternDate.equals(thanksgiving(easternDate.getYear()).plusDays(1))) {
            return "Day after Thanksgiving early close";
        }
        if (easternDate.getMonth() == Month.JULY
                && easternDate.getDayOfMonth() == 3
                && easternDate.plusDays(1).getDayOfMonth() == 4) {
            return "Independence Day early close";
        }
        if (easternDate.getMonth() == Month.DECEMBER && easternDate.getDayOfMonth() == 24) {
            return "Christmas Eve early close";
        }
        return null;
    }

    private static boolean isWeekday(LocalDate date) {
        DayOfWeek day = date.getDayOfWeek();
        return day != DayOfWeek.SATURDAY && day != DayOfWeek.SUNDAY;
    }

    private static void addKr(String date, String name) {
        KOREA_HOLIDAYS.put(date, name);
    }

    private static void addUs(String date, String name) {
        US_HOLIDAYS.put(date, name);
    }

    private static String key(LocalDate date) {
        return date.toString();
    }

    private static String dynamicUsHolidayName(LocalDate date) {
        int year = date.getYear();
        if (date.equals(observedFixedHoliday(year, Month.JANUARY, 1))) {
            return "New Year's Day observed";
        }
        if (date.equals(observedFixedHoliday(year + 1, Month.JANUARY, 1))) {
            return "New Year's Day observed";
        }
        if (date.equals(LocalDate.of(year, Month.JANUARY, 1).with(TemporalAdjusters.dayOfWeekInMonth(3, DayOfWeek.MONDAY)))) {
            return "Martin Luther King Jr. Day";
        }
        if (date.equals(LocalDate.of(year, Month.FEBRUARY, 1).with(TemporalAdjusters.dayOfWeekInMonth(3, DayOfWeek.MONDAY)))) {
            return "Washington's Birthday";
        }
        if (date.equals(easterSunday(year).minusDays(2))) {
            return "Good Friday";
        }
        if (date.equals(LocalDate.of(year, Month.MAY, 1).with(TemporalAdjusters.lastInMonth(DayOfWeek.MONDAY)))) {
            return "Memorial Day";
        }
        if (date.equals(observedFixedHoliday(year, Month.JUNE, 19))) {
            return "Juneteenth observed";
        }
        if (date.equals(observedFixedHoliday(year, Month.JULY, 4))) {
            return "Independence Day observed";
        }
        if (date.equals(LocalDate.of(year, Month.SEPTEMBER, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY)))) {
            return "Labor Day";
        }
        if (date.equals(thanksgiving(year))) {
            return "Thanksgiving Day";
        }
        if (date.equals(observedFixedHoliday(year, Month.DECEMBER, 25))) {
            return "Christmas Day observed";
        }
        return null;
    }

    private static LocalDate observedFixedHoliday(int year, Month month, int day) {
        LocalDate actual = LocalDate.of(year, month, day);
        if (actual.getDayOfWeek() == DayOfWeek.SATURDAY) {
            return actual.minusDays(1);
        }
        if (actual.getDayOfWeek() == DayOfWeek.SUNDAY) {
            return actual.plusDays(1);
        }
        return actual;
    }

    private static LocalDate thanksgiving(int year) {
        return LocalDate.of(year, Month.NOVEMBER, 1)
                .with(TemporalAdjusters.dayOfWeekInMonth(4, DayOfWeek.THURSDAY));
    }

    private static LocalDate lastWeekdayOfYear(int year) {
        LocalDate date = LocalDate.of(year, Month.DECEMBER, 31);
        while (!isWeekday(date)) {
            date = date.minusDays(1);
        }
        return date;
    }

    private static LocalDate easterSunday(int year) {
        int a = year % 19;
        int b = year / 100;
        int c = year % 100;
        int d = b / 4;
        int e = b % 4;
        int f = (b + 8) / 25;
        int g = (b - f + 1) / 3;
        int h = (19 * a + b - d - g + 15) % 30;
        int i = c / 4;
        int k = c % 4;
        int l = (32 + 2 * e + 2 * i - h - k) % 7;
        int m = (a + 11 * h + 22 * l) / 451;
        int month = (h + l - 7 * m + 114) / 31;
        int day = ((h + l - 7 * m + 114) % 31) + 1;
        return LocalDate.of(year, month, day);
    }
}
