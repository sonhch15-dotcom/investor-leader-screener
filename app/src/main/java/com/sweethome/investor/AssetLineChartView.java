package com.sweethome.investor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

final class AssetLineChartView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF chart = new RectF();
    private double[] total = new double[0];
    private double[] cash = new double[0];
    private double[] holding = new double[0];

    AssetLineChartView(Context context) {
        super(context);
        setMinimumHeight(Ui.dp(context, 190));
    }

    void setSeries(double[] total, double[] cash, double[] holding) {
        this.total = total == null ? new double[0] : total;
        this.cash = cash == null ? new double[0] : cash;
        this.holding = holding == null ? new double[0] : holding;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int width = MeasureSpec.getSize(widthMeasureSpec);
        setMeasuredDimension(width, resolveSize(Ui.dp(getContext(), 205), heightMeasureSpec));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int left = Ui.dp(getContext(), 8);
        int top = Ui.dp(getContext(), 18);
        int right = getWidth() - Ui.dp(getContext(), 8);
        int bottom = getHeight() - Ui.dp(getContext(), 24);
        chart.set(left, top, right, bottom);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Ui.dp(getContext(), 1));
        paint.setColor(Ui.LINE);
        for (int index = 0; index <= 4; index++) {
            float y = chart.top + chart.height() * index / 4f;
            canvas.drawLine(chart.left, y, chart.right, y, paint);
        }

        if (pointCount() == 0) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Ui.MUTED);
            paint.setTextSize(Ui.dp(getContext(), 13));
            canvas.drawText("스냅샷이 쌓이면 자산 변화가 표시됩니다.", chart.left, chart.centerY(), paint);
            return;
        }
        double min = minValue();
        double max = maxValue();
        if (Math.abs(max - min) < 1) {
            max += 1;
            min -= 1;
        } else {
            double padding = (max - min) * 0.08;
            max += padding;
            min -= padding;
        }

        drawSeries(canvas, cash, min, max, Ui.WARNING, 2f);
        drawSeries(canvas, holding, min, max, Ui.SUCCESS, 2f);
        drawSeries(canvas, total, min, max, Ui.PRIMARY, 3f);
    }

    private void drawSeries(Canvas canvas, double[] values, double min, double max, int color, float strokeDp) {
        if (values.length == 0) {
            return;
        }
        path.reset();
        int count = pointCount();
        for (int index = 0; index < count; index++) {
            double value = index < values.length ? values[index] : 0;
            float x = count <= 1 ? chart.left : chart.left + chart.width() * index / (count - 1f);
            float y = yFor(value, min, max);
            if (index == 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        }
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Ui.dp(getContext(), Math.round(strokeDp)));
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setColor(color);
        canvas.drawPath(path, paint);

        paint.setStyle(Paint.Style.FILL);
        for (int index = 0; index < count; index++) {
            double value = index < values.length ? values[index] : 0;
            float x = count <= 1 ? chart.left : chart.left + chart.width() * index / (count - 1f);
            canvas.drawCircle(x, yFor(value, min, max), Ui.dp(getContext(), 2), paint);
        }
    }

    private float yFor(double value, double min, double max) {
        double ratio = (value - min) / (max - min);
        ratio = Math.max(0, Math.min(1, ratio));
        return (float) (chart.bottom - chart.height() * ratio);
    }

    private int pointCount() {
        return Math.max(total.length, Math.max(cash.length, holding.length));
    }

    private double minValue() {
        double min = Double.MAX_VALUE;
        min = scanMin(total, min);
        min = scanMin(cash, min);
        min = scanMin(holding, min);
        return min == Double.MAX_VALUE ? 0 : min;
    }

    private double maxValue() {
        double max = -Double.MAX_VALUE;
        max = scanMax(total, max);
        max = scanMax(cash, max);
        max = scanMax(holding, max);
        return max == -Double.MAX_VALUE ? 0 : max;
    }

    private double scanMin(double[] values, double current) {
        for (double value : values) {
            if (!Double.isNaN(value) && !Double.isInfinite(value)) {
                current = Math.min(current, value);
            }
        }
        return current;
    }

    private double scanMax(double[] values, double current) {
        for (double value : values) {
            if (!Double.isNaN(value) && !Double.isInfinite(value)) {
                current = Math.max(current, value);
            }
        }
        return current;
    }
}
