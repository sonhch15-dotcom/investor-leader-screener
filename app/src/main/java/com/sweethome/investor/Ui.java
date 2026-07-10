package com.sweethome.investor;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    static final int BG = Color.rgb(244, 246, 248);
    static final int SURFACE = Color.WHITE;
    static final int SURFACE_SOFT = Color.rgb(249, 251, 253);
    static final int TEXT = Color.rgb(22, 26, 32);
    static final int MUTED = Color.rgb(94, 103, 116);
    static final int PRIMARY = Color.rgb(18, 87, 154);
    static final int SUCCESS = Color.rgb(18, 151, 117);
    static final int WARNING = Color.rgb(178, 112, 0);
    static final int DANGER = Color.rgb(201, 54, 72);
    static final int LINE = Color.rgb(222, 228, 235);
    static final int ACCENT_US = Color.rgb(37, 99, 235);
    static final int ACCENT_KR = Color.rgb(18, 151, 117);
    static final int ACCENT_PENSION = Color.rgb(126, 87, 194);

    private Ui() {
    }

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static TextView text(Context context, String value, int sp, int color, int style) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, style);
        view.setIncludeFontPadding(true);
        view.setLineSpacing(dp(context, 2), 1.0f);
        return view;
    }

    static TextView mono(Context context, String value, int sp, int color, int style) {
        TextView view = text(context, value, sp, color, style);
        view.setTypeface(Typeface.create("sans-serif-medium", style));
        return view;
    }

    static LinearLayout vertical(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    static LinearLayout horizontal(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    static LinearLayout card(Context context) {
        LinearLayout layout = vertical(context);
        layout.setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10));
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(SURFACE);
        drawable.setCornerRadius(dp(context, 8));
        drawable.setStroke(dp(context, 1), LINE);
        layout.setBackground(drawable);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(dp(context, 14), dp(context, 6), dp(context, 14), dp(context, 6));
        layout.setLayoutParams(params);
        return layout;
    }

    static LinearLayout band(Context context) {
        LinearLayout layout = vertical(context);
        layout.setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10));
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(SURFACE_SOFT);
        drawable.setCornerRadius(dp(context, 8));
        drawable.setStroke(dp(context, 1), LINE);
        layout.setBackground(drawable);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, dp(context, 8), 0, dp(context, 8));
        layout.setLayoutParams(params);
        return layout;
    }

    static TextView pill(Context context, String value, int color) {
        TextView view = text(context, value, 12, color, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(context, 10), dp(context, 4), dp(context, 10), dp(context, 4));
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(withAlpha(color, 24));
        drawable.setCornerRadius(dp(context, 999));
        view.setBackground(drawable);
        return view;
    }

    static View colorDot(Context context, int color) {
        View view = new View(context);
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setShape(GradientDrawable.OVAL);
        view.setBackground(drawable);
        view.setLayoutParams(new LinearLayout.LayoutParams(dp(context, 9), dp(context, 9)));
        return view;
    }

    static Button button(Context context, String value, int color, boolean filled) {
        Button button = new Button(context);
        button.setText(value);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setMinHeight(dp(context, 34));
        button.setMinimumHeight(dp(context, 34));
        button.setMinWidth(0);
        button.setPadding(dp(context, 8), 0, dp(context, 8), 0);
        button.setTextColor(filled ? Color.WHITE : color);
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(context, 8));
        drawable.setColor(filled ? color : Color.TRANSPARENT);
        drawable.setStroke(dp(context, 1), color);
        button.setBackground(drawable);
        return button;
    }

    static View progress(Context context, double fraction, int color) {
        LinearLayout shell = horizontal(context);
        shell.setBackgroundColor(withAlpha(color, 25));
        shell.setMinimumHeight(dp(context, 8));
        int filled = Math.max(1, (int) Math.round(Math.max(0, Math.min(1, fraction)) * 100));
        View bar = new View(context);
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(context, 99));
        bar.setBackground(drawable);
        shell.addView(bar, new LinearLayout.LayoutParams(0, dp(context, 8), filled));
        View rest = new View(context);
        shell.addView(rest, new LinearLayout.LayoutParams(0, dp(context, 8), Math.max(1, 100 - filled)));
        return shell;
    }

    static View spacer(Context context, int height) {
        View view = new View(context);
        view.setLayoutParams(new LinearLayout.LayoutParams(1, dp(context, height)));
        return view;
    }

    static void addDivider(Context context, LinearLayout parent) {
        View view = new View(context);
        view.setBackgroundColor(LINE);
        parent.addView(view, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(context, 1)
        ));
    }

    static int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }
}
